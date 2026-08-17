// One 3D scene, two consumers: a cube camera at the fly's position becomes
// the 360-degree luminance panorama its retina receives, and a perspective
// fly-cam renders the same scene for the human viewer. Coordinates: world
// x/z = screen x/y in points, world y = altitude.

const { ipcRenderer } = require('electron');
const fs = require('fs');
const THREE = require('three');
const { treesForWall, hash2 } = require('./world.js');

const PANO_W = 180, PANO_H = 90;
const SUN_AZ = -2.3, SUN_EL = 0.85;
const sunDir = new THREE.Vector3(
  Math.cos(SUN_EL) * Math.cos(SUN_AZ), Math.sin(SUN_EL), Math.cos(SUN_EL) * Math.sin(SUN_AZ));

const state = {
  w: 1600, h: 1000,
  walls: [], wallsKey: '',
  food: [], cursor: { x: -1e4, y: -1e4 },
  fly: { x: 400, y: 400, alt: 20, heading: 0, pitch: 0, z: 1, state: 'CRUISE' },
  brain: null,
  shown: false,
};

const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');
const eyeCanvas = document.getElementById('eye');
const eyeCtx = eyeCanvas.getContext('2d');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc3d9e4, 0.0013);

const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.8, 5000);

function sizeToWindow() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
sizeToWindow();
addEventListener('resize', sizeToWindow);

