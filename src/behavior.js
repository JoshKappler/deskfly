// Flight physics and the perch/walk/groom/escape state machine.
// The sprite consumes pose(); the brain feeds group firing rates via env.brain.

const TAU = Math.PI * 2;

function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function angNorm(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function lerp(a, b, t) { return a + (b - a) * t; }

const KIND_WEIGHT = { input: 3.0, window: 1.4, screen: 1.0 };

function ledgePoint(l, u) {
  return l.dir === 'h'
    ? { x: l.x0 + (l.x1 - l.x0) * u, y: l.y }
    : { x: l.x, y: l.y0 + (l.y1 - l.y0) * u };
}
function ledgeLen(l) { return l.dir === 'h' ? Math.abs(l.x1 - l.x0) : Math.abs(l.y1 - l.y0); }

class Fly {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = rand(-60, 60); this.vy = rand(-60, 60);
    this.heading = rand(0, TAU);
    this.z = 1;
    this.state = 'CRUISE';
    this.t = 0;
    this.stateDur = rand(3, 9);
    this.wingPhase = 0;
    this.wingFold = 0;
    this.gaitPhase = 0;
    this.groomPhase = 0;
    this.wander = rand(0, TAU);
    this.dartT = 0;
    this.perch = null;      // { ledge, u, side }
    this.perchClock = 0;
    this.subT = 0;
    this.walkDir = 1;
    this.loomT = 99;
    this.escapeFlag = false;
  }

  update(dt, env) {
    this.t += dt;
    this.loomT += dt;
    if (this.z > 0.05) this.wingPhase += dt * 135 * TAU;

    const grounded = this.state === 'PERCH' || this.state === 'WALK' || this.state === 'GROOM';
    const threat = this.threat(env);

    if (grounded) {
      if (threat && this.loomT > 1.2) { env.stim('loom', 1); this.loomT = 0; }
      const gf = env.brain.rates.gf || 0;
      const brainDead = env.brain.age() > 2;
      if (this.loomT < 0.7 && (gf > 5 || (brainDead && this.loomT > 0.3))) {
        this.takeoff(env, true);
      } else if (!this.refreshPerchLedge(env)) {
        this.takeoff(env, false);
      }
    }

    switch (this.state) {
      case 'CRUISE': this.cruise(dt, env, threat); break;
      case 'SEEK': this.seek(dt, env, threat); break;
      case 'LAND': this.land(dt); break;
      case 'PERCH': this.perchIdle(dt, env); break;
      case 'WALK': this.walk(dt); break;
      case 'GROOM': this.groomStep(dt); break;
      case 'TAKEOFF': this.takeoffAnim(dt); break;
    }
  }

  threat(env) {
    const dx = env.cursor.x - this.x, dy = env.cursor.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d > 110) return false;
    const closing = (dx * env.cursor.vx + dy * env.cursor.vy) < -3000;
    return d < 50 || closing;
  }

  // re-find our ledge in the latest scan; window edges move and vanish
  refreshPerchLedge(env) {
    const l = this.perch && this.perch.ledge;
    if (!l) return false;
    for (const c of env.ledges) {
      if (c.dir !== l.dir) continue;
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
    const off = Math.max(1.2, 2.5 * (this.vis || 1));
    return p.ledge.dir === 'h'
      ? { x: pt.x, y: pt.y - off }
      : { x: pt.x + p.side * off, y: pt.y };
  }

  ledgeHeading() {
    const base = this.perch.ledge.dir === 'h' ? 0 : Math.PI / 2;
    const a = base, b = angNorm(base + Math.PI);
    return Math.abs(angNorm(a - this.heading)) < Math.abs(angNorm(b - this.heading)) ? a : b;
  }

  faceVelocity(dt) {
    const sp = Math.hypot(this.vx, this.vy);
    if (sp < 20) return;
    const want = Math.atan2(this.vy, this.vx);
    this.heading += angNorm(want - this.heading) * Math.min(1, dt * 10);
  }

  cruise(dt, env, threat) {
    this.wander += rand(-1, 1) * 6 * dt;
    let ax = Math.cos(this.wander) * 230;
    let ay = Math.sin(this.wander) * 230;
    this.dartT -= dt;
    if (this.dartT <= 0) {
      this.dartT = rand(0.25, 1.2);
      this.vx += rand(-150, 150);
      this.vy += rand(-130, 130);
    }
    if (threat) {
      const dx = this.x - env.cursor.x, dy = this.y - env.cursor.y;
      const d = Math.hypot(dx, dy) || 1;
      ax += (dx / d) * 900; ay += (dy / d) * 900;
    }
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
      if (ledgeLen(l) < 40) continue;
      const u = rand(0.12, 0.88);
      const pt = ledgePoint(l, u);
      if (Math.hypot(pt.x - c.x, pt.y - c.y) < 160) continue;
      const d = Math.hypot(pt.x - this.x, pt.y - this.y);
      if (d < 30) continue;
      const w = (KIND_WEIGHT[l.kind] || 1) / (1 + d / 500);
      cands.push({ ledge: l, u, w });
    }
    if (!cands.length) return null;
    let total = 0;
    for (const k of cands) total += k.w;
    let r = Math.random() * total;
    let pick = cands[cands.length - 1];
    for (const k of cands) { r -= k.w; if (r <= 0) { pick = k; break; } }
    pick.side = pick.ledge.dir === 'h' ? -1 : (Math.sign(this.x - pick.ledge.x) || 1);
    return pick;
  }

  seek(dt, env, threat) {
    if (threat || !this.refreshPerchLedge(env)) {
      this.state = 'CRUISE'; this.t = 0; this.stateDur = rand(2, 6); this.perch = null;
      return;
    }
    const td = this.touchXY();
    const hover = {
      x: td.x + (this.perch.ledge.dir === 'v' ? this.perch.side * 16 : 0),
      y: td.y + (this.perch.ledge.dir === 'h' ? -16 : 0),
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
    if (!far && d < 4 && Math.hypot(this.vx, this.vy) < 55) {
      this.state = 'LAND'; this.t = 0;
      this.landFrom = { x: this.x, y: this.y, h: this.heading };
    } else if (this.t > 9) {
      this.state = 'CRUISE'; this.t = 0; this.stateDur = rand(3, 8); this.perch = null;
    }
  }

  land(dt) {
    const k = clamp(this.t / 0.28, 0, 1);
    const td = this.touchXY();
    this.x = lerp(this.landFrom.x, td.x, k);
    this.y = lerp(this.landFrom.y, td.y, k);
    this.z = 1 - k;
    this.wingFold = k;
    const dir = this.ledgeHeading();
    this.heading += angNorm(dir - this.heading) * Math.min(1, k);
    this.vx = 0; this.vy = 0;
    if (k >= 1) {
      this.state = 'PERCH'; this.t = 0;
      this.perchClock = 0; this.stateDur = rand(6, 26);
      this.heading = dir;
    }
  }

  perchIdle(dt, env) {
    this.perchClock += dt;
    this.gaitPhase += dt * 0.9;
    if (this.perchClock > this.stateDur) { this.takeoff(env, false); return; }
    const roll = Math.random();
    const walkDrive = 1 + (env.brain.rates.walk || 0) / 10;
    if (roll < dt * 0.10) {
      this.state = 'GROOM'; this.subT = rand(2, 4.5);
    } else if (roll < dt * (0.10 + 0.07 * walkDrive)) {
      this.state = 'WALK'; this.subT = rand(1.5, 4);
      this.walkDir = Math.random() < 0.5 ? -1 : 1;
    }
  }

  walk(dt) {
    this.perchClock += dt; this.subT -= dt;
    this.gaitPhase += dt * 8;
    const l = this.perch.ledge;
    const len = Math.max(ledgeLen(l), 24);
    const margin = 10 / len;
    this.perch.u = clamp(this.perch.u + (16 * dt / len) * this.walkDir, margin, 1 - margin);
    if (this.perch.u <= margin + 1e-4 || this.perch.u >= 1 - margin - 1e-4) this.walkDir *= -1;
    const td = this.touchXY();
    this.x = td.x; this.y = td.y;
    let dir;
    if (l.dir === 'h') dir = this.walkDir > 0 ? 0 : Math.PI;
    else dir = this.walkDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.heading += angNorm(dir - this.heading) * Math.min(1, dt * 6);
    if (this.subT <= 0) this.state = 'PERCH';
  }

  groomStep(dt) {
    this.perchClock += dt; this.subT -= dt;
    this.groomPhase += dt * 5.5;
    if (this.subT <= 0) this.state = 'PERCH';
  }

  takeoff(env, escape) {
    let dx, dy;
    if (escape) {
      dx = this.x - env.cursor.x; dy = this.y - env.cursor.y;
    } else if (this.perch) {
      const l = this.perch.ledge;
      if (l.dir === 'h') { dx = rand(-0.6, 0.6); dy = -1; }
      else { dx = this.perch.side; dy = rand(-0.6, -0.1); }
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
    if (k >= 1) {
      this.vx = this.launchVx; this.vy = this.launchVy;
      this.state = 'CRUISE'; this.t = 0; this.stateDur = rand(3, 10);
      this.perch = null;
    }
  }

  pose() {
    let legMode = 'tucked';
    if (this.state === 'PERCH') legMode = 'stand';
    else if (this.state === 'WALK') legMode = 'walk';
    else if (this.state === 'GROOM') legMode = 'groom';
    else if (this.state === 'LAND') legMode = this.t > 0.08 ? 'stand' : 'tucked';
    else if (this.state === 'TAKEOFF') legMode = 'stand';
    return {
      x: this.x, y: this.y, heading: this.heading, z: this.z,
      wingPhase: this.wingPhase, wingFold: this.wingFold,
      legMode, gaitPhase: this.gaitPhase, groomPhase: this.groomPhase,
      scale: this.pinScale || 1,
    };
  }

  // static poses for art iteration via DESKFLY_POSE
  pin(name, env, t) {
    this.x = env.w / 2; this.y = env.h / 2;
    this.heading = -0.6;
    if (name === 'flight') {
      this.state = 'CRUISE'; this.z = 1; this.wingFold = 0; this.wingPhase = t * 135 * TAU;
    } else if (name === 'walk') {
      this.state = 'WALK'; this.z = 0; this.wingFold = 1; this.gaitPhase = t * 8;
    } else if (name === 'groom') {
      this.state = 'GROOM'; this.z = 0; this.wingFold = 1; this.groomPhase = t * 5.5;
    } else {
      this.state = 'PERCH'; this.z = 0; this.wingFold = 1; this.gaitPhase = t * 0.9;
    }
  }
}

module.exports = { Fly };
