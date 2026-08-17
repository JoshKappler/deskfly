// Downloads the FlyWire Codex public dumps (snapshot 783, CC BY-NC 4.0)
// into brain/data/raw/. About 54 MB total, no auth needed.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const BASE = 'https://storage.googleapis.com/flywire-data/codex/data/fafb/783/';
const FILES = [
  'connections.csv.gz',
  'classification.csv.gz',
  'neurons.csv.gz',
  'consolidated_cell_types.csv.gz',
];
// Schlegel et al. annotations: cell types, sides, and neuron positions
// (positions build the photoreceptor eye map)
const ANNOTATIONS = {
  url: 'https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv',
  name: 'annotations.tsv',
};

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(ROOT, 'brain', 'data', 'raw');
fs.mkdirSync(RAW, { recursive: true });

const jobs = FILES.map((name) => ({ name, url: BASE + name }));
jobs.push({ name: ANNOTATIONS.name, url: ANNOTATIONS.url });
for (const { name, url } of jobs) {
  const dest = path.join(RAW, name);
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`HEAD ${url} -> ${head.status}`);
  const size = Number(head.headers.get('content-length') || 0);
  if (fs.existsSync(dest) && fs.statSync(dest).size === size) {
    console.log(`${name}: already downloaded (${(size / 1e6).toFixed(1)} MB)`);
    continue;
  }
  console.log(`${name}: downloading ${(size / 1e6).toFixed(1)} MB ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest + '.part'));
  fs.renameSync(dest + '.part', dest);
  console.log(`${name}: done`);
}
console.log('all raw files present in brain/data/raw/');
