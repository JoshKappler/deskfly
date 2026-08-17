// Builds the packed connectome (offsets/targets/weights binaries, meta.json,
// groups.json) in brain/data/ from the raw Codex dumps in brain/data/raw/.
// Sign convention per Shiu et al.: one sign per presynaptic neuron from its
// predicted transmitter; GABA and glutamate inhibitory, all else excitatory.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(ROOT, 'brain', 'data', 'raw');
const OUT = path.join(ROOT, 'brain', 'data');
const params = JSON.parse(fs.readFileSync(path.join(ROOT, 'brain', 'params.json'), 'utf8'));

const GROUP_TYPES = {
  gf: ['DNp01'],
  loom: ['LC4', 'LPLC2'],
  walk: ['DNp09'],
  mdn: ['MDN'],
};

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
let nInhib = 0;
for (let i = 0; i < N; i++) if (sign[i] < 0) nInhib++;
console.log(`inhibitory neurons: ${nInhib}`);

// 3. behavior groups from consolidated cell types
const groups = {};
for (const k of Object.keys(GROUP_TYPES)) groups[k] = [];
await readCsv(path.join(RAW, 'consolidated_cell_types.csv.gz'), (row) => {
  const i = idxOf.get(row[0]);
  if (i === undefined) return;
  const types = [row[1], ...(row[2] || '').split(',')].map((s) => s.trim());
  for (const [k, wanted] of Object.entries(GROUP_TYPES)) {
    if (wanted.some((w) => types.includes(w))) groups[k].push(i);
  }
});
for (const [k, v] of Object.entries(groups)) console.log(`group ${k}: ${v.length} neurons`);

// 4. connections, two streaming passes: count then fill
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
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
  n_neurons: N,
  n_edges: E,
  snapshot: 783,
  skipped_rows: skipped,
}, null, 2));
console.log(`packed in ${((Date.now() - t0) / 1000).toFixed(1)}s -> brain/data/`);
