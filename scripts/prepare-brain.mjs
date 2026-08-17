// Builds the packed connectome (offsets/targets/weights binaries, meta.json,
// groups.json, eye.json) in brain/data/ from the raw dumps in brain/data/raw/.
// Sign convention per Shiu et al.: one sign per presynaptic neuron from its
// predicted transmitter; GABA and glutamate inhibitory, all else excitatory.
// Photoreceptors are forced inhibitory (histaminergic, not covered by the
// six-class transmitter predictions).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(ROOT, 'brain', 'data', 'raw');
const OUT = path.join(ROOT, 'brain', 'data');
const params = JSON.parse(fs.readFileSync(path.join(ROOT, 'brain', 'params.json'), 'utf8'));

// behavior groups: published command neurons, split by side where steering
// or escape direction needs it
const GROUP_DEFS = [
  { key: 'gf', types: ['DNp01'], side: null },
  { key: 'walk', types: ['DNp09'], side: null },
  { key: 'mdn', types: ['MDN'], side: null },
  { key: 'turn_l', types: ['DNa01', 'DNa02'], side: 'left' },
  { key: 'turn_r', types: ['DNa01', 'DNa02'], side: 'right' },
  { key: 'groom', types: ['DNg11'], side: null },
  { key: 'loom_l', types: ['LC4', 'LPLC2'], side: 'left' },
  { key: 'loom_r', types: ['LC4', 'LPLC2'], side: 'right' },
  // feeding: labellar sugar/water GRNs in, proboscis motor pool out
  // (MN9 itself is not typed in the public 783 annotations)
  { key: 'sugar', subClass: 'sugar/water', side: null },
  { key: 'feed', types: ['MN10', 'MNx01', 'MNx03'], side: null },
  // diagnostic probes for the visual cascade
  { key: 'lamina', types: ['L1', 'L2', 'L3', 'L4', 'L5'], side: null },
  { key: 'medulla', types: ['Mi1', 'Tm1', 'Tm2', 'Tm3', 'Tm4', 'Tm9'], side: null },
  { key: 'motion', types: ['T4a', 'T4b', 'T4c', 'T4d', 'T5a', 'T5b', 'T5c', 'T5d'], side: null },
];
// visual drive enters at the lamina monopolar cells: the retina-to-lamina
// layer is truncated in the FAFB volume (R1-6 average 1.7 output synapses in
// the public table), so L1-L5 plus the medulla-projecting R7/R8 are the
// first layer the connectome can actually propagate from
const EYE_GAIN = { L1: 1.0, L2: 1.0, L3: 0.8, L4: 0.6, L5: 0.6, R7: 0.5, R8: 0.5 };

function lines(file) {
  const src = fs.createReadStream(file);
  const input = file.endsWith('.gz') ? src.pipe(zlib.createGunzip()) : src;
  return readline.createInterface({ input, crlfDelay: Infinity });
}

