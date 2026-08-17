const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage } = require('electron');
const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { World } = require('./world.js');

const HELPER = path.join(__dirname, '..', 'helper', 'perchscan');
const BRAIN_DIR = path.join(__dirname, '..', 'brain');
const PID_FILE = '/tmp/deskfly.pid';

let win = null;
let tray = null;
let sceneWin = null;
let viewerShown = false;
let brainWorker = null;
let paused = false;
let brainStatus = 'starting';
let world = null;
let screenEdges = [];
let flyState = { x: 400, y: 400, heading: 0, z: 1, alt: 20, pitch: 0 };
let lastRates = null;

function alive(w) {
  return w && !w.isDestroyed() && !w.webContents.isDestroyed();
}

function wSend(ch, payload) {
  if (alive(win)) win.webContents.send(ch, payload);
}

function createWindow() {
  const d = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  const query = { size: process.env.DESKFLY_SIZE || '18' };
  if (process.env.DESKFLY_POSE) {
    query.pose = process.env.DESKFLY_POSE;
    query.zoom = process.env.DESKFLY_ZOOM || '1';
  }
  win.loadFile(path.join(__dirname, 'index.html'), { query });
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => { win = null; });
}

// the 3D world lives here: hidden it still renders the fly's eye panorama,
// shown it is the "what the fly sees" viewer
function createSceneWindow() {
  const d = screen.getPrimaryDisplay();
  sceneWin = new BrowserWindow({
    width: 980,
    height: 560,
    show: false,
    title: 'deskfly: what the fly sees',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  sceneWin.loadFile(path.join(__dirname, 'scene.html'));
  sceneWin.webContents.on('did-finish-load', () => {
    sceneWin.webContents.send('scene-init', { w: d.bounds.width, h: d.bounds.height });
    sceneWin.webContents.send('scene-walls', world.walls);
    sceneWin.webContents.send('scene-food', world.food);
  });
  sceneWin.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); setViewer(false); }
  });
  sceneWin.on('closed', () => { sceneWin = null; });
}

function sceneSend(ch, payload) {
  if (alive(sceneWin)) sceneWin.webContents.send(ch, payload);
}

function setViewer(on) {
  viewerShown = on;
  if (!sceneWin) return;
  if (on) sceneWin.show();
  else sceneWin.hide();
  sceneSend('scene-shown', on);
  updateTray();
}

