// Cuts real fly photos into transparent sprites. Runs under Electron so we
// get image decoding without extra dependencies:
//   npx electron scripts/make-sprites.js
// Reads sprites.config.json, writes sprites/*.png and sprites/manifest.json.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'sprites.config.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'sprites');

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// sample the background colour from the four corners
function bgColor(px, w, h) {
  const pick = [];
  const spots = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]];
  for (const [x, y] of spots) {
    const i = (y * w + x) * 4;
    pick.push([px[i], px[i + 1], px[i + 2]]);
  }
  return [median(pick.map(p => p[0])), median(pick.map(p => p[1])), median(pick.map(p => p[2]))];
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function processEntry(e) {
  let img = nativeImage.createFromPath(path.join(ROOT, e.src));
  if (img.isEmpty()) throw new Error(`cannot read ${e.src}`);
  if (e.crop) img = img.crop({ x: e.crop[0], y: e.crop[1], width: e.crop[2], height: e.crop[3] });
  let { width: w, height: h } = img.getSize();

  // work at most at 2048 on the long side
  const maxIn = 2048;
  let k = 1;
  if (Math.max(w, h) > maxIn) {
    k = maxIn / Math.max(w, h);
    img = img.resize({ width: Math.round(w * k), height: Math.round(h * k), quality: 'best' });
    ({ width: w, height: h } = img.getSize());
  }
  // polygons in original-image pixels (default) or working pixels
  const working = e.coordSpace === 'working';
  const mapPoly = (poly) => poly.map(([x, y]) => working ? [x, y] : [
    (x - (e.crop ? e.crop[0] : 0)) * k,
    (y - (e.crop ? e.crop[1] : 0)) * k,
  ]);
  const mapY = (y) => working ? y : (y - (e.crop ? e.crop[1] : 0)) * k;
  const sil = e.silhouette ? mapPoly(e.silhouette) : null;
  const masks = (e.maskPolys || []).map(mapPoly);
  const protects = (e.protectPolys || []).map(mapPoly);

  if (process.env.SPRITES_DEBUG) {
    const dbg = Buffer.from(img.toBitmap());
    const put = (x, y, r, g, b) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      dbg[i] = b; dbg[i + 1] = g; dbg[i + 2] = r; dbg[i + 3] = 255;
    };
    for (let y = 0; y < h; y += 100) for (let x = 0; x < w; x++) put(x, y, 0, y % 500 ? 180 : 255, 0);
    for (let x = 0; x < w; x += 100) for (let y = 0; y < h; y++) put(x, y, 0, x % 500 ? 180 : 255, 0);
    const strokePoly = (poly, r, g, b) => {
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
        const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
        for (let t = 0; t <= n; t++) {
          const x = x1 + ((x2 - x1) * t) / n, y = y1 + ((y2 - y1) * t) / n;
          for (let d = -1; d <= 1; d++) { put(x + d, y, r, g, b); put(x, y + d, r, g, b); }
        }
      }
    };
    if (sil) strokePoly(sil, 255, 0, 255);
    for (const m of masks) strokePoly(m, 255, 120, 0);
    if (e.mirrorAxisYOrig) {
      const yA = mapY(e.mirrorAxisYOrig);
      for (let x = 0; x < w; x++) { put(x, yA, 0, 220, 255); put(x, yA + 1, 0, 220, 255); }
    }
    fs.writeFileSync(path.join(OUT_DIR, `debug-${e.role}.png`),
      nativeImage.createFromBitmap(dbg, { width: w, height: h }).toPNG());
  }

  const px = Buffer.from(img.toBitmap()); // BGRA
  const polyOnly = e.bg === 'poly';
  let bg = null;
  if (e.bg === 'corner') {
    if (e.bgPoint) {
      const bx = Math.round(e.coordSpace === 'working' ? e.bgPoint[0] : (e.bgPoint[0] - (e.crop ? e.crop[0] : 0)) * k);
      const by = Math.round(e.coordSpace === 'working' ? e.bgPoint[1] : (e.bgPoint[1] - (e.crop ? e.crop[1] : 0)) * k);
      const i = (by * w + bx) * 4;
      bg = [px[i + 2], px[i + 1], px[i]];
    } else {
      bg = bgColor(px, w, h);
    }
  }
  const t0 = e.t0 ?? 22;
  const t1 = e.t1 ?? 70;

  if (polyOnly || bg) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let a;
        if (sil && !pointInPoly(x, y, sil)) a = 0;
        else if (masks.some((m) => pointInPoly(x, y, m))) a = 0;
        else if (polyOnly) a = 1;
        else {
          const d = Math.hypot(px[i] - bg[2], px[i + 1] - bg[1], px[i + 2] - bg[0]);
          a = (d - t0) / (t1 - t0);
          a = a < 0 ? 0 : a > 1 ? 1 : a;
          // translucent parts (wings) keep a floor alpha inside protect polys
          if (a < 0.55 && protects.some((m) => pointInPoly(x, y, m))) a = Math.max(a, 0.55);
        }
        px[i + 3] = Math.round(a * 255);
      }
    }

    if (process.env.SPRITES_DEBUG) {
      let zeros = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] === 0) zeros++;
      console.log(`  [${e.role}] bg=${bg} matte zeros: ${zeros}/${w * h}`);
    }

    // mirror one clean half across the axis for a symmetric subject
    if (e.mirrorAxisYOrig) {
      const yA = Math.round(mapY(e.mirrorAxisYOrig));
      if (e.mirrorFrom === 'bottom') {
        for (let y = yA - 1; y >= 0; y--) {
          const ys = 2 * yA - y;
          if (ys >= h) { px.fill(0, y * w * 4, (y + 1) * w * 4); continue; }
          px.copy(px, y * w * 4, ys * w * 4, (ys + 1) * w * 4);
        }
      } else {
        for (let y = yA + 1; y < h; y++) {
          const ys = 2 * yA - y;
          if (ys < 0) { px.fill(0, y * w * 4, (y + 1) * w * 4); continue; }
          px.copy(px, y * w * 4, ys * w * 4, (ys + 1) * w * 4);
        }
      }
    }

    // feather: 3x3 box blur on alpha
    const src = Buffer.from(px);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) s += src[((y + dy) * w + (x + dx)) * 4 + 3];
        }
        px[(y * w + x) * 4 + 3] = Math.round(s / 9);
      }
    }
    // pull background tint out of edge pixels, damped so colours stay sane
    if (bg) {
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3] / 255;
        if (a > 0.02 && a < 0.98) {
          for (let c = 0; c < 3; c++) {
            const v = px[i + c] - bg[2 - c] * (1 - a) * 0.5;
            px[i + c] = v < 0 ? 0 : Math.round(v);
          }
        } else if (a <= 0.02) {
          px[i + 3] = 0;
        }
      }
    }
    // optional colour grade
    if (e.desat || e.brightness) {
      const ds = e.desat || 0;
      const br = e.brightness ?? 1;
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const g = 0.11 * px[i] + 0.59 * px[i + 1] + 0.30 * px[i + 2];
        for (let c = 0; c < 3; c++) {
          const v = (g + (px[i + c] - g) * (1 - ds)) * br;
          px[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        }
      }
    }
  }

  // trim to the alpha bounding box (with margin)
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX >= maxX) throw new Error(`${e.src}: matte removed everything (tune t0/t1)`);
  const m = 4;
  minX = Math.max(0, minX - m); minY = Math.max(0, minY - m);
  maxX = Math.min(w - 1, maxX + m); maxY = Math.min(h - 1, maxY + m);
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  const cut = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    px.copy(cut, y * tw * 4, ((y + minY) * w + minX) * 4, ((y + minY) * w + minX + tw) * 4);
  }

  // createFromBitmap expects premultiplied BGRA
  for (let i = 0; i < cut.length; i += 4) {
    const a = cut[i + 3] / 255;
    if (a < 1) {
      cut[i] = Math.round(cut[i] * a);
      cut[i + 1] = Math.round(cut[i + 1] * a);
      cut[i + 2] = Math.round(cut[i + 2] * a);
    }
  }
  let out = nativeImage.createFromBitmap(cut, { width: tw, height: th });
  const maxOut = e.maxSize ?? 768;
  if (Math.max(tw, th) > maxOut) {
    const k = maxOut / Math.max(tw, th);
    out = out.resize({ width: Math.round(tw * k), height: Math.round(th * k), quality: 'best' });
  }
  const size = out.getSize();
  fs.writeFileSync(path.join(OUT_DIR, e.out), out.toPNG());
  console.log(`${e.out}: ${size.width}x${size.height} from ${e.src}`);
  return {
    file: e.out,
    w: size.width,
    h: size.height,
    // heading correction: degrees to add so the fly points along +x
    angleOffset: e.angleOffset ?? 0,
    // body length in source pixels along the long axis, as a fraction of it
    bodyLenFrac: e.bodyLenFrac ?? 1.0,
    extra: e.extra || {},
    role: e.role,
  };
}

app.whenReady().then(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = {};
  for (const e of CONFIG) {
    try {
      manifest[e.role] = processEntry(e);
    } catch (err) {
      console.error(`FAIL ${e.src}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('wrote sprites/manifest.json');
  app.quit();
});
