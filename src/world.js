// The fly's 3D world, built from the desktop: the screen plane is a grass
// floor, every window edge stands on it as a line of trees it can land on,
// food sits in the grass as berries, and the cursor stalks it as a dark
// predator. One renderer serves both the eye (gray spherical panorama) and
// the viewer window (color).

const WALL_H = 34;    // points; collision height and the treetop line
const CURSOR_H = 46;
const CURSOR_R = 9;
const AIR_ALT = 26;   // flying altitude above the floor
const TREE_SP = 30;   // trunk spacing along a wall

const SUN_AZ = -2.3, SUN_EL = 0.85;
const SUN_SIN = Math.sin(SUN_EL), SUN_COS = Math.cos(SUN_EL);

function hash2(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

class World {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.walls = [];
    this.food = [];
    this.cursor = { x: -1e4, y: -1e4 };
  }

  setLedges(ledges) {
    this.walls = ledges.map((l) => (l.dir === 'h'
      ? { x0: l.x0, y0: l.y, x1: l.x1, y1: l.y, kind: l.kind }
      : { x0: l.x, y0: l.y0, x1: l.x, y1: l.y1, kind: l.kind }));
  }
}

// out.data: Uint8Array (w*h) when color is false, Uint8ClampedArray (w*h*4)
// when true. Panorama spans az -PI..PI (world frame), el +PI/2 (top row)
// down to -PI/2.
function renderPano(world, fly, out, color) {
  const { w, h } = out;
  const alt = fly.alt !== undefined ? fly.alt : 2 + (fly.z || 0) * AIR_ALT;
  const fx = fly.x, fy = fly.y;
  const hits = [];

  const tanEl = new Float64Array(h), sinEl = new Float64Array(h);
  const cosEl = new Float64Array(h), skyT = new Float64Array(h);
  for (let r = 0; r < h; r++) {
    const el = Math.PI / 2 - ((r + 0.5) / h) * Math.PI;
    tanEl[r] = Math.tan(el);
    sinEl[r] = Math.sin(el);
    cosEl[r] = Math.cos(el);
    skyT[r] = Math.min(1, Math.max(0, el / (Math.PI / 2)));
  }
  const wallLen = world.walls.map((s) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0));

  for (let c = 0; c < w; c++) {
    const az = -Math.PI + ((c + 0.5) / w) * 2 * Math.PI;
    const dx = Math.cos(az), dy = Math.sin(az);
    const sunDAz = Math.cos(az - SUN_AZ);
    hits.length = 0;
    for (let i = 0; i < world.walls.length; i++) {
      const s = world.walls[i];
      if (wallLen[i] < 1) continue;
      const ex = s.x1 - s.x0, ey = s.y1 - s.y0;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const px = s.x0 - fx, py = s.y0 - fy;
      const t = (px * ey - py * ex) / den;
      if (t < 1) continue;
      const u = (px * dy - py * dx) / -den;
      if (u < 0 || u > 1) continue;
      hits.push({ d: t, s: u * wallLen[i], wi: i, kind: s.kind, cursor: false, perp: 0 });
    }
    {
      const px = world.cursor.x - fx, py = world.cursor.y - fy;
      const proj = px * dx + py * dy;
      if (proj > 2) {
        const perp = Math.abs(px * -dy + py * dx);
        if (perp < CURSOR_R) hits.push({ d: proj, s: 0, wi: -1, kind: '', cursor: true, perp });
      }
    }
    hits.sort((a, b) => a.d - b.d);

    for (let r = 0; r < h; r++) {
      const tanE = tanEl[r];
      let g = 0, cr = 0, cg = 0, cb = 0;
      let done = false;

      for (const hit of hits) {
        const hgt = alt + tanE * hit.d;
        if (hgt < 0) break; // the ground is in front of this and all farther hits

        if (hit.cursor) {
          const k = hit.perp / CURSOR_R;
          const topH = 6 + (CURSOR_H - 6) * Math.sqrt(1 - k * k);
          if (hgt > topH) continue;
          const legTop = CURSOR_H * 0.34;
          if (hgt > legTop || topH < legTop) {
            const l = hgt / CURSOR_H;
            cr = 38 + l * 26; cg = 32 + l * 22; cb = 36 + l * 24;
            g = 13 + l * 11;
          } else {
            if (Math.abs((hit.perp % 3.2) - 1.6) > 0.75) continue;
            cr = 28; cg = 24; cb = 26; g = 11;
          }
          done = true;
          break;
        }

        const cell = Math.floor(hit.s / TREE_SP);
        const local = hit.s - cell * TREE_SP;
        const h1 = hash2(cell, hit.wi * 3.7);
        const h2 = hash2(cell, hit.wi * 3.7 + 9);
        const canopyBot = (8 + 4 * h1) * (0.7 + 0.5 * Math.sin(Math.PI * local / TREE_SP));
        const peak = WALL_H - 3 + 7 * h2;
        const edgeK = Math.sin(Math.PI * local / TREE_SP);
        const bump = 0.8 + 0.2 * hash2(Math.floor(hit.s / 2.6), hit.wi + 40);
        const topHere = canopyBot + (peak - canopyBot) * (0.30 + 0.70 * edgeK) * bump;

        if (hgt > topHere) continue;
        if (hgt > canopyBot) {
          const n = hash2(Math.floor(hit.s / 1.7), Math.floor(hgt / 1.7));
          if (n > 0.94 && hgt > topHere - 3) continue; // ragged canopy edge
          const light = 0.45 + 0.55 * Math.min(1, hgt / peak);
          if (hit.kind === 'input' && n > 0.80 && n < 0.88) {
            cr = 216; cg = 170; cb = 190; g = 150; // text inputs blossom
          } else {
            cr = (34 + n * 30) * light + 8;
            cg = (88 + n * 44) * light + 10;
            cb = (26 + n * 22) * light + 6;
            g = 38 + n * 32 + light * 26;
          }
        } else {
          const tc = TREE_SP * (0.38 + 0.24 * h1);
          if (Math.abs(local - tc) > 1.3 + 1.1 * h2) continue; // between trunks
          const bark = hash2(Math.floor(hit.s * 2.3), Math.floor(hgt / 2.2));
          cr = 88 + bark * 30; cg = 66 + bark * 22; cb = 46 + bark * 16;
          g = 50 + bark * 20;
        }
        done = true;
        break;
      }

      if (!done) {
        if (tanE < -0.015) {
          const dg = Math.min(1600, alt / -tanE);
          const gx = fx + dx * dg, gy = fy + dy * dg;
          let q = 1;
          for (const f of world.food) {
            const ddx = gx - f.x, ddy = gy - f.y;
            const qq = (ddx * ddx + ddy * ddy) / (f.r * f.r);
            if (qq < q) q = qq;
          }
          if (q < 1) {
            const t = 1 - q;
            cr = 150 + 96 * t; cg = 34 + 44 * t; cb = 44 + 34 * t;
            if (q < 0.10) { cr = 255; cg = 216; cb = 205; }
            g = 140 + 90 * t;
          } else {
            const patch = hash2(Math.floor(gx / 26), Math.floor(gy / 26));
            const wave = hash2(Math.floor(gx / 90), Math.floor(gy / 90));
            const fs = 3.5 * (1 + dg / 140); // noise cells grow with distance
            const fine = hash2(Math.floor(gx / fs), Math.floor(gy / fs));
            cr = 40 + patch * 22 + wave * 10 + (fine - 0.5) * 18;
            cg = 92 + patch * 24 + wave * 14 + (fine - 0.5) * 30;
            cb = 30 + patch * 9 + wave * 5 + (fine - 0.5) * 12;
            g = 76 + patch * 20 + wave * 8 + (fine - 0.5) * 24;
            if (dg < 130 && hash2(Math.floor(gx / 1.3), Math.floor(gy / 1.3)) > 0.8) {
              cr -= 14; cg -= 16; cb -= 8; g -= 12; // near-field blades
            }
          }
          const fog = Math.pow(Math.min(1, dg / 1150), 1.4) * 0.62;
          cr += (170 - cr) * fog; cg += (198 - cg) * fog; cb += (208 - cb) * fog;
          g += (170 - g) * fog;
        } else {
          const t = skyT[r];
          cr = 198 - 92 * t; cg = 221 - 64 * t; cb = 239 - 16 * t;
          const cosd = sinEl[r] * SUN_SIN + cosEl[r] * SUN_COS * sunDAz;
          if (cosd > 0.9972) {
            cr = 255; cg = 248; cb = 222; g = 236;
          } else {
            const glow = Math.pow(Math.max(0, cosd), 24) * 0.55;
            cr += (255 - cr) * glow; cg += (244 - cg) * glow; cb += (208 - cb) * glow;
            g = 210 - t * 44 + glow * 30;
          }
        }
      }

      if (color) {
        const o = (r * w + c) * 4;
        out.data[o] = cr; out.data[o + 1] = cg; out.data[o + 2] = cb; out.data[o + 3] = 255;
      } else {
        out.data[r * w + c] = g;
      }
    }
  }
}

module.exports = { World, renderPano, WALL_H, AIR_ALT };
