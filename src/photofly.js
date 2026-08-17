// Photo-based fly renderer. Top-down view (real dorsal photo body + head,
// vector legs and wings) while flying, on the ground, or clinging to a
// vertical wall; side view (real profile photo) when perched on top of a
// horizontal wall, with procedural forelegs for rubbing and eye-wiping and a
// proboscis for feeding. Falls back to the vector fly when sprites are absent.

const fs = require('fs');
const path = require('path');
const { drawLegs, drawWings } = require('./sprite.js');

const TAU = Math.PI * 2;
const OVERLAP_SRC = 115;      // body-over-head seam overlap, source px
const SIDE_BODY_FRAC = 0.75;  // body length / side-sprite width
const SIDE_CENTER_X = 0.385;  // body centre x in the side sprite
const SIDE_FEET_Y = 0.965;    // feet line y in the side sprite
const SIDE_SHOULDER = [0.185, 0.70]; // front coxa, under the thorax
const SIDE_EYE = [0.055, 0.42];
const SIDE_MOUTH = [0.08, 0.63];

function mipTo(img, tw, th) {
  let src = img;
  let w = src.width, h = src.height;
  while (w / 2 >= tw * 2 && h / 2 >= th * 2) {
    const c = document.createElement('canvas');
    c.width = Math.round(w / 2);
    c.height = Math.round(h / 2);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    src = c; w = c.width; h = c.height;
  }
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(tw));
  out.height = Math.max(1, Math.round(th));
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

class PhotoFly {
  constructor(dir, manifest, bodyLen, dpr) {
    this.manifest = manifest;
    this.bodyLen = bodyLen;
    this.dpr = dpr;
    this.unit = bodyLen / 25;
    this.sideMix = 0;
    this.lastT = 0;
    this.ready = false;
    this.load(dir);
  }

  async load(dir) {
    const m = this.manifest;
    this.totalSrc = m.body.w + m.head.w - OVERLAP_SRC;
    this.pxToPt = this.bodyLen / this.totalSrc;
    const k = this.pxToPt * this.dpr * 2.2;
    this.parts = {};
    for (const role of ['body', 'head', 'side']) {
      if (!m[role]) continue;
      const img = new Image();
      img.src = 'file://' + path.join(dir, m[role].file);
      await img.decode();
      const kk = role === 'side'
        ? ((this.bodyLen / SIDE_BODY_FRAC) / m.side.w) * this.dpr * 2.2
        : k;
      this.parts[role] = mipTo(img, m[role].w * kk, m[role].h * kk);
    }
    this.ready = true;
  }

  draw(ctx, p) {
    if (!this.ready) return false;
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - this.lastT);
    this.lastT = now;
    const wantSide = p.perchDir === 'h' && p.wingFold > 0.6 && this.parts.side ? 1 : 0;
    this.sideMix += (wantSide - this.sideMix) * Math.min(1, dt * 9);

