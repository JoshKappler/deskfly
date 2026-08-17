// Procedural housefly, top-down view. Local frame: +x is forward, origin at
// the thorax centre, body about 26pt nose to tail. Everything is drawn with
// gradients and paths so it stays crisp at any devicePixelRatio.

const TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

// fixed pseudo-random tables so speckle and bristles don't flicker per frame
function table(n, seed) {
  const out = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    out.push(s / 2147483647);
  }
  return out;
}
const R1 = table(64, 12345);
const R2 = table(64, 99991);

function drawFly(ctx, p, sizeScale) {
  const s = (p.scale || 1) * (sizeScale || 1) * (1 + 0.16 * p.z);
  drawShadow(ctx, p, s);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.heading);
  const bob = p.legMode === 'walk' ? Math.sin(p.gaitPhase * 2) * 0.02
    : p.legMode === 'stand' ? Math.sin(p.gaitPhase * TAU * 0.25) * 0.012 : 0;
  ctx.scale(s * (1 + bob), s * (1 + bob));
  drawLegs(ctx, p);
  drawAbdomen(ctx);
  drawThorax(ctx);
  drawHead(ctx);
  drawWings(ctx, p);
  ctx.restore();
}

function drawShadow(ctx, p, s) {
  const a = 0.15 * (1 - 0.55 * p.z);
  if (a <= 0.015) return;
  const off = (2 + 11 * p.z) * s;
  ctx.save();
  ctx.translate(p.x + off * 0.5, p.y + off);
  ctx.scale(1, 0.55);
  ctx.rotate(p.heading);
  ctx.scale(s * 1.15, s * 0.6);
  const g = ctx.createRadialGradient(-2.5, 0, 1, -2.5, 0, 14);
  g.addColorStop(0, `rgba(0,0,0,${a})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(-2.5, 0, 14, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---- legs ----

const LEG_DEFS = [
  { hip: [3.3, 2.5], stand: 0.42, tib: 0.85, tar: 0.55, len: [3.9, 3.4, 2.5], wid: 0.9 },
  { hip: [0.9, 2.8], stand: 1.18, tib: 0.8, tar: 0.6, len: [4.2, 3.8, 2.7], wid: 0.85 },
  { hip: [-1.9, 2.6], stand: 1.98, tib: 0.75, tar: 0.55, len: [4.7, 4.8, 3.1], wid: 0.9 },
];

function drawLegs(ctx, p) {
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 3; i++) drawLeg(ctx, p, i, side);
  }
}

function drawLeg(ctx, p, i, side) {
  const L = LEG_DEFS[i];
  const hx = L.hip[0], hy = L.hip[1] * side;
  let f = L.stand, tib = L.tib, tar = L.tar;
  let seg = L.len;
  let alpha = 0.95;

  if (p.legMode === 'tucked') {
    f = 2.35 + i * 0.22; tib = 0.35; tar = 0.3;
    seg = [seg[0] * 0.55, seg[1] * 0.5, seg[2] * 0.45];
    alpha = 0.75;
  } else if (p.legMode === 'walk') {
    const tripodA = (i + (side === 1 ? 1 : 0)) % 2 === 0;
    const ph = p.gaitPhase + (tripodA ? 0 : Math.PI);
    f = L.stand + Math.sin(ph) * 0.24;
    alpha = 0.95 - 0.3 * Math.max(0, Math.sin(ph + Math.PI / 2));
  } else if (p.legMode === 'groom' && i === 0) {
    return drawGroomLeg(ctx, p, side);
  } else {
    f = L.stand + Math.sin(p.gaitPhase * TAU * 0.25 + i) * 0.015;
  }

  const a1 = f * side;
  const kx = hx + Math.cos(a1) * seg[0];
  const ky = hy + Math.sin(a1) * seg[0];
  const a2 = a1 + tib * side;
  const fx = kx + Math.cos(a2) * seg[1];
  const fy = ky + Math.sin(a2) * seg[1];
  const a3 = a2 + tar * side;
  const tx = fx + Math.cos(a3) * seg[2];
  const ty = fy + Math.sin(a3) * seg[2];

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#241f17';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = L.wid;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(kx, ky);
  ctx.stroke();
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(kx, ky);
  ctx.quadraticCurveTo(
    kx + Math.cos(a2 - 0.2 * side) * seg[1] * 0.5,
    ky + Math.sin(a2 - 0.2 * side) * seg[1] * 0.5,
    fx, fy,
  );
  ctx.stroke();
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  if (p.legMode !== 'tucked') {
    ctx.fillStyle = 'rgba(15,12,9,0.5)';
    ctx.beginPath();
    ctx.arc(tx, ty, 0.35, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function ik(hx, hy, tx, ty, l1, l2, bend) {
  let dx = tx - hx, dy = ty - hy;
  let d = Math.hypot(dx, dy);
  const m = l1 + l2 - 0.05;
  if (d > m) { dx *= m / d; dy *= m / d; d = m; tx = hx + dx; ty = hy + dy; }
  const base = Math.atan2(dy, dx);
  const q = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  return [hx + Math.cos(base + q * bend) * l1, hy + Math.sin(base + q * bend) * l1, tx, ty];
}

// forelegs sweep over the head while grooming
function drawGroomLeg(ctx, p, side) {
  const L = LEG_DEFS[0];
  const hx = L.hip[0], hy = L.hip[1] * side;
  const ph = p.groomPhase + (side === 1 ? Math.PI * 0.5 : 0);
  const tx = 7.6 + Math.sin(ph) * 1.3;
  const ty = side * (1.1 + Math.cos(ph) * 0.9);
  const [kx, ky, fx, fy] = ik(hx, hy, tx, ty, L.len[0], L.len[1] + L.len[2] * 0.6, side);
  ctx.save();
  ctx.strokeStyle = '#241f17';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.0;
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
  ctx.restore();
}

// ---- body ----

function abdomenPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-2.0, -3.5);
  ctx.bezierCurveTo(-7.2, -4.5, -12.3, -3.1, -14.6, -1.0);
  ctx.quadraticCurveTo(-15.7, 0, -14.6, 1.0);
  ctx.bezierCurveTo(-12.3, 3.1, -7.2, 4.5, -2.0, 3.5);
  ctx.closePath();
}

function abWidth(x) {
  const pts = [[-2, 3.5], [-5, 4.3], [-8, 4.15], [-11, 3.35], [-13.5, 2.0], [-15, 0.7]];
  for (let i = 0; i < pts.length - 1; i++) {
    if (x <= pts[i][0] && x >= pts[i + 1][0]) {
      const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
      return lerp(pts[i][1], pts[i + 1][1], t);
    }
  }
  return 1;
}

function drawAbdomen(ctx) {
  ctx.save();
  abdomenPath(ctx);
  const g = ctx.createLinearGradient(-2, 0, -15.5, 0);
  g.addColorStop(0, '#57503f');
  g.addColorStop(0.55, '#3b372c');
  g.addColorStop(1, '#262319');
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  abdomenPath(ctx);
  ctx.clip();
  // tergite bands
  ctx.strokeStyle = 'rgba(18,15,10,0.42)';
  ctx.lineWidth = 1.5;
  for (const bx of [-4.8, -7.6, -10.3, -12.7]) {
    ctx.beginPath();
    ctx.ellipse(bx + 6.5, 0, 7.2, 4.6, 0, Math.PI * 0.72, Math.PI * 1.28);
    ctx.stroke();
  }
  // irregular dark side patches
  for (const [px, py] of [[-6, 2.6], [-9.5, -2.4], [-5.5, -2.8], [-10.5, 2.2]]) {
    const pg = ctx.createRadialGradient(px, py, 0.2, px, py, 2.6);
    pg.addColorStop(0, 'rgba(15,12,8,0.22)');
    pg.addColorStop(1, 'rgba(15,12,8,0)');
    ctx.fillStyle = pg;
    ctx.fillRect(px - 3, py - 3, 6, 6);
  }
  // dorsal sheen
  const hg = ctx.createRadialGradient(-6, -1.3, 0.5, -6, -1.3, 7);
  hg.addColorStop(0, 'rgba(235,232,215,0.13)');
  hg.addColorStop(1, 'rgba(235,232,215,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(-15, -5, 14, 10);
  ctx.restore();

  // flank bristles
  ctx.strokeStyle = 'rgba(24,19,13,0.35)';
  ctx.lineWidth = 0.28;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 14; i++) {
    const x = -3 - R1[i] * 11;
    const sgn = i % 2 === 0 ? 1 : -1;
    const y = abWidth(x) * sgn;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 0.7 - R2[i] * 0.4, y + sgn * (0.8 + R2[i] * 0.4));
  }
  ctx.stroke();

  abdomenPath(ctx);
  ctx.strokeStyle = 'rgba(205,220,240,0.16)';
  ctx.lineWidth = 0.55;
  ctx.stroke();
  ctx.restore();
}

function drawThorax(ctx) {
  ctx.save();
  // scutellum
  ctx.beginPath();
  ctx.ellipse(-2.6, 0, 1.7, 2.2, 0, 0, TAU);
  ctx.fillStyle = '#453f30';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(1.3, 0, 4.5, 3.5, 0, 0, TAU);
  const g = ctx.createRadialGradient(2.4, -1.3, 0.5, 1.3, 0, 5.5);
  g.addColorStop(0, '#6b6350');
  g.addColorStop(0.6, '#4a4436');
  g.addColorStop(1, '#2e2a20');
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(1.3, 0, 4.5, 3.5, 0, 0, TAU);
  ctx.clip();
  // the four longitudinal stripes
  ctx.fillStyle = 'rgba(20,17,12,0.5)';
  for (const y of [-2.1, -0.7, 0.7, 2.1]) {
    ctx.beginPath();
    ctx.roundRect(-2.8, y - 0.36, 8.2, 0.72, 0.36);
    ctx.fill();
  }
  // humeral highlights
  ctx.fillStyle = 'rgba(220,210,180,0.14)';
  ctx.beginPath(); ctx.arc(4.0, -2.4, 0.9, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(4.0, 2.4, 0.9, 0, TAU); ctx.fill();
  ctx.restore();

  const sg = ctx.createRadialGradient(2.6, -1.5, 0.2, 2.6, -1.5, 3.2);
  sg.addColorStop(0, 'rgba(255,250,235,0.18)');
  sg.addColorStop(1, 'rgba(255,250,235,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.ellipse(1.3, 0, 4.5, 3.5, 0, 0, TAU);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(1.3, 0, 4.5, 3.5, 0, 0, TAU);
  ctx.strokeStyle = 'rgba(205,220,240,0.15)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.restore();
}

function drawHead(ctx) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(6.2, 0, 2.1, 2.6, 0, 0, TAU);
  ctx.fillStyle = '#332c23';
  ctx.fill();

  for (let side = -1; side <= 1; side += 2) {
    ctx.save();
    ctx.translate(6.9, 1.35 * side);
    ctx.rotate(0.45 * side);
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.15, 2.5, 0, 0, TAU);
    const g = ctx.createRadialGradient(0.7, -0.6 * side, 0.2, -0.2, 0.2 * side, 2.9);
    g.addColorStop(0, '#a03d1c');
    g.addColorStop(0.5, '#6e1f0a');
    g.addColorStop(1, '#350a02');
    ctx.fillStyle = g;
    ctx.fill();
    // ommatidia speckle
    ctx.fillStyle = 'rgba(255,140,80,0.16)';
    for (let i = 0; i < 14; i++) {
      const a = R2[i + (side === 1 ? 14 : 0)] * TAU;
      const r = 0.3 + R1[i + (side === 1 ? 14 : 0)] * 1.7;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.85, Math.sin(a) * r, 0.16, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.15, 2.5, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(25,8,3,0.5)';
    ctx.lineWidth = 0.3;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(0.55, -0.7, 0.34, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.arc(-0.5, 0.8, 0.18, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // narrow frons stripe between the eyes
  ctx.beginPath();
  ctx.moveTo(8.15, 0);
  ctx.lineTo(6.3, -0.45);
  ctx.lineTo(6.3, 0.45);
  ctx.closePath();
  ctx.fillStyle = 'rgba(120,108,85,0.7)';
  ctx.fill();

  // ocelli
  ctx.fillStyle = 'rgba(185,115,45,0.85)';
  for (const [ox, oy] of [[5.6, 0], [6.0, -0.35], [6.0, 0.35]]) {
    ctx.beginPath(); ctx.arc(ox, oy, 0.18, 0, TAU); ctx.fill();
  }

  // antennae with arista
  ctx.strokeStyle = '#1f1a13';
  ctx.lineCap = 'round';
  for (let side = -1; side <= 1; side += 2) {
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(8.25, 0.22 * side);
    ctx.quadraticCurveTo(8.7, 0.35 * side, 8.95, 0.55 * side);
    ctx.stroke();
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.moveTo(8.9, 0.5 * side);
    ctx.quadraticCurveTo(9.35, 0.65 * side, 9.55, 0.95 * side);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- wings ----

function wingShape(ctx) {
  ctx.beginPath();
  ctx.moveTo(0.3, -0.5);
  ctx.bezierCurveTo(4.0, -2.3, 10.0, -2.5, 13.6, -0.9);
  ctx.quadraticCurveTo(14.7, 0.0, 13.6, 0.9);
  ctx.bezierCurveTo(10.0, 2.8, 4.5, 3.0, 1.6, 1.9);
  ctx.quadraticCurveTo(0.1, 1.1, 0.3, -0.5);
  ctx.closePath();
}

function drawWingDetail(ctx, alpha) {
  ctx.strokeStyle = `rgba(95,110,135,${0.5 * alpha})`;
  ctx.lineWidth = 0.3;
  const veins = [
    [[1.0, -0.4], [7.0, -1.9], [13.2, -0.8]],
    [[1.0, -0.1], [7.5, -0.7], [13.8, 0.0]],
    [[1.2, 0.4], [7.0, 0.8], [12.6, 1.3]],
    [[1.4, 0.9], [5.5, 1.9], [9.8, 2.3]],
  ];
  for (const v of veins) {
    ctx.beginPath();
    ctx.moveTo(v[0][0], v[0][1]);
    ctx.quadraticCurveTo(v[1][0], v[1][1], v[2][0], v[2][1]);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(7.4, -0.75); ctx.lineTo(7.1, 0.8);
  ctx.moveTo(10.6, -0.35); ctx.lineTo(10.2, 1.6);
  ctx.stroke();
}

function drawWing(ctx, len, alpha, detailed) {
  ctx.save();
  ctx.scale(len / 14, len / 14);
  wingShape(ctx);
  const g = ctx.createLinearGradient(0, 0, 14, 0);
  g.addColorStop(0, `rgba(215,222,235,${0.20 * alpha})`);
  g.addColorStop(0.5, `rgba(205,215,232,${0.15 * alpha})`);
  g.addColorStop(1, `rgba(210,220,238,${0.10 * alpha})`);
  ctx.fillStyle = g;
  ctx.fill();
  const ig = ctx.createLinearGradient(1, -2, 12, 2.5);
  ig.addColorStop(0.0, `rgba(140,180,255,${0.10 * alpha})`);
  ig.addColorStop(0.45, `rgba(255,160,215,${0.07 * alpha})`);
  ig.addColorStop(0.8, `rgba(150,255,205,${0.06 * alpha})`);
  ig.addColorStop(1, 'rgba(150,255,205,0)');
  ctx.fillStyle = ig;
  wingShape(ctx);
  ctx.fill();
  if (detailed) {
    drawWingDetail(ctx, alpha);
    wingShape(ctx);
    ctx.strokeStyle = `rgba(175,190,212,${0.5 * alpha})`;
    ctx.lineWidth = 0.35;
    ctx.stroke();
    ctx.strokeStyle = `rgba(90,95,105,${0.45 * alpha})`;
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(0.3, -0.5);
    ctx.bezierCurveTo(4.0, -2.3, 10.0, -2.5, 13.6, -0.9);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWings(ctx, p) {
  const fold = p.wingFold;
  const flap = 1 - fold;

  // halteres, visible while the wings beat
  if (flap > 0.4) {
    for (let side = -1; side <= 1; side += 2) {
      const wob = Math.sin(p.wingPhase + Math.PI) * 0.35;
      ctx.strokeStyle = 'rgba(140,120,85,0.55)';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.moveTo(-2.2, 2.6 * side);
      ctx.lineTo(-3.3, (3.4 + wob) * side);
      ctx.stroke();
      ctx.fillStyle = 'rgba(205,180,130,0.6)';
      ctx.beginPath();
      ctx.arc(-3.3, (3.4 + wob) * side, 0.45, 0, TAU);
      ctx.fill();
    }
  }

  for (let side = -1; side <= 1; side += 2) {
    ctx.save();
    ctx.translate(-0.5, 0.75 * side);
    const beatCenter = side * 1.25;
    const foldAngle = side * (Math.PI - 0.045);
    if (flap > 0.25) {
      for (let k = 4; k >= 1; k--) {
        const ga = beatCenter + side * 0.55 * Math.sin(p.wingPhase - k * 0.5) * flap;
        const a = lerp(ga, foldAngle, fold);
        ctx.save();
        ctx.rotate(a);
        if (side === -1) ctx.scale(1, -1);
        drawWing(ctx, 12.5, 0.36 * flap * (1 - k * 0.18), false);
        ctx.restore();
      }
    }
    const beatAngle = beatCenter + side * 0.55 * Math.sin(p.wingPhase) * flap;
    ctx.rotate(lerp(beatAngle, foldAngle, fold));
    if (side === -1) ctx.scale(1, -1);
    drawWing(ctx, lerp(12.5, 15.4, fold), lerp(0.6, 1, fold), fold > 0.5);
    ctx.restore();
  }
}

module.exports = { drawFly, drawLegs, drawWings };
