// End-to-end check of the escape circuit: quiet baseline, then looming drive
// on LC4/LPLC2 must make the giant fiber (DNp01) spike. Prints timing so we
// know what fraction of real time the brain can run at.
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

const gf = Int32Array.from(groups.gf);
const loom = Int32Array.from([...groups.loom_l, ...groups.loom_r]);
const gfSpikes = () => gf.reduce((s, i) => s + sim.spikeCount[i], 0);

function run(ms) {
  const steps = Math.round(ms / params.dt_ms);
  let peak = 0;
  for (let i = 0; i < steps; i++) {
    sim.tick();
    if (sim.activeN > peak) peak = sim.activeN;
  }
  return peak;
}

console.log(`neurons ${meta.n_neurons}, edges ${meta.n_edges}, groups gf=${gf.length} loom=${loom.length}`);

let t = Date.now();
run(200);
const quietWall = Date.now() - t;
const gfQuiet = gfSpikes();
console.log(`quiet 200ms bio in ${quietWall}ms wall, total spikes ${sim.totalSpikes}, gf ${gfQuiet}`);

sim.stimulate(loom, params.stim_hz, 250);
t = Date.now();
const peak = run(650);
const stimWall = Date.now() - t;
const gfAfter = gfSpikes() - gfQuiet;
console.log(`loom 650ms bio in ${stimWall}ms wall (${(650 / stimWall).toFixed(2)}x real time), ` +
  `total spikes ${sim.totalSpikes}, peak active ${peak}`);
console.log(`giant fiber spikes after looming stimulus: ${gfAfter}`);

if (gfQuiet > 5) { console.error('FAIL: giant fiber active at rest'); process.exit(1); }
if (gfAfter < 1) { console.error('FAIL: giant fiber did not respond to looming'); process.exit(1); }
console.log('PASS: looming -> giant fiber escape pathway works');
