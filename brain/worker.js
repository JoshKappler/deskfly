const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { Sim } = require('./sim.js');
const { Eye } = require('./eye.js');

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
  let eye = null;
  const eyePath = path.join(dataDir, 'eye.json');
  if (fs.existsSync(eyePath)) {
    eye = new Eye(JSON.parse(fs.readFileSync(eyePath, 'utf8')), params);
  }
  return { sim: new Sim(data, params), groups, meta, params, eye };
}

function runReal({ sim, groups, meta, params, eye }) {
  let pano = null;
  let lastPanoWall = 0;
  const fly = { x: 400, y: 400, heading: 0, z: 1 };
  const visionOn = () => pano !== null && Date.now() - lastPanoWall < 2500;

  const sendStatus = () => parentPort.postMessage({
    type: 'status',
    mode: 'live',
    vision: visionOn(),
    text: `FlyWire live, ${meta.n_neurons.toLocaleString()} neurons, ` +
      (visionOn() ? 'vision on' : 'vision off'),
  });
  sendStatus();
  setInterval(sendStatus, 3000);

  // hunger: a labeled internal-state variable the connectome does not model.
  // It rises between meals and falls when the sugar cells taste food, and it
  // scales the intrinsic drive so activity comes in natural waves.
  let hunger = (params.hunger && params.hunger.start) || 0.7;
  if (params.hunger) {
    setInterval(() => {
      hunger = Math.min(1, hunger + 1 / params.hunger.full_after_s);
    }, 1000);
  }

  const STIM = {
    loom: { group: 'loom_l', also: 'loom_r', ms: 250 },
    sugar: { group: 'sugar', ms: 300 },
  };
  parentPort.on('message', (m) => {
    if (m.type === 'fly') {
      fly.x = m.x; fly.y = m.y; fly.heading = m.heading; fly.z = m.z;
    } else if (m.type === 'pano') {
      pano = { data: new Uint8Array(m.data), w: m.w, h: m.h };
      lastPanoWall = Date.now();
    } else if (m.type === 'stim') {
      // taste and fallback stimuli; sugar also sates hunger
      if (m.name === 'sugar' && params.hunger) {
        hunger = Math.max(0, hunger - params.hunger.sate_per_sugar);
      }
      const s = STIM[m.name];
      if (s) {
        for (const g of [s.group, s.also]) {
          if (g && groups[g] && groups[g].length) {
            sim.stimulate(groups[g], params.stim_hz * (m.strength || 1), s.ms);
          }
        }
      }
    }
  });

  // weak intrinsic drive on the command neurons: stands in for the hunger,
  // circadian and internal-state inputs the connectome does not model, so
  // spontaneous bouts emerge stochastically through the real cells
  if (params.dn_drive) {
    const dw = params.w_syn_mv * (params.dn_drive.w_factor || 80);
    setInterval(() => {
      for (const [key, hz] of Object.entries(params.dn_drive)) {
        if (key === 'w_factor' || !groups[key] || !groups[key].length) continue;
        let mul = 1;
        if (key === 'walk' || key === 'mdn') mul = 0.4 + 1.8 * hunger;
        else if (key === 'groom') mul = 1.6 - hunger;
        sim.stimulate(groups[key], hz * mul, 1000, dw);
      }
    }, 1000);
  }

  // adaptive pacing: simulate as much biological time as fits the wall budget
  const WALL_BUDGET_MS = 24;
  const visEvery = Math.max(1, Math.round(params.vision.update_ms / params.dt_ms));
  let simSpeed = 0.3;
  setInterval(() => {
    const t0 = Date.now();
    const targetMs = 30 * simSpeed;
    let done = 0;
    while (done < targetMs && Date.now() - t0 < WALL_BUDGET_MS) {
      if (eye && pano && sim.step % visEvery === 0) {
        eye.update(pano, fly, params.vision.update_ms);
      }
      if (eye && pano) eye.tick(sim);
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
    parentPort.postMessage({
      type: 'rates', rates, simSpeed, vision: visionOn(), activeN: sim.activeN, hunger,
    });
  }, 250);
}

// no prepared data yet: fake the rates the behavior reads, say so loudly
function runStub() {
  parentPort.postMessage({
    type: 'status',
    mode: 'stub',
    vision: false,
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
      vision: false,
      rates: {
        gf: gfBurst > 0 ? 120 : 0, walk: walkDrift, groom: 0,
        turn_l: 0, turn_r: 0, mdn: 0, feed: 0,
      },
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
