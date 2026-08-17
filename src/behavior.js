// Motor layer: the brain decides, this executes. Descending-neuron rates
// (giant fiber escape, DNp09 walk, DNa01/02 steering, DNg11 grooming, MDN
// backing, proboscis motor pool feeding) trigger and steer the behaviors.
// Flight paths, landing mechanics and perch choice stay body-level
// heuristics; without vision it falls back to timers plus a scripted loom.

const { nearestTree } = require('./world.js');

const TAU = Math.PI * 2;

function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function angNorm(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function lerp(a, b, t) { return a + (b - a) * t; }

const KIND_WEIGHT = { input: 3.0, window: 2.2, branch: 2.6, screen: 1.0, ground: 0.5 };

// drive thresholds (Hz per neuron above each group's own slow baseline)
const TH = { gf: 25, walk: 2.5, groom: 2, feed: 2, mdn: 2 };
const RATE_KEYS = ['gf', 'walk', 'groom', 'feed', 'mdn', 'turn_l', 'turn_r', 'loom_l', 'loom_r'];

function ledgePoint(l, u) {
  if (l.dir === 'ground') return { x: l.x, y: l.y };
  return l.dir === 'h'
    ? { x: l.x0 + (l.x1 - l.x0) * u, y: l.y }
    : { x: l.x, y: l.y0 + (l.y1 - l.y0) * u };
}
function ledgeLen(l) {
  if (l.dir === 'ground') return 1e4;
  return l.dir === 'h' ? Math.abs(l.x1 - l.x0) : Math.abs(l.y1 - l.y0);
}

class Fly {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = rand(-60, 60); this.vy = rand(-60, 60);
    this.heading = rand(0, TAU);
    this.z = 1;
    this.alt = 24;
    this.altTarget = 34;
    this.pitch = 0;
    this.state = 'CRUISE';
    this.t = 0;
    this.stateDur = rand(3, 9);
    this.wingPhase = 0;
    this.wingFold = 0;
    this.gaitPhase = 0;
    this.groomPhase = 0;
    this.proboscis = 0;
    this.wander = rand(0, TAU);
    this.dartT = 0;
    this.perch = null;      // { ledge, u, side }
    this.perchClock = 0;
    this.restless = rand(45, 90);
    this.subT = 0;
    this.walkDir = 1;
    this.loomT = 99;
    this.lastEscape = -9;
    this.lastSugar = 0;
    this.clock = 0;
    this.feedIdx = -1;
    this.escapeFlag = false;
    this.ema = {};
    this.slow = {};
    this.drive = {};
    for (const k of RATE_KEYS) { this.ema[k] = 0; this.slow[k] = 0; this.drive[k] = 0; }
  }

  update(dt, env) {
    this.t += dt;
    this.clock += dt;
    this.loomT += dt;
    if (this.z > 0.05) this.wingPhase += dt * 135 * TAU;

    // fast rate minus each group's own slow baseline: a tonically stuck
    // neuron reads as zero drive, transients read as commands
    const k = 1 - Math.exp(-dt / 0.25);
    const ks = 1 - Math.exp(-dt / 45);
    for (const key of RATE_KEYS) {
      const r = env.brain.rates[key] || 0;
      this.ema[key] += (r - this.ema[key]) * k;
      this.slow[key] += (r - this.slow[key]) * ks;
      this.drive[key] = Math.max(0, this.ema[key] - this.slow[key]);
    }
    const brainLive = env.brain.vision && env.brain.age() < 2;
    this.hungerNow = env.brain.hunger !== undefined ? env.brain.hunger : 0.7;

    const grounded = this.state === 'PERCH' || this.state === 'WALK'
      || this.state === 'GROOM' || this.state === 'FEED';

    if (brainLive) {
      if (this.drive.gf > TH.gf && this.clock - this.lastEscape > 2) {
        this.lastEscape = this.clock;
        if (grounded) this.takeoff(env, true);
        else this.dartAway(env);
      }
    } else {
      const threat = this.threat(env);
      if (grounded) {
        if (threat && this.loomT > 1.2) { env.stim('loom', 1); this.loomT = 0; }
        const gf = env.brain.rates.gf || 0;
        const brainDead = env.brain.age() > 2;
        if (this.loomT < 0.7 && (gf > 5 || (brainDead && this.loomT > 0.3))) this.takeoff(env, true);
      }
    }

    if (grounded && !this.refreshPerchLedge(env)) this.takeoff(env, false);

    const altBefore = this.alt;
    switch (this.state) {
      case 'CRUISE': this.cruise(dt, env, brainLive); break;
      case 'SEEK': this.seek(dt, env); break;
      case 'LAND': this.land(dt); break;
      case 'PERCH': this.perchIdle(dt, env, brainLive); break;
      case 'WALK': this.walk(dt, env, brainLive); break;
      case 'GROOM': this.groomStep(dt, brainLive); break;
      case 'FEED': this.feed(dt, env); break;
      case 'TAKEOFF': this.takeoffAnim(dt); break;
    }
    if (this.state !== 'FEED' && this.proboscis > 0) {
      this.proboscis = Math.max(0, this.proboscis - dt * 3);
    }

    const airborne = this.state === 'CRUISE' || this.state === 'SEEK';
    const climb = dt > 0 ? (this.alt - altBefore) / dt : 0;
    const wantPitch = airborne
      ? clamp(Math.atan2(climb, Math.max(60, Math.hypot(this.vx, this.vy))), -0.7, 0.7)
      : 0;
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 4);
  }

  perchAlt() {
    if (!this.perch) return 2;
    if (this.perch.alt !== undefined) return this.perch.alt;
    const d = this.perch.ledge.dir;
    return d === 'h' ? 30 : d === 'v' ? 14 : 2;
  }

  threat(env) {
    const dx = env.cursor.x - this.x, dy = env.cursor.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d > 110) return false;
    const closing = (dx * env.cursor.vx + dy * env.cursor.vy) < -3000;
    return d < 50 || closing;
  }

  onFood(env) {
    for (let i = 0; i < env.food.length; i++) {
      const f = env.food[i];
      if (Math.hypot(f.x - this.x, f.y - this.y) < f.r + 4) return i;
    }
    return -1;
  }

  refreshPerchLedge(env) {
    const l = this.perch && this.perch.ledge;
    if (!l) return false;
    if (l.dir === 'ground') return true;
    for (const c of env.ledges) {
      if (c.dir !== l.dir) continue;
      if ((c.kind === 'branch') !== (l.kind === 'branch')) continue;
      if (l.dir === 'h' && Math.abs(c.y - l.y) < 8 && c.x0 < l.x1 && c.x1 > l.x0) {
        this.perch.ledge = c; return true;
      }
      if (l.dir === 'v' && Math.abs(c.x - l.x) < 8 && c.y0 < l.y1 && c.y1 > l.y0) {
        this.perch.ledge = c; return true;
      }
    }
    return false;
  }

  touchXY() {
    const p = this.perch;
    const pt = ledgePoint(p.ledge, p.u);
    if (p.ledge.dir === 'ground') return pt;
    const off = Math.max(1.2, 2.5 * (this.vis || 1));
    return p.ledge.dir === 'h'
      ? { x: pt.x, y: pt.y - off }
      : { x: pt.x + p.side * off, y: pt.y };
  }

  ledgeHeading() {
    const l = this.perch.ledge;
    if (l.dir === 'ground') return this.heading;
    const base = l.dir === 'h' ? 0 : Math.PI / 2;
    const a = base, b = angNorm(base + Math.PI);
    return Math.abs(angNorm(a - this.heading)) < Math.abs(angNorm(b - this.heading)) ? a : b;
  }

  faceVelocity(dt) {
    const sp = Math.hypot(this.vx, this.vy);
    if (sp < 20) return;
    const want = Math.atan2(this.vy, this.vx);
    this.heading += angNorm(want - this.heading) * Math.min(1, dt * 10);
  }

  turnBias() {
    return clamp(this.drive.turn_r - this.drive.turn_l, -12, 12);
  }

  dartAway(env) {
    const away = this.drive.loom_l > this.drive.loom_r ? -1 : 1;
    const a = this.heading + away * rand(1.6, 2.6);
    this.vx = Math.cos(a) * 420;
    this.vy = Math.sin(a) * 420;
    this.altTarget = rand(36, 70);
  }

  cruise(dt, env, brainLive) {
    this.wander += rand(-1, 1) * 6 * dt;
    let ax = Math.cos(this.wander) * 230;
    let ay = Math.sin(this.wander) * 230;
    if (brainLive) {
      // DNa01/02 asymmetry steers flight
      const rot = this.turnBias() * 0.06 * dt;
      const [vx, vy] = [this.vx, this.vy];
      this.vx = vx * Math.cos(rot) - vy * Math.sin(rot);
      this.vy = vx * Math.sin(rot) + vy * Math.cos(rot);
    } else if (this.threat(env)) {
      const dx = this.x - env.cursor.x, dy = this.y - env.cursor.y;
      const d = Math.hypot(dx, dy) || 1;
      ax += (dx / d) * 900; ay += (dy / d) * 900;
    }
    this.dartT -= dt;
    if (this.dartT <= 0) {
      this.dartT = rand(0.25, 1.2);
      this.vx += rand(-150, 150);
      this.vy += rand(-130, 130);
      if (Math.random() < 0.45) this.altTarget = rand(10, 64);
    }
    this.alt += (this.altTarget - this.alt) * Math.min(1, dt * 1.1);
    const m = 80;
    if (this.x < m) ax += (m - this.x) * 10;
    if (this.x > env.w - m) ax -= (this.x - (env.w - m)) * 10;
    if (this.y < m) ay += (m - this.y) * 10;
    if (this.y > env.h - m) ay -= (this.y - (env.h - m)) * 10;

    this.vx += ax * dt; this.vy += ay * dt;
    const sp = Math.hypot(this.vx, this.vy);
    const vmax = 340;
    if (sp > vmax) { this.vx *= vmax / sp; this.vy *= vmax / sp; }
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.faceVelocity(dt);

    if (this.t > this.stateDur) {
      const p = this.pickPerch(env);
      if (p) { this.perch = p; this.state = 'SEEK'; this.t = 0; }
      else this.stateDur = this.t + rand(2, 5);
    }
  }

  pickPerch(env) {
    const c = env.cursor;
    const cands = [];
    for (const l of env.ledges) {
      if (l.kind !== 'branch' && ledgeLen(l) < 40) continue;
      let u = rand(0.12, 0.88);
      let alt;
      if (l.kind === 'branch') {
        alt = l.alt;
      } else {
        // snap wall perches to a real tree so the fly sits on a treetop
        const t = nearestTree(l, ledgePoint(l, u).x, ledgePoint(l, u).y);
        if (t) {
          u = clamp(l.dir === 'h'
            ? (t.x - l.x0) / ((l.x1 - l.x0) || 1)
            : (t.y - l.y0) / ((l.y1 - l.y0) || 1), 0.05, 0.95);
          alt = t.top;
        }
      }
      const pt = ledgePoint(l, u);
      if (Math.hypot(pt.x - c.x, pt.y - c.y) < 160) continue;
      const d = Math.hypot(pt.x - this.x, pt.y - this.y);
      if (d < 30) continue;
      const w = (KIND_WEIGHT[l.kind] || 1) / (1 + d / 500);
      cands.push({ ledge: l, u, w, alt });
    }
    // ground landings only happen at food (visible berries), never at a bare
    // random spot; the pull scales with the brain's hunger state
    const hunger = env.brain.hunger !== undefined ? env.brain.hunger : 0.7;
    for (let i = 0; i < 3 && env.food.length; i++) {
      const f = env.food[(Math.random() * env.food.length) | 0];
      const gx = f.x + rand(-22, 22);
      const gy = f.y + rand(-22, 22);
      if (Math.hypot(gx - c.x, gy - c.y) < 160) continue;
      cands.push({
        ledge: { dir: 'ground', x: gx, y: gy, kind: 'ground' },
        u: 0,
        alt: 2,
        w: (1.5 + 6 * hunger) / (1 + Math.hypot(gx - this.x, gy - this.y) / 500),
      });
    }
    if (!cands.length) return null;
    let total = 0;
    for (const k of cands) total += k.w;
    let r = Math.random() * total;
    let pick = cands[cands.length - 1];
    for (const k of cands) { r -= k.w; if (r <= 0) { pick = k; break; } }
    pick.side = pick.ledge.dir === 'v' ? (Math.sign(this.x - pick.ledge.x) || 1) : -1;
    return pick;
  }

  seek(dt, env) {
    if (!this.refreshPerchLedge(env)) {
      this.state = 'CRUISE'; this.t = 0; this.stateDur = rand(2, 6); this.perch = null;
      return;
    }
    const td = this.touchXY();
    const l = this.perch.ledge;
    const hover = {
      x: td.x + (l.dir === 'v' ? this.perch.side * 16 : 0),
      y: td.y + (l.dir === 'h' ? -16 : 0),
    };
    const dist = Math.hypot(td.x - this.x, td.y - this.y);
    const far = dist > 26;
    const goal = far ? hover : td;
    const dx = goal.x - this.x, dy = goal.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = clamp(d * 2.5, 30, far ? 300 : 60);
    this.vx += ((dx / d) * speed - this.vx) * Math.min(1, dt * 5);
    this.vy += ((dy / d) * speed - this.vy) * Math.min(1, dt * 5);
    this.vx += rand(-1, 1) * 40 * dt;
    this.vy += rand(-1, 1) * 40 * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.faceVelocity(dt);
    const wantAlt = this.perchAlt() + (far ? 14 : 3);
    this.alt += (wantAlt - this.alt) * Math.min(1, dt * 2.5);
    if (!far && d < 4 && Math.hypot(this.vx, this.vy) < 55) {
      this.state = 'LAND'; this.t = 0;
      this.landFrom = { x: this.x, y: this.y, h: this.heading, alt: this.alt };
    } else if (this.t > 9) {
      this.state = 'CRUISE'; this.t = 0; this.stateDur = rand(3, 8); this.perch = null;
    }
  }

  land(dt) {
    const k = clamp(this.t / 0.28, 0, 1);
    const td = this.touchXY();
    this.x = lerp(this.landFrom.x, td.x, k);
    this.y = lerp(this.landFrom.y, td.y, k);
    this.alt = lerp(this.landFrom.alt, this.perchAlt(), k);
    this.z = 1 - k;
    this.wingFold = k;
    const dir = this.ledgeHeading();
    this.heading += angNorm(dir - this.heading) * Math.min(1, k);
    this.vx = 0; this.vy = 0;
    if (k >= 1) {
      this.state = 'PERCH'; this.t = 0;
      this.perchClock = 0;
      // a hungry fly will not sit long; a fed one lingers
      this.restless = rand(35, 80) * (1.5 - (this.hungerNow || 0.7));
      this.heading = dir;
    }
  }

  perchIdle(dt, env, brainLive) {
    this.perchClock += dt;
    this.gaitPhase += dt * 0.9;
    this.alt = this.perchAlt();

    const foodIdx = this.onFood(env);
    if (foodIdx >= 0 && this.clock - this.lastSugar > 0.5) {
      env.stim('sugar', 1);
      this.lastSugar = this.clock;
    }

    if (brainLive) {
      if (foodIdx >= 0 && this.drive.feed > TH.feed) {
        this.feedIdx = foodIdx; this.state = 'FEED'; this.subT = 0;
      } else if (this.drive.groom > TH.groom) {
        this.state = 'GROOM'; this.subT = 1.2;
      } else if (this.drive.walk > TH.walk) {
        this.state = 'WALK'; this.subT = 0.8;
        this.walkDir = this.turnBias() >= 0 ? 1 : -1;
      } else if (this.perchClock > this.restless) {
        this.takeoff(env, false); // fallback so it never sits forever
      }
    } else {
      if (foodIdx >= 0 && this.drive.feed > TH.feed) {
        this.feedIdx = foodIdx; this.state = 'FEED'; this.subT = 0;
        return;
      }
      if (this.perchClock > this.stateDur) { this.takeoff(env, false); return; }
      const roll = Math.random();
      if (roll < dt * 0.10) { this.state = 'GROOM'; this.subT = rand(2, 4.5); }
      else if (roll < dt * 0.18) {
        this.state = 'WALK'; this.subT = rand(1.5, 4);
        this.walkDir = Math.random() < 0.5 ? -1 : 1;
      }
    }
  }

  nearestWallAhead(env, dist) {
    const hx = Math.cos(this.heading), hy = Math.sin(this.heading);
    for (const l of env.ledges) {
      if (l.dir === 'ground' || l.kind === 'branch') continue;
      const pt = l.dir === 'h'
        ? { x: clamp(this.x, l.x0, l.x1), y: l.y }
        : { x: l.x, y: clamp(this.y, l.y0, l.y1) };
      const dx = pt.x - this.x, dy = pt.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < dist && dx * hx + dy * hy > 0) return true;
    }
    return false;
  }

  walk(dt, env, brainLive) {
    this.perchClock += dt;
    this.subT -= dt;
    this.gaitPhase += dt * 8;
    this.alt = this.perchAlt();
    const l = this.perch.ledge;
    const backing = brainLive && this.drive.mdn > TH.mdn;
    const speed = backing ? -11 : 24;

    if (l.dir === 'ground') {
      let turn = brainLive ? this.turnBias() * 0.25 * dt : rand(-1, 1) * 0.8 * dt;
      // food nearby pulls gently (odor-taxis heuristic, not a DN readout)
      let best = null;
      for (const f of env.food) {
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        if (d < 140 && (!best || d < best.d)) best = { f, d };
      }
      if (best) {
        const hunger = env.brain.hunger !== undefined ? env.brain.hunger : 0.7;
        turn += angNorm(Math.atan2(best.f.y - this.y, best.f.x - this.x) - this.heading)
          * (0.4 + 2.0 * hunger) * dt;
      }
      this.heading += turn;
      const nx = this.x + Math.cos(this.heading) * speed * dt;
      const ny = this.y + Math.sin(this.heading) * speed * dt;
      if (this.nearestWallAhead(env, 7) || nx < 20 || nx > env.w - 20 || ny < 30 || ny > env.h - 20) {
        this.heading += rand(1.8, 2.8);
      } else {
        this.x = nx; this.y = ny;
        l.x = nx; l.y = ny;
      }
      if (this.onFood(env) >= 0) { this.state = 'PERCH'; return; }
    } else {
      const len = Math.max(ledgeLen(l), 8);
      const margin = Math.min(0.3, 10 / len);
      this.perch.u = clamp(this.perch.u + ((speed * dt) / len) * this.walkDir, margin, 1 - margin);
      if (this.perch.u <= margin + 1e-4 || this.perch.u >= 1 - margin - 1e-4) this.walkDir *= -1;
      const td = this.touchXY();
      this.x = td.x; this.y = td.y;
      let dir;
      if (l.dir === 'h') dir = this.walkDir > 0 ? 0 : Math.PI;
      else dir = this.walkDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.heading += angNorm(dir - this.heading) * Math.min(1, dt * 6);
    }

    const done = brainLive
      ? (this.subT <= 0 && this.drive.walk < TH.walk * 0.5) || this.perchClock > this.restless
      : this.subT <= 0;
    if (done || this.t > 12) this.state = 'PERCH';
  }

  groomStep(dt, brainLive) {
    this.perchClock += dt;
    this.subT -= dt;
    this.groomPhase += dt * 5.5;
    const done = brainLive ? (this.subT <= 0 && this.drive.groom < TH.groom * 0.4) : this.subT <= 0;
    if (done) this.state = 'PERCH';
  }

  feed(dt, env) {
    this.perchClock += dt;
    this.subT += dt;
    this.proboscis = Math.min(1, this.proboscis + dt * 4);
    const f = env.food[this.feedIdx];
    if (this.clock - this.lastSugar > 0.5) {
      env.stim('sugar', 1);
      this.lastSugar = this.clock;
    }
    if (this.subT > 1 && f) { env.ate(this.feedIdx, 0.2 * dt); }
    const starved = !f || Math.hypot(f.x - this.x, f.y - this.y) > f.r + 6;
    if (starved || this.subT > 20 || (this.subT > 2.5 && this.drive.feed < TH.feed * 0.4)) {
      this.state = 'PERCH';
    }
  }

  takeoff(env, escape) {
    this.altTarget = escape ? rand(36, 70) : rand(14, 56);
    let dx, dy;
    if (escape) {
      if (env.brain.vision) {
        const away = this.drive.loom_l > this.drive.loom_r ? -1 : 1;
        const a = this.heading + away * rand(1.6, 2.6);
        dx = Math.cos(a); dy = Math.sin(a);
      } else {
        dx = this.x - env.cursor.x; dy = this.y - env.cursor.y;
      }
    } else if (this.perch) {
      const l = this.perch.ledge;
      if (l.dir === 'h') { dx = rand(-0.6, 0.6); dy = -1; }
      else if (l.dir === 'v') { dx = this.perch.side; dy = rand(-0.6, -0.1); }
      else { dx = rand(-1, 1); dy = rand(-1, -0.3); }
    } else { dx = rand(-1, 1); dy = -1; }
    const d = Math.hypot(dx, dy) || 1;
    const v = escape ? 480 : 150;
    this.launchVx = (dx / d) * v + rand(-40, 40);
    this.launchVy = (dy / d) * v + rand(-30, 30);
    this.escapeFlag = escape;
    this.state = 'TAKEOFF'; this.t = 0;
  }

  takeoffAnim(dt) {
    const k = clamp(this.t / (this.escapeFlag ? 0.12 : 0.22), 0, 1);
    this.wingFold = 1 - k;
    this.z = k;
    this.alt = this.perchAlt() + k * 7;
    if (k >= 1) {
      this.vx = this.launchVx; this.vy = this.launchVy;
      this.state = 'CRUISE'; this.t = 0; this.stateDur = rand(3, 10);
      this.perch = null;
    }
  }

  pose() {
    let legMode = 'tucked';
    if (this.state === 'PERCH' || this.state === 'FEED') legMode = 'stand';
    else if (this.state === 'WALK') legMode = 'walk';
    else if (this.state === 'GROOM') legMode = 'groom';
    else if (this.state === 'LAND') legMode = this.t > 0.08 ? 'stand' : 'tucked';
    else if (this.state === 'TAKEOFF') legMode = 'stand';
    return {
      x: this.x, y: this.y, heading: this.heading, z: this.z,
      wingPhase: this.wingPhase, wingFold: this.wingFold,
      legMode, gaitPhase: this.gaitPhase, groomPhase: this.groomPhase,
      proboscis: this.proboscis,
      perchDir: this.perch ? this.perch.ledge.dir : null,
      scale: this.pinScale || 1,
    };
  }

  // static poses for art iteration via DESKFLY_POSE
  pin(name, env, t) {
    this.x = env.w / 2; this.y = env.h / 2;
    this.heading = name.startsWith('side') ? 0 : -0.6;
    this.perch = name.startsWith('side')
      ? { ledge: { dir: 'h', x0: 0, x1: env.w, y: env.h / 2 + 6, kind: 'window' }, u: 0.5, side: -1 }
      : null;
    this.z = 0; this.wingFold = 1;
    this.alt = this.perch ? 30 : 2;
    this.pitch = 0;
    if (name === 'flight') {
      this.state = 'CRUISE'; this.z = 1; this.wingFold = 0;
      this.wingPhase = t * 135 * TAU; this.perch = null;
      this.alt = 30;
    } else if (name === 'walk') {
      this.state = 'WALK'; this.gaitPhase = t * 8;
    } else if (name === 'groom' || name === 'sidegroom') {
      this.state = 'GROOM'; this.groomPhase = t * 5.5;
    } else if (name === 'sidefeed') {
      this.state = 'FEED'; this.proboscis = 1;
    } else {
      this.state = 'PERCH'; this.gaitPhase = t * 0.9;
    }
  }
}

module.exports = { Fly };
