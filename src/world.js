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
      ? { x0: l.x0, y0: l.y, x1: l.x1, y1: l.y, kind: l.kind, wid: l.wid, eid: l.eid, ox: l.ox }
      : { x0: l.x, y0: l.y0, x1: l.x, y1: l.y1, kind: l.kind, wid: l.wid, eid: l.eid, ox: l.ox }));
  }
}

// One wall -> its row of trees, on a fixed grid anchored at the owning
// window's edge origin and seeded by (window id, edge, slot). A moved window
// therefore carries the same grove; occlusion just masks which slots show.
// Walls without an id (an old helper binary) fall back to position seeding.
function treesForWall(wall) {
  const horiz = wall.y0 === wall.y1;
  const a0 = horiz ? Math.min(wall.x0, wall.x1) : Math.min(wall.y0, wall.y1);
  const a1 = horiz ? Math.max(wall.x0, wall.x1) : Math.max(wall.y0, wall.y1);
  if (a1 - a0 < 18) return [];
  const ux = horiz ? 1 : 0, uy = horiz ? 0 : 1;
  const keyed = wall.wid !== undefined;
  const ox = keyed && wall.ox !== undefined ? wall.ox : 0;
  const trees = [];
  const k0 = Math.floor((a0 - ox) / TREE_SP), k1 = Math.ceil((a1 - ox) / TREE_SP);
  for (let k = k0; k <= k1; k++) {
    const center = ox + (k + 0.5) * TREE_SP;
    let sA, sB;
    if (keyed) {
      sA = wall.wid * 0.731 + wall.eid * 131.7 + k * 13.1;
      sB = k * 7.7 - wall.eid * 3.3;
    } else {
      const px = horiz ? center : wall.x0, py = horiz ? wall.y0 : center;
      sA = Math.round(px / 4); sB = Math.round(py / 4);
    }
    const h1 = hash2(sA, sB);
    const h2 = hash2(sA + 7, sB - 3);
    const along = center + (h1 - 0.5) * 8;
    if (along < a0 + 2 || along > a1 - 2) continue;
    const x = horiz ? along : wall.x0;
    const y = horiz ? wall.y0 : along;
    const trunkH = 15 + h2 * 8;
    const canopyR = 8 + h1 * 4.5;
    const top = trunkH + canopyR * 1.55;
    const branches = [];
    const nb = 2 + (h2 > 0.55 ? 1 : 0);
    for (let b = 0; b < nb; b++) {
      const hb = hash2(sA + b * 13, sB - b * 7 + 31);
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
    trees.push({
      x, y, ux, uy, trunkH, canopyR, top, kind: wall.kind, branches, seed: h1,
      key: keyed ? `${wall.wid}:${wall.eid}:${k}` : `p:${Math.round(x)}:${Math.round(y)}`,
    });
  }
  return trees;
}

function wallFromLedge(l) {
  return l.dir === 'h'
    ? { x0: l.x0, y0: l.y, x1: l.x1, y1: l.y, kind: l.kind, wid: l.wid, eid: l.eid, ox: l.ox }
    : { x0: l.x, y0: l.y0, x1: l.x, y1: l.y1, kind: l.kind, wid: l.wid, eid: l.eid, ox: l.ox };
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