    const s = (p.scale || 1) * (1 + 0.16 * p.z);
    this.shadow(ctx, p, s);
    if (this.sideMix < 0.98) {
      ctx.save();
      ctx.globalAlpha = 1 - this.sideMix;
      this.drawTop(ctx, p, s);
      ctx.restore();
    }
    if (this.sideMix > 0.02) {
      ctx.save();
      ctx.globalAlpha = this.sideMix;
      this.drawSide(ctx, p, s);
      ctx.restore();
    }
    return true;
  }

  drawTop(ctx, p, s) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.heading);
    const bob = p.legMode === 'walk' ? Math.sin(p.gaitPhase * 2) * 0.025
      : p.legMode === 'stand' ? Math.sin(p.gaitPhase * TAU * 0.25) * 0.012 : 0;
    ctx.scale(s * (1 + bob), s * (1 + bob));

    ctx.save();
    ctx.scale(this.unit, this.unit);
    drawLegs(ctx, p);
    ctx.restore();

    const mB = this.manifest.body, mH = this.manifest.head;
    const L = this.bodyLen;
    ctx.imageSmoothingQuality = 'high';
    const headX = -L / 2 + (mB.w - OVERLAP_SRC) * this.pxToPt;
    ctx.drawImage(this.parts.head,
      headX, -mH.h * this.pxToPt / 2,
      mH.w * this.pxToPt, mH.h * this.pxToPt);
    ctx.drawImage(this.parts.body,
      -L / 2, -mB.h * this.pxToPt / 2,
      mB.w * this.pxToPt, mB.h * this.pxToPt);

    ctx.save();
    ctx.scale(this.unit, this.unit);
    drawWings(ctx, p);
    ctx.restore();
    ctx.restore();
  }

  drawSide(ctx, p, s) {
    const m = this.manifest.side;
    const facingRight = Math.cos(p.heading) >= 0;
    const drawnW = (this.bodyLen / SIDE_BODY_FRAC) * s;
    const drawnH = drawnW * (m.h / m.w);
    const feetY = p.y + Math.max(1.2, 2.5 * (this.bodyLen / 25));
    const bob = p.legMode === 'walk' ? Math.sin(p.gaitPhase * 2) * drawnH * 0.02
      : Math.sin(p.gaitPhase * TAU * 0.25) * drawnH * 0.008;

    ctx.save();
    ctx.translate(p.x, feetY + bob);
    if (facingRight) ctx.scale(-1, 1); // photo faces left
    if (p.legMode === 'walk') ctx.rotate(Math.sin(p.gaitPhase * 2) * 0.02);
    const x0 = -drawnW * SIDE_CENTER_X;
    const y0 = -drawnH * SIDE_FEET_Y;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.parts.side, x0, y0, drawnW, drawnH);

    const sx = (fx) => x0 + fx * drawnW;
    const sy = (fy) => y0 + fy * drawnH;

    if (p.proboscis > 0.05) {
      ctx.strokeStyle = 'rgba(45,38,32,0.9)';
      ctx.lineCap = 'round';
      ctx.lineWidth = drawnW * 0.018;
      ctx.beginPath();
      ctx.moveTo(sx(SIDE_MOUTH[0]), sy(SIDE_MOUTH[1]));
      const px2 = sx(SIDE_MOUTH[0] + 0.02);
      const pyG = -bob - drawnH * 0.005;
      ctx.quadraticCurveTo(sx(SIDE_MOUTH[0]) - drawnW * 0.02, sy(SIDE_MOUTH[1]) * 0.4 + pyG * 0.6,
        px2 * p.proboscis + sx(SIDE_MOUTH[0]) * (1 - p.proboscis),
        pyG * p.proboscis + sy(SIDE_MOUTH[1]) * (1 - p.proboscis));
      ctx.stroke();
      // labellum pad
      ctx.fillStyle = 'rgba(70,52,40,0.9)';
      ctx.beginPath();
      ctx.ellipse(px2 * p.proboscis + sx(SIDE_MOUTH[0]) * (1 - p.proboscis),
        pyG * p.proboscis + sy(SIDE_MOUTH[1]) * (1 - p.proboscis),
        drawnW * 0.022, drawnW * 0.012, 0, 0, TAU);
      ctx.fill();
    }

    if (p.legMode === 'groom') this.drawGroomLegs(ctx, p, drawnW, drawnH, sx, sy);
    ctx.restore();
  }

  // the mischievous bit: articulated forelegs rub together, then wipe the eye.
  // Each leg is femur + tibia solved by two-bone IK from the shoulder, with a
  // three-segment tarsus curling past the contact point; the tarsi are what
  // slide over each other during the rub.
  drawGroomLegs(ctx, p, drawnW, drawnH, sx, sy) {
    const W = drawnW, H = drawnH;
    const cyc = (p.groomPhase / 13) % 2;
    const ss = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const wipeK = cyc < 1 ? ss(0.86, 1, cyc) : 1 - ss(1.86, 2, cyc);

    for (const leg of [1, 0]) {
      const shX = sx(SIDE_SHOULDER[0]) + (leg ? 0.014 * W : 0);
      const shY = sy(SIDE_SHOULDER[1]) + (leg ? -0.010 * H : 0);
      const femur = 0.13 * W, tibia = 0.13 * W, tarSeg = 0.022 * W;

      const ph = p.groomPhase * 2.2 + leg * Math.PI;
      const slide = Math.sin(ph);
      const rubX = sx(0.055) + slide * 0.016 * W + (leg ? 0.006 : -0.006) * W;
      const rubY = sy(0.66) + slide * 0.030 * H + Math.cos(ph) * 0.008 * H;

      const eyeX = sx(SIDE_EYE[0] + 0.01), eyeY = sy(SIDE_EYE[1] + 0.03);
      const re = (0.068 + leg * 0.008) * W;
      const k = (Math.sin(p.groomPhase * 1.4 + leg * 0.7) + 1) / 2;
      const a = (0.62 + 0.88 * k) * Math.PI;
      const wipeX = eyeX + Math.cos(a) * re, wipeY = eyeY + Math.sin(a) * re;

      const tipX = rubX + (wipeX - rubX) * wipeK;
      const tipY = rubY + (wipeY - rubY) * wipeK;

      // two-bone IK; elbow-down, the posture flies rub and wipe in
      let dx = tipX - shX, dy = tipY - shY;
      let d = Math.hypot(dx, dy) || 1e-6;
      const dc = Math.min(femur + tibia - 1e-4, Math.max(Math.abs(femur - tibia) + 1e-4, d));
      dx *= dc / d; dy *= dc / d; d = dc;
      const along = (femur * femur - tibia * tibia + d * d) / (2 * d);
      const out = Math.sqrt(Math.max(0, femur * femur - along * along));
      const mx = shX + dx * (along / d), my = shY + dy * (along / d);
      const s1x = mx - (dy / d) * out, s1y = my + (dx / d) * out;
      const s2x = mx + (dy / d) * out, s2y = my - (dx / d) * out;
      const kneeX = s1y >= s2y ? s1x : s2x;
      const kneeY = s1y >= s2y ? s1y : s2y;
      const footX = shX + dx, footY = shY + dy;

      const wMul = leg ? 0.85 : 1;
      ctx.globalAlpha = leg ? 0.72 : 1;
      ctx.lineCap = 'round';

      ctx.strokeStyle = '#2f2822';
      ctx.lineWidth = 0.016 * W * wMul;
      ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
      ctx.strokeStyle = '#262019';
      ctx.lineWidth = 0.0095 * W * wMul;
      ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();

      // tibial bristles
      if (!leg) {
        ctx.strokeStyle = 'rgba(24,20,16,0.8)';
        ctx.lineWidth = 0.0025 * W;
        const tnx = -(footY - kneeY), tny = footX - kneeX;
        const tn = Math.hypot(tnx, tny) || 1e-6;
        for (const f of [0.45, 0.72]) {
          const bx = kneeX + (footX - kneeX) * f, by = kneeY + (footY - kneeY) * f;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + (tnx / tn) * 0.013 * W, by + (tny / tn) * 0.013 * W);
          ctx.stroke();
        }
      }

      // tarsus: three segments curling inward past the contact point
      let tdir = Math.atan2(footY - kneeY, footX - kneeX);
      let curl;
      if (wipeK > 0.5) {
        const toEye = Math.atan2(eyeY - footY, eyeX - footX);
        let diff = toEye - tdir;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        curl = Math.sign(diff || 1) * 0.55;
      } else {
        curl = (leg ? -1 : 1) * (0.30 + 0.20 * Math.sin(ph + Math.PI / 2));
      }
      ctx.strokeStyle = '#1d1814';
      let px = footX, py = footY;
      for (let i = 0; i < 3; i++) {
        tdir += curl;
        const nx = px + Math.cos(tdir) * tarSeg * (1 - i * 0.18);
        const ny = py + Math.sin(tdir) * tarSeg * (1 - i * 0.18);
        ctx.lineWidth = (0.007 - i * 0.0013) * W * wMul;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
        px = nx; py = ny;
      }

      ctx.fillStyle = '#241e18';
      ctx.beginPath(); ctx.arc(kneeX, kneeY, 0.009 * W * wMul, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(footX, footY, 0.006 * W * wMul, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  shadow(ctx, p, s) {
    const a = 0.15 * (1 - 0.55 * p.z);
    if (a <= 0.015) return;
    const off = (1 + 8 * p.z) * s * (this.bodyLen / 26);
    const r = this.bodyLen * 0.5;
    ctx.save();
    ctx.translate(p.x + off * 0.5, p.y + off);
    ctx.scale(1, 0.55);
    ctx.rotate(this.sideMix > 0.5 ? 0 : p.heading);
    ctx.scale(s * 1.1, s * 0.6);
    const g = ctx.createRadialGradient(-r * 0.15, 0, 1, -r * 0.15, 0, r);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(-r * 0.15, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function loadPhotoFly(rootDir, bodyLen, dpr) {
  const dir = path.join(rootDir, 'sprites');
  const mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if (!manifest.body || !manifest.head) return null;
    return new PhotoFly(dir, manifest, bodyLen, dpr);
  } catch {
    return null;
  }
}

module.exports = { loadPhotoFly };
