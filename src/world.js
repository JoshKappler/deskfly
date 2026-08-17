// The fly's 3D world, built from the desktop: the screen plane is a grass
// floor and every window edge is a line of trees with landable branches.
// Tree shapes derive deterministically from wall geometry, so the behavior
// layer (perches), the eye and the viewer all agree on the same forest.

const WALL_H = 34;    // points; nominal treetop line, collision height
const TREE_SP = 26;   // trunk spacing along a wall

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

// One wall -> its row of trees. Seeded by quantized world position, not by
// array index, so the forest is stable across perch rescans and identical
// in every process that calls this.
function treesForWall(wall) {
  const ex = wall.x1 - wall.x0, ey = wall.y1 - wall.y0;
  const len = Math.hypot(ex, ey);
  if (len < 18) return [];
  const ux = ex / len, uy = ey / len;
  const trees = [];
  const n = Math.max(1, Math.round(len / TREE_SP));
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * (len / n);
    const px = wall.x0 + ux * s, py = wall.y0 + uy * s;
    const qx = Math.round(px / 4), qy = Math.round(py / 4);
    const h1 = hash2(qx, qy);
    const h2 = hash2(qx + 7, qy - 3);
    const jitter = (h1 - 0.5) * 8;
    const x = px + ux * jitter, y = py + uy * jitter;
    const trunkH = 15 + h2 * 8;
    const canopyR = 8 + h1 * 4.5;
    const top = trunkH + canopyR * 1.55;
    const branches = [];
    const nb = 2 + (h2 > 0.55 ? 1 : 0);
    for (let b = 0; b < nb; b++) {
      const hb = hash2(qx + b * 13, qy - b * 7 + 31);
      const alt0 = 8 + (trunkH - 5) * ((b + 0.3 + hb * 0.6) / nb);
      const side = b % 2 ? 1 : -1;
      const ang = Math.atan2(uy, ux) + side * (0.5 + hb * 1.1);
      const blen = 8 + hb * 7;
      branches.push({
        x0: x, y0: y, alt0,
        x1: x + Math.cos(ang) * blen,
        y1: y + Math.sin(ang) * blen,
        alt1: alt0 + 2 + hb * 3.5,
      });
    }
    trees.push({ x, y, ux, uy, trunkH, canopyR, top, kind: wall.kind, branches, seed: h1 });
  }
  return trees;
}

function wallFromLedge(l) {
  return l.dir === 'h'
    ? { x0: l.x0, y0: l.y, x1: l.x1, y1: l.y, kind: l.kind }
    : { x0: l.x, y0: l.y0, x1: l.x, y1: l.y1, kind: l.kind };
}

// Landable branch tips, shaped as tiny horizontal ledges with an altitude so
// the existing perch machinery (walk along, side view, groom) just works.
function branchLedges(ledges) {
  const out = [];
  for (const l of ledges) {
    if (l.dir !== 'h' && l.dir !== 'v') continue;
    for (const t of treesForWall(wallFromLedge(l))) {
      for (const b of t.branches) {
        const xa = Math.min(b.x0, b.x1), xb = Math.max(b.x0, b.x1);
        out.push({
          dir: 'h',
          x0: xa, x1: Math.max(xb, xa + 8),
          y: (b.y0 + b.y1) / 2,
          kind: 'branch',
          alt: (b.alt0 + b.alt1) / 2,
        });
      }
    }
  }
  return out;
}

// Nearest tree on a ledge to a point along it; gives treetop perches a real
// altitude and a trunk to sit over.
function nearestTree(ledge, x, y) {
  let best = null, bd = Infinity;
  for (const t of treesForWall(wallFromLedge(ledge))) {
    const d = (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

module.exports = { World, treesForWall, branchLedges, nearestTree, hash2, WALL_H, TREE_SP };
