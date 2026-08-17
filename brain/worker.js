const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { Sim } = require('./sim.js');

const dataDir = workerData.dataDir;

function loadBrain() {
  const metaPath = path.join(dataDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const params = JSON.parse(fs.readFileSync(path.join(__dirname, 'params.json'), 'utf8'));
  const groupsRaw = JSON.parse(fs.readFileSync(path.join(dataDir, 'groups.json'), 'utf8'));
  const load = (f, T) => {
    const b = fs.readFileSync(path.join(dataDir, f));
    const ab = new ArrayBuffer(b.byteLength);
    new Uint8Array(ab).set(b);
    return new T(ab);
  };
  const data = {
    N: meta.n_neurons,
    offsets: load('offsets.bin', Int32Array),
    targets: load('targets.bin', Int32Array),
    weights: load('weights.bin', Float32Array),
  };
  const groups = {};
  for (const [k, v] of Object.entries(groupsRaw)) groups[k] = Int32Array.from(v);
  return { sim: new Sim(data, params), groups, meta, params };
}

function runReal({ sim, groups, meta, params }) {
  parentPort.postMessage({
    type: 'status',
    mode: 'live',
    text: `FlyWire live, ${meta.n_neurons.toLocaleString()} neurons`,
  });

  const STIM = { loom: { group: 'loom', ms: 250 } };
  parentPort.on('message', (m) => {
    if (m.type !== 'stim') return;
    const s = STIM[m.name];
    if (s && groups[s.group] && groups[s.group].length) {
      sim.stimulate(groups[s.group], params.stim_hz * (m.strength || 1), s.ms);
    }
  });

  // weak rotating background drive so the brain is never fully silent;
  // subthreshold nudges, not the full stimulus weight
  const bgSize = Math.min(params.bg_size || 200, sim.N);
  setInterval(() => {
    const bg = new Int32Array(bgSize);
    for (let i = 0; i < bgSize; i++) bg[i] = (Math.random() * sim.N) | 0;
    sim.stimulate(bg, params.bg_hz, 1000, params.w_syn_mv * (params.bg_w_factor || 20));
  }, 1000);

  // adaptive pacing: simulate as much biological time as fits the wall budget
  const WALL_BUDGET_MS = 6;
  let simSpeed = 0.3;
  setInterval(() => {
    const t0 = Date.now();
    const targetMs = 30 * simSpeed;
    let done = 0;
    while (done < targetMs && Date.now() - t0 < WALL_BUDGET_MS) {
      sim.tick();
      done += sim.p.dt_ms;
    }
    if (Date.now() - t0 >= WALL_BUDGET_MS && done < targetMs) simSpeed = Math.max(0.05, simSpeed * 0.9);
    else if (simSpeed < 1) simSpeed = Math.min(1, simSpeed * 1.02);
  }, 30);

  let lastStep = 0;
  const totals = {};
  for (const k of Object.keys(groups)) totals[k] = 0;
  setInterval(() => {
    const bioS = ((sim.step - lastStep) * sim.p.dt_ms) / 1000;
    lastStep = sim.step;
    if (bioS <= 0) return;
    const rates = {};
    for (const k of Object.keys(groups)) {
      let c = 0;
      const g = groups[k];
      for (let i = 0; i < g.length; i++) c += sim.spikeCount[g[i]];
      rates[k] = g.length ? (c - totals[k]) / g.length / bioS : 0;
      totals[k] = c;
    }
    parentPort.postMessage({ type: 'rates', rates, simSpeed, activeN: sim.activeN });
  }, 250);
}

// no prepared data yet: fake the two rates the behavior reads, say so loudly
function runStub() {
  parentPort.postMessage({
    type: 'status',
    mode: 'stub',
    text: 'stub brain (npm run fetch:brain && npm run prep:brain)',
  });
  let gfBurst = 0;
  parentPort.on('message', (m) => {
    if (m.type === 'stim' && m.name === 'loom') {
      setTimeout(() => { gfBurst = 0.4; }, 80);
    }
  });
  let walkDrift = 4;
  setInterval(() => {
    walkDrift = Math.max(0, Math.min(12, walkDrift + (Math.random() - 0.5) * 2));
    parentPort.postMessage({
      type: 'rates',
      rates: { gf: gfBurst > 0 ? 120 : 0, walk: walkDrift, loom: 0 },
    });
    gfBurst = Math.max(0, gfBurst - 0.15);
  }, 250);
}

let brain = null;
try {
  brain = loadBrain();
} catch (e) {
  parentPort.postMessage({ type: 'status', mode: 'error', text: `brain load failed: ${e.message}` });
}
if (brain) runReal(brain);
else runStub();
