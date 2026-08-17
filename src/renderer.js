const { ipcRenderer } = require('electron');
const path = require('path');
const { Fly } = require('./behavior.js');
const { branchLedges } = require('./world.js');
const { drawFly } = require('./sprite.js');
const { loadPhotoFly } = require('./photofly.js');

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let dpr = window.devicePixelRatio || 1;

function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
}
resize();
addEventListener('resize', resize);

function screenLedges() {
  return [
    { dir: 'h', x0: 0, x1: innerWidth, y: 25, kind: 'screen' },
    { dir: 'h', x0: 0, x1: innerWidth, y: innerHeight - 3, kind: 'screen' },
    { dir: 'v', y0: 30, y1: innerHeight - 6, x: 3, kind: 'screen' },
    { dir: 'v', y0: 30, y1: innerHeight - 6, x: innerWidth - 3, kind: 'screen' },
  ];
}

function withBranches(walls) {
  return walls.concat(branchLedges(walls));
}

const env = {
  w: innerWidth,
  h: innerHeight,
  ledges: withBranches(screenLedges()),
  food: [],
  cursor: { x: -1e4, y: -1e4, vx: 0, vy: 0 },
  brain: {
    rates: {},
    mode: 'starting',
    vision: false,
    hunger: 0.7,
    last: 0,
    age() { return performance.now() / 1000 - this.last; },
  },
  stim(name, strength) { ipcRenderer.send('stim', { name, strength }); },
  ate(index, amt) { ipcRenderer.send('ate', index, amt); },
};

ipcRenderer.on('world', (_e, w) => { env.food = w.food || []; });
setInterval(() => {
  ipcRenderer.send('fly', {
    x: fly.x, y: fly.y, heading: fly.heading, z: fly.z,
    alt: fly.alt, pitch: fly.pitch, state: fly.state,
  });
}, 33);

ipcRenderer.on('perches', (_e, data) => {
  const out = [];
  for (const l of data.ledges || []) {
    if (l.dir === 'h' && l.x1 - l.x0 >= 40) out.push(l);
    else if (l.dir === 'v' && l.y1 - l.y0 >= 40) out.push(l);
  }
  env.ledges = withBranches(out.concat(screenLedges()));
});

let lastCursor = null;
ipcRenderer.on('cursor', (_e, c) => {
  const now = performance.now();
  if (lastCursor) {
    const dt = Math.max(0.016, (now - lastCursor.t) / 1000);
    env.cursor.vx = env.cursor.vx * 0.6 + ((c.x - lastCursor.x) / dt) * 0.4;
    env.cursor.vy = env.cursor.vy * 0.6 + ((c.y - lastCursor.y) / dt) * 0.4;
  }
  env.cursor.x = c.x;
  env.cursor.y = c.y;
  lastCursor = { x: c.x, y: c.y, t: now };
});

ipcRenderer.on('brain', (_e, m) => {
  env.brain.last = performance.now() / 1000;
  if (m.type === 'rates') {
    env.brain.rates = m.rates;
    env.brain.vision = !!m.vision;
    if (m.hunger !== undefined) env.brain.hunger = m.hunger;
  }
  else if (m.type === 'status') { env.brain.mode = m.mode; env.brain.vision = !!m.vision; }
});

let paused = false;
ipcRenderer.on('pause', (_e, v) => { paused = v; });

const fly = new Fly(innerWidth * 0.5, innerHeight * 0.35);
const query = new URLSearchParams(location.search);
const pose = query.get('pose');
fly.pinScale = Number(query.get('zoom')) || 1;

// on-screen body length in points; the vector fly's native body is ~25
const bodyLen = Number(query.get('size')) || 18;
const vis = bodyLen / 25;
fly.vis = vis;
// in pose-debug mode bake the zoom into the bitmaps so the loupe stays sharp
const photo = loadPhotoFly(path.join(__dirname, '..'), bodyLen * (pose ? fly.pinScale : 1), dpr);
if (photo && pose) fly.pinScale = 1;

let prev = null;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  env.w = innerWidth;
  env.h = innerHeight;
  if (!paused) {
    if (pose) fly.pin(pose, env, now / 1000);
    else fly.update(dt, env);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 160;
    if (prev) ctx.clearRect(prev.x - pad, prev.y - pad, pad * 2, pad * 2);
    const pz = fly.pose();
    if (!photo || !photo.draw(ctx, pz)) drawFly(ctx, pz, vis);
    prev = { x: fly.x, y: fly.y };
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
