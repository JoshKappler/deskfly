// The fly's 3D world, built from the desktop: the screen plane is a grass
// floor, every window edge stands on it as a wall, food sits in the grass,
// and the cursor stalks it as a dark predator. One renderer serves both the
// eye (gray spherical panorama) and the viewer window (color).

const WALL_H = 34;    // points
const CURSOR_H = 46;
const CURSOR_R = 9;
const AIR_ALT = 26;   // flying altitude above the floor

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

  for (let c = 0; c < w; c++) {
    const az = -Math.PI + ((c + 0.5) / w) * 2 * Math.PI;
    const dx = Math.cos(az), dy = Math.sin(az);
    hits.length = 0;
    for (let i = 0; i < world.walls.length; i++) {
      const s = world.walls[i];
      const ex = s.x1 - s.x0, ey = s.y1 - s.y0;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const px = s.x0 - fx, py = s.y0 - fy;
      const t = (px * ey - py * ex) / den;
      if (t < 1) continue;
      const u = (px * dy - py * dx) / -den;
      if (u < 0 || u > 1) continue;
      hits.push({ d: t, top: WALL_H, kind: s.kind, tex: hash2(i * 7.1, Math.floor(u * 40)) });
    }
    {
      const px = world.cursor.x - fx, py = world.cursor.y - fy;
      const proj = px * dx + py * dy;
      if (proj > 2) {
        const perp = Math.abs(px * -dy + py * dx);
        if (perp < CURSOR_R) hits.push({ d: proj, top: CURSOR_H, cursor: true, tex: 0.5 });
      }
    }
    hits.sort((a, b) => a.d - b.d);

    for (let r = 0; r < h; r++) {
      const el = Math.PI / 2 - ((r + 0.5) / h) * Math.PI;
      let g = 0, cr = 0, cg = 0, cb = 0;
      let done = false;
      for (const hit of hits) {
        const elTop = Math.atan2(hit.top - alt, hit.d);
        const elBot = Math.atan2(-alt, hit.d);
        if (el <= elTop && el >= elBot) {
          if (hit.cursor) { g = 16; cr = 42; cg = 36; cb = 40; }
          else {
            const shade = hit.tex * 22;
            if (hit.kind === 'input') { g = 78 + shade; cr = 116 + shade; cg = 106 + shade; cb = 158 + shade; }
            else { g = 58 + shade; cr = 112 + shade; cg = 86 + shade; cb = 58 + shade; }
          }
          done = true;
          break;
        }
        if (el > elTop) continue; // this hit is below the line of sight; nearer ones already checked
        break; // el < elBot: looking at ground in front of every remaining hit
      }
      if (!done) {
        if (el < -0.015) {
          const dg = Math.min(1400, alt / Math.tan(-el));
          const gx = fx + dx * dg, gy = fy + dy * dg;
          let food = false;
          for (const f of world.food) {
            const ddx = gx - f.x, ddy = gy - f.y;
            if (ddx * ddx + ddy * ddy < f.r * f.r) { food = true; break; }
          }
          if (food) { g = 235; cr = 224; cg = 128; cb = 58; }
          else {
            const n = hash2(Math.floor(gx / 7), Math.floor(gy / 7));
            g = 92 + n * 36;
            cr = 58 + n * 34; cg = 116 + n * 44; cb = 44 + n * 24;
          }
        } else {
          const t = Math.min(1, el / (Math.PI / 2));
          g = 235 - t * 30;
          cr = 205 - t * 70; cg = 228 - t * 30; cb = 242 - t * 10;
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