function splitCsv(line) {
  if (!line.includes('"')) return line.split(',');
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function readCsv(file, onRow) {
  let header = null;
  for await (const line of lines(file)) {
    if (!line) continue;
    if (!header) { header = splitCsv(line).map((h) => h.trim()); continue; }
    onRow(splitCsv(line), header);
  }
}

const t0 = Date.now();

// 1. neuron index from classification.csv
const idxOf = new Map();
await readCsv(path.join(RAW, 'classification.csv.gz'), (row) => {
  if (!idxOf.has(row[0])) idxOf.set(row[0], idxOf.size);
});
const N = idxOf.size;
console.log(`neurons: ${N}`);

// 2. per-neuron sign from predicted transmitter
const sign = new Int8Array(N).fill(1);
const inhib = new Set(params.inhibitory_nt);
let ntCol = -1;
await readCsv(path.join(RAW, 'neurons.csv.gz'), (row, header) => {
  if (ntCol < 0) ntCol = header.indexOf('nt_type');
  const i = idxOf.get(row[0]);
  if (i !== undefined && inhib.has((row[ntCol] || '').trim().toLowerCase())) sign[i] = -1;
});

// 3. annotations TSV: behavior groups, photoreceptor eye map, R signs
const groups = {};
for (const g of GROUP_DEFS) groups[g.key] = [];
const eyeCells = []; // { i, gain, side, pos }
const brainSum = [0, 0, 0];
let brainCount = 0;
{
  let header = null;
  let col = null;
  for await (const line of lines(path.join(RAW, 'annotations.tsv'))) {
    if (!line) continue;
    const row = line.split('\t');
    if (!header) {
      header = row;
      col = {
        root: row.indexOf('root_id'),
        x: row.indexOf('pos_x'),
        y: row.indexOf('pos_y'),
        z: row.indexOf('pos_z'),
        type: row.indexOf('cell_type'),
        subClass: row.indexOf('cell_sub_class'),
        side: row.indexOf('side'),
      };
      continue;
    }
    const i = idxOf.get(row[col.root]);
    if (i === undefined) continue;
    const type = row[col.type];
    const side = row[col.side];
    // TSV positions are 4x4x40nm voxel coordinates; scale to nm
    const pos = [Number(row[col.x]) * 4, Number(row[col.y]) * 4, Number(row[col.z]) * 40];
    if (Number.isFinite(pos[0])) {
      brainSum[0] += pos[0]; brainSum[1] += pos[1]; brainSum[2] += pos[2];
      brainCount++;
    }
    for (const g of GROUP_DEFS) {
      const match = g.types ? g.types.includes(type) : row[col.subClass] === g.subClass;
      if (match && (!g.side || side === g.side)) groups[g.key].push(i);
    }
    if (EYE_GAIN[type] !== undefined && Number.isFinite(pos[0])) {
      eyeCells.push({ i, gain: EYE_GAIN[type], side, pos });
    }
  }
}
for (const [k, v] of Object.entries(groups)) console.log(`group ${k}: ${v.length} neurons`);
console.log(`eye cells: ${eyeCells.length}`);

// 4. eye map: fit a sphere per side, direction from sphere centre to each
// photoreceptor approximates its viewing direction; express as az/el in a
// fly frame (forward = from brain centroid toward the eyes, right = left
// eye centroid -> right eye centroid)
function centroid(cells) {
  const c = [0, 0, 0];
  for (const e of cells) { c[0] += e.pos[0]; c[1] += e.pos[1]; c[2] += e.pos[2]; }
  return c.map((v) => v / cells.length);
}
function fitSphere(cells) {
  // Coope linear least squares: |p|^2 = 2 p.c + (r^2 - |c|^2)
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const b = [0, 0, 0, 0];
  for (const e of cells) {
    const [x, y, z] = e.pos;
    const row = [2 * x, 2 * y, 2 * z, 1];
    const rhs = x * x + y * y + z * z;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) A[r][c] += row[r] * row[c];
      b[r] += row[r] * rhs;
    }
  }
  // gaussian elimination
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < 4; r++) {
      if (r === c || !A[c][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [b[0] / A[0][0], b[1] / A[1][1], b[2] / A[2][2]];
}
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// FAFB axes: x mediolateral, y dorsoventral (increases ventrally), z
// anteroposterior (increases posteriorly). Fix signs from the data itself.
const leftCells = eyeCells.filter((e) => e.side === 'left');
const rightCells = eyeCells.filter((e) => e.side === 'right');
const cL = centroid(leftCells), cR = centroid(rightCells);
const brainC = brainSum.map((v) => v / brainCount);
const eyesC = [(cL[0] + cR[0]) / 2, (cL[1] + cR[1]) / 2, (cL[2] + cR[2]) / 2];
const rightV = [Math.sign(cR[0] - cL[0]) || 1, 0, 0];
const fwd = [0, 0, Math.sign(eyesC[2] - brainC[2]) || -1];
const upV = norm(cross(rightV, fwd));
console.log(`axes: right ${rightV}, fwd ${fwd}, up ${upV}; eyes z ${(eyesC[2] / 1000).toFixed(0)}um vs brain z ${(brainC[2] / 1000).toFixed(0)}um`);

const eyeOut = { idx: [], az: [], el: [], gain: [] };
for (const [cells, sph] of [[leftCells, fitSphere(leftCells)], [rightCells, fitSphere(rightCells)]]) {
  for (const e of cells) {
    const d = norm([e.pos[0] - sph[0], e.pos[1] - sph[1], e.pos[2] - sph[2]]);
    eyeOut.idx.push(e.i);
    eyeOut.az.push(Math.atan2(dot(d, rightV), dot(d, fwd)));
    eyeOut.el.push(Math.asin(Math.max(-1, Math.min(1, dot(d, upV)))));
    eyeOut.gain.push(e.gain);
  }
}
{
  const azs = eyeOut.az, els = eyeOut.el;
  const stats = (a) => `${(Math.min(...a) * 57.3).toFixed(0)}..${(Math.max(...a) * 57.3).toFixed(0)} deg`;
  console.log(`eye map: az ${stats(azs)}, el ${stats(els)}`);
}

// 5. connections, two streaming passes: count then fill
const connFile = path.join(RAW, 'connections.csv.gz');
const counts = new Int32Array(N + 1);
let cols = null;
let skipped = 0;
await readCsv(connFile, (row, header) => {
  if (!cols) {
    cols = {
      pre: header.indexOf('pre_root_id'),
      post: header.indexOf('post_root_id'),
      syn: header.indexOf('syn_count'),
    };
  }
  const a = idxOf.get(row[cols.pre]);
  const b = idxOf.get(row[cols.post]);
  if (a === undefined || b === undefined) { skipped++; return; }
  counts[a + 1]++;
});
for (let i = 0; i < N; i++) counts[i + 1] += counts[i];
const E = counts[N];
console.log(`edges: ${E} (skipped ${skipped} rows with unknown ids)`);

const offsets = Int32Array.from(counts);
const targets = new Int32Array(E);
const weights = new Float32Array(E);
const cursor = Int32Array.from(counts.subarray(0, N));
await readCsv(connFile, (row) => {
  const a = idxOf.get(row[cols.pre]);
  const b = idxOf.get(row[cols.post]);
  if (a === undefined || b === undefined) return;
  const k = cursor[a]++;
  targets[k] = b;
  weights[k] = Number(row[cols.syn]) * sign[a] * params.w_syn_mv;
});

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'offsets.bin'), Buffer.from(offsets.buffer));
fs.writeFileSync(path.join(OUT, 'targets.bin'), Buffer.from(targets.buffer));
fs.writeFileSync(path.join(OUT, 'weights.bin'), Buffer.from(weights.buffer));
fs.writeFileSync(path.join(OUT, 'groups.json'), JSON.stringify(groups));
fs.writeFileSync(path.join(OUT, 'eye.json'), JSON.stringify(eyeOut));
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
  n_neurons: N,
  n_edges: E,
  n_eye_cells: eyeOut.idx.length,
  snapshot: 783,
  skipped_rows: skipped,
}, null, 2));
console.log(`packed in ${((Date.now() - t0) / 1000).toFixed(1)}s -> brain/data/`);