// shared wind clock for the vegetation shaders
const uTime = { value: 0 };
function windify(material, amp) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = 'uniform float uTime;\nattribute float aPhase;\n'
      + shader.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
        float swayW = clamp(position.y, 0.0, 2.0);
        float sway = (sin(uTime * 2.1 + aPhase) + 0.6 * sin(uTime * 3.7 + aPhase * 1.7)) * ${amp} * swayW * swayW;
        transformed.x += sway;
        transformed.z += 0.6 * sway;`);
  };
}

// ── sky and light ────────────────────────────────────────────────────────────
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(3200, 24, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false,
    uniforms: { uSun: { value: sunDir } },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 uSun;
      void main() {
        float t = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(vec3(0.78, 0.87, 0.95), vec3(0.34, 0.55, 0.86), pow(t, 0.7));
        float s = clamp(dot(normalize(vDir), uSun), 0.0, 1.0);
        c += vec3(1.0, 0.93, 0.72) * pow(s, 220.0) * 2.2;
        c += vec3(1.0, 0.9, 0.62) * pow(s, 10.0) * 0.22;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
scene.add(sky);

const sun = new THREE.DirectionalLight(0xfff2d4, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -450; sun.shadow.camera.right = 450;
sun.shadow.camera.top = 450; sun.shadow.camera.bottom = -450;
sun.shadow.camera.far = 2400;
sun.shadow.bias = -0.002;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbcd8f5, 0x3a5527, 0.85));

// ── ground ───────────────────────────────────────────────────────────────────
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3d7a2a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 340; i++) {
    const n = hash2(i, 3.7), m = hash2(i, 9.1);
    g.fillStyle = `rgba(${30 + n * 60}, ${95 + m * 60}, ${24 + n * 30}, 0.55)`;
    g.beginPath();
    g.arc(hash2(i, 1.1) * 256, hash2(i, 2.3) * 256, 3 + n * 16, 0, 7);
    g.fill();
  }
  for (let i = 0; i < 900; i++) {
    const n = hash2(i, 5.5);
    g.fillStyle = n > 0.5 ? 'rgba(150,190,80,0.35)' : 'rgba(20,60,18,0.35)';
    g.fillRect(hash2(i, 6.1) * 256, hash2(i, 7.9) * 256, 1.6, 3.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(34, 34);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(9000, 9000),
  new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ── reflections: a small env cubemap, refreshed slowly, feeds water+berries ──
const envRT = new THREE.WebGLCubeRenderTarget(64);
const envCam = new THREE.CubeCamera(1, 4000, envRT);
scene.add(envCam);
const reflective = [];

// ── grass: instanced blades, wind-swayed, world-anchored around the fly ─────
const GRASS_MAX = 34000, GRASS_R = 330, GRASS_CELL = 5.2;
const bladeGeo = new THREE.BufferGeometry();
bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
  -0.5, 0, 0, 0.5, 0, 0, -0.3, 0.55, 0,
  0.5, 0, 0, 0.3, 0.55, 0, -0.3, 0.55, 0,
  -0.3, 0.55, 0, 0.3, 0.55, 0, 0, 1, 0,
], 3));
bladeGeo.setAttribute('color', new THREE.Float32BufferAttribute([
  0.16, 0.34, 0.10, 0.16, 0.34, 0.10, 0.32, 0.55, 0.18,
  0.16, 0.34, 0.10, 0.32, 0.55, 0.18, 0.32, 0.55, 0.18,
  0.32, 0.55, 0.18, 0.32, 0.55, 0.18, 0.52, 0.72, 0.28,
], 3));
bladeGeo.computeVertexNormals();
const bladePhase = new Float32Array(GRASS_MAX);
bladeGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(bladePhase, 1));
const bladeMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
windify(bladeMat, '1.1');
const grass = new THREE.InstancedMesh(bladeGeo, bladeMat, GRASS_MAX);
grass.receiveShadow = true;
grass.frustumCulled = false;
scene.add(grass);

let grassAnchor = null;
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3();
const S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const E = new THREE.Euler();
const bladeCol = new THREE.Color();
function repopulateGrass(cx, cy) {
  grassAnchor = { x: cx, y: cy };
  let n = 0;
  const c0x = Math.floor((cx - GRASS_R) / GRASS_CELL), c1x = Math.ceil((cx + GRASS_R) / GRASS_CELL);
  const c0y = Math.floor((cy - GRASS_R) / GRASS_CELL), c1y = Math.ceil((cy + GRASS_R) / GRASS_CELL);
  for (let gy = c0y; gy <= c1y && n < GRASS_MAX; gy++) {
    for (let gx = c0x; gx <= c1x && n < GRASS_MAX; gx++) {
      const h = hash2(gx, gy);
      if (h < 0.42) continue;
      const px = (gx + hash2(gx, gy + 9)) * GRASS_CELL;
      const py = (gy + hash2(gx + 9, gy)) * GRASS_CELL;
      const ddx = px - cx, ddy = py - cy;
      if (ddx * ddx + ddy * ddy > GRASS_R * GRASS_R) continue;
      const h2 = hash2(gx + 3, gy - 8);
      const hgt = 4 + hash2(gx, gy + 5) * 6.5;
      V.set(px, 0, py);
      E.set((h2 - 0.5) * 0.5, h * Math.PI * 2, (h - 0.5) * 0.5);
      Q.setFromEuler(E);
      S.set(0.3 + h2 * 0.28, hgt, 1);
      M.compose(V, Q, S);
      grass.setMatrixAt(n, M);
      bladeCol.setHSL(0.26 + h2 * 0.07, 0.45 + h * 0.2, 0.5 + (h2 - 0.5) * 0.25);
      grass.setColorAt(n, bladeCol);
      bladePhase[n] = h * 20 + px * 0.06 + py * 0.05;
      n++;
    }
  }
  grass.count = n;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  bladeGeo.attributes.aPhase.needsUpdate = true;
}

// ── trees, rebuilt when the walls change ─────────────────────────────────────
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2d, roughness: 0.95, flatShading: true });
const branchMat = new THREE.MeshStandardMaterial({ color: 0x5c4026, roughness: 0.95, flatShading: true });
const canopyMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
windify(canopyMat, '0.05');
const blossomMat = new THREE.MeshStandardMaterial({ color: 0xecb9d0, roughness: 0.7 });
let treeGroup = null;

// groves slide: each tree keeps a current position that persists across
// rebuilds and eases toward its target, so a dragged window's trees glide
let treeCur = new Map();
let slideEntries = [];

function beamTransform(ax, ay, az, bx, by, bz, r) {
  V.set(bx - ax, by - ay, bz - az);
  const len = V.length();
  Q.setFromUnitVectors(UP, V.normalize());
  V.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  S.set(r, len, r);
}

function writeItem(it, cur) {
  V.set(cur.x + it.offX, it.y, cur.y + it.offZ);
  M.compose(V, it.q, it.s);
  it.mesh.setMatrixAt(it.i, M);
}

function rebuildTrees() {
  if (treeGroup) {
    scene.remove(treeGroup);
    treeGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  treeGroup = new THREE.Group();
  slideEntries = [];
  const nextCur = new Map();
  const trees = [];
  for (const w of state.walls) trees.push(...treesForWall(w));
  if (!trees.length) { treeCur = nextCur; scene.add(treeGroup); return; }

  let nBranch = 0, nBlossom = 0;
  for (const t of trees) { nBranch += t.branches.length; if (t.kind === 'input') nBlossom += 7; }

  const trunkGeo = new THREE.CylinderGeometry(0.75, 1.5, 1, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  const branchGeo = new THREE.CylinderGeometry(0.45, 0.75, 1, 5);
  const branches = new THREE.InstancedMesh(branchGeo, branchMat, nBranch);
  const blobGeo = new THREE.IcosahedronGeometry(1, 1);
  const blobPhase = new Float32Array(trees.length * 3);
  blobGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(blobPhase, 1));
  const blobs = new THREE.InstancedMesh(blobGeo, canopyMat, trees.length * 3);
  const blossoms = nBlossom
    ? new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.1, 0), blossomMat, nBlossom) : null;

  const col = new THREE.Color();
  let bi = 0, fi = 0, li = 0;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const cur = treeCur.get(t.key) || { x: t.x, y: t.y };
    nextCur.set(t.key, cur);
    const entry = { cur, tgt: { x: t.x, y: t.y }, items: [] };
    const add = (mesh, idx) => entry.items.push({
      mesh, i: idx, q: Q.clone(), s: S.clone(), offX: V.x - t.x, y: V.y, offZ: V.z - t.y,
    });

    const h = t.trunkH + t.canopyR;
    V.set(t.x, h / 2, t.y);
    Q.setFromAxisAngle(UP, t.seed * 6.28);
    S.set(1.1, h, 1.1);
    add(trunks, i);
    for (const b of t.branches) {
      beamTransform(b.x0, b.alt0, b.y0, b.x1, b.alt1, b.y1, 0.6);
      add(branches, bi++);
    }
    for (let k = 0; k < 3; k++) {
      const hk = hash2(t.seed * 91 + k * 5, t.seed * 47 - k * 3);
      const r = t.canopyR * (0.7 + hk * 0.5);
      V.set(
        t.x + (hk - 0.5) * t.canopyR * 1.1,
        t.trunkH + t.canopyR * 0.55 + k * t.canopyR * 0.42,
        t.y + (hash2(t.seed * 31 + k, t.seed * 17) - 0.5) * t.canopyR * 1.1);
      Q.setFromAxisAngle(UP, hk * 6.28);
      S.set(r, r * 0.82, r);
      col.setHSL(0.29 + hk * 0.05, 0.5, 0.24 + t.seed * 0.1);
      blobs.setColorAt(fi, col);
      blobPhase[fi] = t.seed * 17 + k * 2.4;
      add(blobs, fi++);
    }
    if (t.kind === 'input' && blossoms) {
      for (let k = 0; k < 7 && li < nBlossom; k++) {
        const hk = hash2(t.seed * 53 + k, t.seed * 29 + k * 11);
        V.set(
          t.x + (hk - 0.5) * t.canopyR * 1.9,
          t.trunkH + t.canopyR * (0.5 + hash2(k, t.seed * 71) * 0.9),
          t.y + (hash2(k + 3, t.seed * 83) - 0.5) * t.canopyR * 1.9);
        Q.identity();
        S.set(1, 1, 1);
        add(blossoms, li++);
      }
    }
    for (const it of entry.items) writeItem(it, cur);
    slideEntries.push(entry);
  }
  treeCur = nextCur;
  for (const m of [trunks, branches, blobs, blossoms]) {
    if (!m) continue;
    m.castShadow = true;
    m.instanceMatrix.needsUpdate = true;
    treeGroup.add(m);
  }
  if (blobs.instanceColor) blobs.instanceColor.needsUpdate = true;
  scene.add(treeGroup);
}

function slideTrees(dt) {
  let dirty = null;
  const k = Math.min(1, dt * 4.5);
  for (const e of slideEntries) {
    let dx = e.tgt.x - e.cur.x, dy = e.tgt.y - e.cur.y;
    if (dx * dx + dy * dy < 0.01) continue;
    e.cur.x += dx * k;
    e.cur.y += dy * k;
    for (const it of e.items) writeItem(it, e.cur);
    dirty = dirty || new Set();
    for (const it of e.items) dirty.add(it.mesh);
  }
  if (dirty) for (const m of dirty) m.instanceMatrix.needsUpdate = true;
}

// ── still scenery: pond, rocks, bushes, flowers, seeded by screen size ──────
const clutter = new THREE.Group();
scene.add(clutter);
let water = null;
function buildScenery() {
  clutter.clear();
  const { w, h } = state;
  water = new THREE.Mesh(
    new THREE.CircleGeometry(58, 30),
    new THREE.MeshStandardMaterial({
      color: 0x2e5262, roughness: 0.06, metalness: 0.9,
      envMap: envRT.texture, envMapIntensity: 1.15,
    }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(w * 0.30, 0.3, h * 0.70);
  clutter.add(water);
  reflective.length = 0;
  reflective.push(water);

  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8d90, roughness: 0.9, flatShading: true });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x2f5a22, roughness: 0.95, flatShading: true });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.9 });
  const petalMats = [0xf2f2e8, 0xf0d24a, 0xc77bd8].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
  for (let gx = 0; gx < w; gx += 85) {
    for (let gy = 0; gy < h; gy += 85) {
      const n = hash2(gx * 0.13, gy * 0.17);
      const px = gx + hash2(gx, gy) * 70, py = gy + hash2(gy, gx) * 70;
      if (n < 0.10) {
        const r = 2.5 + n * 30;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
        rock.position.set(px, r * 0.5, py);
        rock.rotation.set(n * 9, n * 17, 0);
        rock.castShadow = true;
        clutter.add(rock);
      } else if (n < 0.20) {
        for (let k = 0; k < 3; k++) {
          const hk = hash2(px + k, py - k);
          const r = 4 + hk * 5;
          const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), bushMat);
          blob.position.set(px + (hk - 0.5) * 10, r * 0.7, py + (hash2(py + k, px) - 0.5) * 10);
          blob.castShadow = true;
          clutter.add(blob);
        }
      } else if (n > 0.86) {
        for (let k = 0; k < 4; k++) {
          const hk = hash2(px * 2 + k, py + k * 7);
          const fx = px + (hk - 0.5) * 26, fy = py + (hash2(k, px) - 0.5) * 26;
          const hgt = 7 + hk * 5;
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, hgt, 4), stemMat);
          stem.position.set(fx, hgt / 2, fy);
          clutter.add(stem);
          const head = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 + hk, 0),
            petalMats[Math.floor(hk * 3) % 3]);
          head.position.set(fx, hgt + 1, fy);
          head.castShadow = true;
          clutter.add(head);
        }
      }
    }
  }
}

// ── food berries ─────────────────────────────────────────────────────────────
const berryMat = new THREE.MeshStandardMaterial({
  color: 0xb92e3a, roughness: 0.15, metalness: 0.05,
  envMap: envRT.texture, envMapIntensity: 0.7,
});
const foodGroup = new THREE.Group();
scene.add(foodGroup);
const berryGeo = new THREE.SphereGeometry(1, 10, 8);
function rebuildFood() {
  foodGroup.clear();
  const geo = berryGeo;
  for (const f of state.food) {
    for (let k = 0; k < 5; k++) {
      const hk = hash2(Math.round(f.x) + k * 3, Math.round(f.y) + k);
      const r = f.r * (0.32 + hk * 0.2);
      const b = new THREE.Mesh(geo, berryMat);
      b.position.set(
        f.x + (hk - 0.5) * f.r * 1.1, r * 0.9,
        f.y + (hash2(k, Math.round(f.x)) - 0.5) * f.r * 1.1);
      b.scale.setScalar(r);
      b.castShadow = true;
      foodGroup.add(b);
    }
  }
  reflective.length = water ? 1 : 0;
  reflective.push(...foodGroup.children);
}

// ── the cursor: a dark mound of earth that prowls the meadow ────────────────
const moundGeo = new THREE.ConeGeometry(11, 32, 9, 3);
{
  const pos = moundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const n = hash2(i * 1.7, i * 0.31) - 0.5;
    pos.setX(i, pos.getX(i) * (1 + n * 0.3));
    pos.setZ(i, pos.getZ(i) * (1 + n * 0.3));
  }
  moundGeo.computeVertexNormals();
}
const mound = new THREE.Mesh(moundGeo,
  new THREE.MeshStandardMaterial({ color: 0x2c241d, roughness: 1, flatShading: true }));
mound.castShadow = true;
mound.position.y = 15;
scene.add(mound);

// ── eye pass: cube render -> equirectangular -> gray bytes to the brain ─────
const eyeRT = new THREE.WebGLCubeRenderTarget(96);
const eyeCam = new THREE.CubeCamera(0.6, 4200, eyeRT);
scene.add(eyeCam);
const panoRT = new THREE.WebGLRenderTarget(PANO_W, PANO_H);
const panoScene = new THREE.Scene();
const panoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const panoQuad = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.ShaderMaterial({
    uniforms: { tCube: { value: eyeRT.texture } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform samplerCube tCube;
      void main() {
        float az = -3.14159265 + vUv.x * 6.2831853;
        float el = (0.5 - vUv.y) * 3.14159265;
        vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
        vec3 c = textureCube(tCube, dir).rgb;
        gl_FragColor = vec4(pow(c, vec3(0.4545)), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  }));
panoQuad.geometry.setAttribute('position', new THREE.Float32BufferAttribute(
  [-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
panoQuad.frustumCulled = false;
panoScene.add(panoQuad);

const panoRGBA = new Uint8Array(PANO_W * PANO_H * 4);
const panoGray = new Uint8Array(PANO_W * PANO_H);
let lastEyeDump = 0;

function eyePass() {
  eyeCam.position.set(state.fly.x, Math.max(1.5, state.fly.alt), state.fly.y);
  eyeCam.update(renderer, scene);
  renderer.setRenderTarget(panoRT);
  renderer.render(panoScene, panoCam);
  renderer.readRenderTargetPixels(panoRT, 0, 0, PANO_W, PANO_H, panoRGBA);
  renderer.setRenderTarget(null);
  for (let i = 0, j = 0; i < panoGray.length; i++, j += 4) {
    panoGray[i] = (panoRGBA[j] * 54 + panoRGBA[j + 1] * 183 + panoRGBA[j + 2] * 19) >> 8;
  }
  ipcRenderer.send('pano', panoGray, PANO_W, PANO_H);
  if (state.shown) drawEyeStrip();
  if (process.env.DESKFLY_EYE_DUMP && performance.now() - lastEyeDump > 2000) {
    lastEyeDump = performance.now();
    dumpEye(process.env.DESKFLY_EYE_DUMP);
  }
}

function drawEyeStrip() {
  const img = eyeCtx.createImageData(PANO_W, PANO_H);
  for (let i = 0, j = 0; i < panoGray.length; i++, j += 4) {
    img.data[j] = img.data[j + 1] = img.data[j + 2] = panoGray[i];
    img.data[j + 3] = 255;
  }
  eyeCanvas.width = PANO_W; eyeCanvas.height = PANO_H;
  eyeCtx.putImageData(img, 0, 0);
}

function dumpEye(file) {
  drawEyeStrip();
  const b64 = eyeCanvas.toDataURL('image/png').split(',')[1];
  try { fs.writeFileSync(file, Buffer.from(b64, 'base64')); } catch {}
}

let lastEnv = -1e9;
function refreshEnv() {
  for (const m of reflective) m.visible = false;
  envCam.position.copy(eyeCam.position);
  envCam.update(renderer, scene);
  for (const m of reflective) m.visible = true;
}

// ── main loop ────────────────────────────────────────────────────────────────
const camPos = new THREE.Vector3(400, 20, 400);
let lastEye = 0;
let lastTick = 0;
const moundPos = new THREE.Vector3(-1e4, 15, -1e4);

function tick(now) {
  uTime.value = now / 1000;
  const dt = Math.min(0.2, Math.max(0.001, (now - lastTick) / 1000));
  lastTick = now;
  slideTrees(dt);
  const f = state.fly;

  const offscreen = state.cursor.x < -5000;
  mound.visible = !offscreen;
  if (!offscreen) {
    moundPos.x += (state.cursor.x - moundPos.x) * 0.35;
    moundPos.z += (state.cursor.y - moundPos.z) * 0.35;
    mound.position.set(moundPos.x, 13, moundPos.z);
    mound.rotation.y = now / 900;
  }

  if (!grassAnchor || Math.hypot(f.x - grassAnchor.x, f.y - grassAnchor.y) > 90) {
    repopulateGrass(f.x, f.y);
  }
  sun.position.set(f.x + sunDir.x * 900, sunDir.y * 900, f.y + sunDir.z * 900);
  sun.target.position.set(f.x, 0, f.y);
  sky.position.set(f.x, 0, f.y);

  if (now - lastEnv > 700) { lastEnv = now; refreshEnv(); }
  if (now - lastEye > 1000 / 15) { lastEye = now; eyePass(); }

  if (state.shown) {
    camPos.set(f.x, Math.max(1.6, f.alt + 1.4), f.y);
    camera.position.copy(camPos);
    const p = f.pitch || 0;
    camera.lookAt(
      camPos.x + Math.cos(p) * Math.cos(f.heading),
      camPos.y + Math.sin(p),
      camPos.z + Math.cos(p) * Math.sin(f.heading));
    renderer.render(scene, camera);
    updateHud();
  }
}

setInterval(() => { if (!state.shown) tick(performance.now()); }, 66);
function raf(now) { if (state.shown) tick(now); requestAnimationFrame(raf); }
requestAnimationFrame(raf);

let hudLast = 0;
function updateHud() {
  const now = performance.now();
  if (now - hudLast < 120) return;
  hudLast = now;
  const f = state.fly;
  const b = state.brain;
  const deg = (v) => Math.round(v * 180 / Math.PI);
  let line1 = `${f.state || '-'}  alt ${f.alt.toFixed(0)}pt  pitch ${deg(f.pitch || 0)}°  heading ${deg(f.heading)}°`;
  let line2 = 'brain: waiting';
  if (b && b.rates) {
    const r = b.rates;
    const hung = b.hunger !== undefined ? `  hunger ${Math.round(b.hunger * 100)}%` : '';
    line2 = `sim ${(b.simSpeed || 0).toFixed(2)}x  vision ${b.vision ? 'on' : 'off'}${hung}  `
      + `GF ${r.gf?.toFixed(1) ?? '-'}  walk ${r.walk?.toFixed(1) ?? '-'}  groom ${r.groom?.toFixed(1) ?? '-'}  `
      + `feed ${r.feed?.toFixed(1) ?? '-'}  loom ${r.loom_l?.toFixed(1) ?? '-'}/${r.loom_r?.toFixed(1) ?? '-'} Hz`;
  }
  hud.textContent = line1 + '\n' + line2;
}

// ── state feed ───────────────────────────────────────────────────────────────
ipcRenderer.on('scene-init', (_e, m) => {
  state.w = m.w; state.h = m.h;
  buildScenery();
});
ipcRenderer.on('scene-walls', (_e, walls) => {
  const key = JSON.stringify(walls);
  if (key === state.wallsKey) return;
  state.wallsKey = key;
  state.walls = walls;
  rebuildTrees();
});
ipcRenderer.on('scene-food', (_e, food) => { state.food = food; rebuildFood(); });
ipcRenderer.on('scene-cursor', (_e, c) => { state.cursor = c; });
ipcRenderer.on('scene-fly', (_e, f) => { state.fly = f; });
ipcRenderer.on('scene-brain', (_e, b) => { state.brain = b; });
ipcRenderer.on('scene-shown', (_e, v) => { state.shown = v; });

buildScenery();
