// Diagnostic: drive a contiguous retinal patch hard and report how far the
// activity travels layer by layer.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'brain', 'data');
const { Sim } = require(path.join(ROOT, 'brain', 'sim.js'));

const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
const params = JSON.parse(fs.readFileSync(path.join(ROOT, 'brain', 'params.json'), 'utf8'));
const groups = JSON.parse(fs.readFileSync(path.join(DATA, 'groups.json'), 'utf8'));
const eyeData = JSON.parse(fs.readFileSync(path.join(DATA, 'eye.json'), 'utf8'));
const load = (f, T) => {
  const b = fs.readFileSync(path.join(DATA, f));
  const ab = new ArrayBuffer(b.byteLength);
  new Uint8Array(ab).set(b);
  return new T(ab);
};
const off = load('offsets.bin', Int32Array);
const sim = new Sim({
  N: meta.n_neurons,
  offsets: off,
  targets: load('targets.bin', Int32Array),
  weights: load('weights.bin', Float32Array),
}, params);

// retinal patch: az 15..55 deg, el -35..5 deg
const patch = [];
for (let i = 0; i < eyeData.idx.length; i++) {
  const azd = eyeData.az[i] * 57.3, eld = eyeData.el[i] * 57.3;
  if (azd > 15 && azd < 55 && eld > -35 && eld < 5) patch.push(eyeData.idx[i]);
}
let pdeg = 0;
for (const i of patch) pdeg += off[i + 1] - off[i];
console.log(`patch cells: ${patch.length}, avg out-degree ${(pdeg / patch.length).toFixed(1)}`);

const count = (k) => groups[k].reduce((s, i) => s + sim.spikeCount[i], 0);
const layers = ['lamina', 'medulla', 'motion', 'loom_l', 'loom_r', 'gf'];

// 120 Hz Poisson on the patch for 250ms of biology, then 150ms quiet
const pIdx = Int32Array.from(patch);
const before = {};
for (const k of layers) before[k] = count(k);
const steps = Math.round(400 / params.dt_ms);
const prob = ((Number(process.argv[2]) || 120) * params.dt_ms) / 1000;
for (let s = 0; s < steps; s++) {
  if (s * params.dt_ms < 250) {
    for (let j = 0; j < pIdx.length; j++) {
      if (Math.random() < prob) sim.injectSpike(pIdx[j]);
    }
  }
  sim.tick();
}
console.log(`total spikes ${sim.totalSpikes}, peak-ish active ${sim.activeN}`);
for (const k of layers) console.log(`  ${k}: ${count(k) - before[k]}`);
