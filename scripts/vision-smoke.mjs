// Proves the eye -> optic lobe -> giant fiber chain on the real connectome:
// a static panorama must leave the escape neurons quiet, an expanding dark
// disc (looming) must fire them, with no scripted stimulus anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'brain', 'data');
const { Sim } = require(path.join(ROOT, 'brain', 'sim.js'));
const { Eye } = require(path.join(ROOT, 'brain', 'eye.js'));

const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
const params = JSON.parse(fs.readFileSync(path.join(ROOT, 'brain', 'params.json'), 'utf8'));
const groups = JSON.parse(fs.readFileSync(path.join(DATA, 'groups.json'), 'utf8'));
const load = (f, T) => {
  const b = fs.readFileSync(path.join(DATA, f));
  const ab = new ArrayBuffer(b.byteLength);
  new Uint8Array(ab).set(b);
  return new T(ab);
};
const sim = new Sim({
  N: meta.n_neurons,
  offsets: load('offsets.bin', Int32Array),
  targets: load('targets.bin', Int32Array),
  weights: load('weights.bin', Float32Array),
}, params);
const eye = new Eye(JSON.parse(fs.readFileSync(path.join(DATA, 'eye.json'), 'utf8')), params);

const W = params.vision.pano_w, H = params.vision.pano_h;
const pano = { data: new Uint8Array(W * H), w: W, h: H };
const fly = { x: 0, y: 0, heading: 0, z: 0 };
// static scene: sky above the horizon, textured grass below
function paint(discRadDeg) {
  for (let r = 0; r < H; r++) {
    const el = 90 - ((r + 0.5) / H) * 180;
    for (let c = 0; c < W; c++) {
      pano.data[r * W + c] = el > 0 ? 225 : 100 + ((c * 7 + r * 13) % 5) * 8;
    }
  }
  if (discRadDeg > 0) {
    const cAz = ((35 + 180) / 360) * W, cEl = (90 / 180) * H;
    const rad = (discRadDeg / 360) * W;
    for (let r = Math.max(0, cEl - rad | 0); r < Math.min(H, cEl + rad + 1); r++) {
      for (let c = Math.max(0, cAz - rad | 0); c < Math.min(W, cAz + rad + 1); c++) {
        if ((c - cAz) ** 2 + (r - cEl) ** 2 <= rad * rad) pano.data[r * W + c] = 18;
      }
    }
  }
}

const g = (k) => Int32Array.from(groups[k]);
const gf = g('gf'), loomL = g('loom_l'), loomR = g('loom_r');
const lamina = g('lamina'), motion = g('motion');
const count = (grp) => grp.reduce((s, i) => s + sim.spikeCount[i], 0);
const visEvery = Math.max(1, Math.round(params.vision.update_ms / params.dt_ms));

function run(ms, discFn) {
  const steps = Math.round(ms / params.dt_ms);
  let peak = 0;
  for (let s = 0; s < steps; s++) {
    const t = s * params.dt_ms;
    if (sim.step % visEvery === 0) {
      if (discFn) paint(discFn(t));
      eye.update(pano, fly, params.vision.update_ms);
    }
    eye.tick(sim);
    sim.tick();
    if (sim.activeN > peak) peak = sim.activeN;
  }
  return peak;
}

console.log(`eye cells in use: ${eye.n} of ${meta.n_eye_cells}`);

paint(0);
run(900, null); // uncounted warmup: adapt away the scene-onset flash
let t = Date.now();
run(600, null); // adapted static baseline
const gfQ = count(gf), loomQ = count(loomL) + count(loomR);
const lamQ = count(lamina), motQ = count(motion);
const spikesQ = sim.totalSpikes;
const quietWall = Date.now() - t;
console.log(`static 600ms bio in ${quietWall}ms wall (${(600 / quietWall).toFixed(2)}x), ` +
  `spikes ${spikesQ}, lamina ${lamQ}, motion ${motQ}, loom ${loomQ}, gf ${gfQ}`);

t = Date.now();
const peak = run(500, (tt) => (tt < 300 ? 3 + (tt / 300) * 57 : 0)); // disc expands 3->60deg
const loomD = count(loomL) + count(loomR) - loomQ;
const gfD = count(gf) - gfQ;
const wall = Date.now() - t;
console.log(`loom 500ms bio in ${wall}ms wall (${(500 / wall).toFixed(2)}x), ` +
  `spikes ${sim.totalSpikes - spikesQ}, lamina ${count(lamina) - lamQ}, ` +
  `motion ${count(motion) - motQ}, loom ${loomD}, gf ${gfD}, peak active ${peak}`);

if (gfQ > 4) { console.error('FAIL: giant fiber fired on a static scene'); process.exit(1); }
if (gfD < 1) { console.error('FAIL: giant fiber silent during looming'); process.exit(1); }
if (loomD < 20) { console.error('FAIL: LC4/LPLC2 barely responded'); process.exit(1); }
console.log('PASS: panorama -> lamina -> optic lobe -> giant fiber');