function toggleViewer() { setViewer(!viewerShown); }

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: paused ? 'Resume' : 'Pause', click: togglePause },
    { label: viewerShown ? 'Hide what the fly sees' : 'What the fly sees', click: toggleViewer },
    { label: `Brain: ${brainStatus}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function togglePause() {
  paused = !paused;
  wSend('pause', paused);
  updateTray();
}

function startTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('\u{1FAB0}');
  updateTray();
}

function startCursorFeed() {
  setInterval(() => {
    if (!alive(win) || paused) return;
    const c = screen.getCursorScreenPoint();
    world.cursor = c;
    wSend('cursor', c);
    sceneSend('scene-cursor', c);
  }, 33);
}

function startPerchScan() {
  if (!fs.existsSync(HELPER)) {
    console.log('perchscan helper missing (npm run build:helper); using screen edges only');
    world.setLedges(screenEdges);
    sceneSend('scene-walls', world.walls);
    return;
  }
  const scan = () => {
    if (!alive(win) || paused) return;
    execFile(HELPER, { timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err || !alive(win)) return;
      try {
        const parsed = JSON.parse(out);
        world.setLedges((parsed.ledges || []).concat(screenEdges));
        wSend('perches', parsed);
        sceneSend('scene-walls', world.walls);
      } catch {}
    });
  };
  setTimeout(scan, 1500);
  setInterval(scan, 2500);
}

function sendWorld() {
  wSend('world', { food: world.food });
  sceneSend('scene-food', world.food);
}

function startFood() {
  const d = screen.getPrimaryDisplay();
  const spawn = () => {
    if (world.food.length >= 7) return;
    world.food.push({
      x: 60 + Math.random() * (d.bounds.width - 120),
      y: 80 + Math.random() * (d.bounds.height - 160),
      r: 7,
      amount: 1,
    });
    sendWorld();
  };
  ipcMain.on('ate', (_e, index, amt) => {
    const f = world.food[index];
    if (!f) return;
    f.amount -= amt;
    if (f.amount <= 0) world.food.splice(index, 1);
    else f.r = 4 + 3 * f.amount;
    sendWorld();
  });
  spawn(); spawn(); spawn();
  setInterval(spawn, 12000);
}

function startBrain() {
  brainWorker = new Worker(path.join(BRAIN_DIR, 'worker.js'), {
    workerData: { dataDir: path.join(BRAIN_DIR, 'data') },
  });
  let lastLog = 0;
  brainWorker.on('message', (m) => {
    if (m.type === 'status') { brainStatus = m.text; updateTray(); console.log('[brain]', m.text); }
    if (m.type === 'rates') {
      lastRates = m;
      sceneSend('scene-brain', m);
      if (process.env.DESKFLY_LOG_RATES && Date.now() - lastLog > 2000) {
        lastLog = Date.now();
        const r = Object.fromEntries(Object.entries(m.rates).map(([k, v]) => [k, +v.toFixed(1)]));
        console.log('[rates]', JSON.stringify(r), 'speed', m.simSpeed.toFixed(2),
          'active', m.activeN, 'fly', flyState.state,
          Math.round(flyState.x) + ',' + Math.round(flyState.y), 'alt', Math.round(flyState.alt || 0));
      }
    }
    wSend('brain', m);
  });
  brainWorker.on('error', (e) => { brainStatus = `error: ${e.message}`; updateTray(); });
  ipcMain.on('stim', (_e, s) => { if (brainWorker) brainWorker.postMessage({ type: 'stim', ...s }); });
  ipcMain.on('fly', (_e, s) => {
    flyState = s;
    sceneSend('scene-fly', s);
    if (brainWorker) brainWorker.postMessage({ type: 'fly', ...s });
  });
  ipcMain.on('pano', (_e, data, w, h) => {
    if (!brainWorker || paused) return;
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    brainWorker.postMessage({ type: 'pano', data: buf, w, h }, [buf]);
  });
}

function startCapture() {
  const d = screen.getPrimaryDisplay();
  const side = Number(process.env.DESKFLY_CAPTURE) > 1 ? Number(process.env.DESKFLY_CAPTURE) : 340;
  const r = {
    x: Math.round(d.bounds.width / 2) - Math.round(side / 2),
    y: Math.round(d.bounds.height / 2) - Math.round(side / 2),
    width: side,
    height: side,
  };
  setInterval(async () => {
    if (!alive(win)) return;
    try {
      const img = await win.webContents.capturePage(r);
      fs.writeFileSync('/tmp/deskfly-cap.png', img.toPNG());
    } catch {}
  }, 1500);
}

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}
  process.on('SIGUSR2', toggleViewer); // external hotkey hook: toggles the viewer
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { app.isQuitting = true; app.quit(); });
  }
  const d = screen.getPrimaryDisplay();
  world = new World(d.bounds.width, d.bounds.height);
  screenEdges = [
    { dir: 'h', x0: 0, x1: d.bounds.width, y: 25, kind: 'screen' },
    { dir: 'h', x0: 0, x1: d.bounds.width, y: d.bounds.height - 3, kind: 'screen' },
    { dir: 'v', y0: 30, y1: d.bounds.height - 6, x: 3, kind: 'screen' },
    { dir: 'v', y0: 30, y1: d.bounds.height - 6, x: d.bounds.width - 3, kind: 'screen' },
  ];
  world.setLedges(screenEdges);
  createWindow();
  createSceneWindow();
  startTray();
  startCursorFeed();
  startPerchScan();
  startBrain();
  startFood();
  if (process.env.DESKFLY_CAPTURE) startCapture();
  if (process.env.DESKFLY_VIEWER_SHOT) {
    setTimeout(() => setViewer(true), 3000);
    setTimeout(async () => {
      if (!alive(sceneWin)) return;
      const img = await sceneWin.webContents.capturePage();
      fs.writeFileSync(process.env.DESKFLY_VIEWER_SHOT, img.toPNG());
    }, 11000);
  }
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { try { fs.unlinkSync(PID_FILE); } catch {} });
