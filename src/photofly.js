// Photo-based fly renderer: real photograph body and head (sprites/, built
// by scripts/make-sprites.js) composed with the vector legs and wings from
// sprite.js, which animate and stay translucent. Falls back to the all-vector
// fly when sprites are absent.

const fs = require('fs');
const path = require('path');
const { drawLegs, drawWings } = require('./sprite.js');

const TAU = Math.PI * 2;
// source pixels of overlap where the body's front fringe covers the head seam
const OVERLAP_SRC = 115;

// halve repeatedly, then finish with one high-quality step
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
    this.unit = bodyLen / 25; // vector fly units -> points
    this.ready = false;
    this.load(dir);
  }

  async load(dir) {
    const m = this.manifest;
    if (!m.body || !m.head) return;
    this.totalSrc = m.body.w + m.head.w - OVERLAP_SRC;
    this.pxToPt = this.bodyLen / this.totalSrc;
    const k = this.pxToPt * this.dpr * 2.2;
    this.parts = {};
    for (const role of ['body', 'head']) {
      const img = new Image();
      img.src = 'file://' + path.join(dir, m[role].file);
      await img.decode();
      this.parts[role] = mipTo(img, m[role].w * k, m[role].h * k);
    }
    this.ready = true;
  }

  draw(ctx, p) {
    if (!this.ready) return false;
    const s = (p.scale || 1) * (1 + 0.16 * p.z);
    this.shadow(ctx, p, s);

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
    return true;
  }

  shadow(ctx, p, s) {
    const a = 0.15 * (1 - 0.55 * p.z);
    if (a <= 0.015) return;
    const off = (1 + 8 * p.z) * s * (this.bodyLen / 26);
    const r = this.bodyLen * 0.5;
    ctx.save();
    ctx.translate(p.x + off * 0.5, p.y + off);
    ctx.scale(1, 0.55);
    ctx.rotate(p.heading);
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
