// Renders the fly's world in colour: the same panorama its eye receives,
// rotated so the fly's heading is screen centre.
const { ipcRenderer } = require('electron');
const { World, renderPano } = require('./world.js');

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const W = canvas.width, H = canvas.height;
const img = ctx.createImageData(W, H);
const world = new World(0, 0);
let state = null;

ipcRenderer.on('viewstate', (_e, s) => { state = s; });

function draw() {
  requestAnimationFrame(draw);
  if (!state) return;
  world.walls = state.walls;
  world.food = state.food;
  world.cursor = state.cursor;
  renderPano(world, state.fly, { w: W, h: H, data: img.data }, true);
  // rotate so heading sits at centre
  const shift = Math.round((((state.fly.heading + Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * W);
  ctx.putImageData(img, -shift, 0);
  ctx.putImageData(img, W - shift, 0);
  const b = state.brain;
  if (b && b.rates) {
    const r = b.rates;
    hud.textContent =
      `sim ${(b.simSpeed || 0).toFixed(2)}x of real time | vision ${b.vision ? 'on' : 'off'} | ` +
      `escape(GF) ${r.gf?.toFixed(1) ?? '-'}  walk ${r.walk?.toFixed(1) ?? '-'}  ` +
      `groom ${r.groom?.toFixed(1) ?? '-'}  feed ${r.feed?.toFixed(1) ?? '-'}  ` +
      `loom L/R ${r.loom_l?.toFixed(1) ?? '-'}/${r.loom_r?.toFixed(1) ?? '-'} Hz`;
  }
}
requestAnimationFrame(draw);
