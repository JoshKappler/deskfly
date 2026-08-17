const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage } = require('electron');
const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { World, renderPano } = require('./world.js');

const HELPER = path.join(__dirname, '..', 'helper', 'perchscan');
const BRAIN_DIR = path.join(__dirname, '..', 'brain');
const PANO_W = 180;
const PANO_H = 90;

let win = null;
let tray = null;
let viewer = null;
let brainWorker = null;
let paused = false;
let brainStatus = 'starting';
let world = null;
let flyState = { x: 400, y: 400, heading: 0, z: 1 };
let lastRates = null;

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
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: paused ? 'Resume' : 'Pause', click: togglePause },
    { label: 'What the fly sees', click: toggleViewer },
    { label: `Brain: ${brainStatus}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function togglePause() {
  paused = !paused;
  if (win) win.webContents.send('pause', paused);
  updateTray();
}

function startTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('\u{1FAB0}');
  updateTray();
}

function startCursorFeed() {
  setInterval(() => {
    if (!win || paused) return;
    const c = screen.getCursorScreenPoint();
    world.cursor = c;
    win.webContents.send('cursor', c);
  }, 33);
}

function startPerchScan() {
  if (!fs.existsSync(HELPER)) {
    console.log('perchscan helper missing (npm run build:helper); using screen edges only');
    return;
  }
  const scan = () => {
    if (!win || paused) return;
    execFile(HELPER, { timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err || !win) return;
      try {
        const parsed = JSON.parse(out);
        world.setLedges(parsed.ledges || []);
        win.webContents.send('perches', parsed);
      } catch {}
    });
  };
  setTimeout(scan, 1500);
  setInterval(scan, 2500);
}

function sendWorld() {
  if (win) win.webContents.send('world', { food: world.food });
}

function startFood() {
  const d = screen.getPrimaryDisplay();
  const spawn = () => {
    if (world.food.length >= 3) return;
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
  spawn();
  setInterval(spawn, 25000);
}

// the fly's visual world: rendered as a spherical panorama for the eye
function startPanoFeed() {
  setInterval(() => {
    if (!brainWorker || paused) return;
    const data = new Uint8Array(PANO_W * PANO_H);
    renderPano(world, flyState, { w: PANO_W, h: PANO_H, data }, false);
    brainWorker.postMessage({ type: 'pano', data: data.buffer, w: PANO_W, h: PANO_H }, [data.buffer]);
  }, Math.round(1000 / 15));
}

function toggleViewer() {
  if (viewer) { viewer.close(); return; }
  viewer = new BrowserWindow({
    width: 736,
    height: 430,
    title: 'deskfly: what the fly sees',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  viewer.loadFile(path.join(__dirname, 'viewer.html'));
  viewer.on('closed', () => { viewer = null; });
  const timer = setInterval(() => {
    if (!viewer) { clearInterval(timer); return; }
    viewer.webContents.send('viewstate', {
      walls: world.walls,
      food: world.food,
      cursor: world.cursor,
      fly: flyState,
      brain: lastRates,
    });
  }, 66);
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
      if (process.env.DESKFLY_LOG_RATES && Date.now() - lastLog > 2000) {
        lastLog = Date.now();
        const r = Object.fromEntries(Object.entries(m.rates).map(([k, v]) => [k, +v.toFixed(1)]));
        console.log('[rates]', JSON.stringify(r), 'speed', m.simSpeed.toFixed(2),
          'active', m.activeN, 'fly', flyState.state,
          Math.round(flyState.x) + ',' + Math.round(flyState.y));
      }
    }
    if (win) win.webContents.send('brain', m);
  });
  brainWorker.on('error', (e) => { brainStatus = `error: ${e.message}`; updateTray(); });
  ipcMain.on('stim', (_e, s) => { if (brainWorker) brainWorker.postMessage({ type: 'stim', ...s }); });
  ipcMain.on('fly', (_e, s) => {
    flyState = s;
    if (brainWorker) brainWorker.postMessage({ type: 'fly', ...s });
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
    if (!win) return;
    try {
      const img = await win.webContents.capturePage(r);
      fs.writeFileSync('/tmp/deskfly-cap.png', img.toPNG());
    } catch {}
  }, 1500);
}

const PID_FILE = '/tmp/deskfly.pid';

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}
  process.on('SIGUSR2', toggleViewer); // external hotkey hook: toggles the viewer
  const d = screen.getPrimaryDisplay();
  world = new World(d.bounds.width, d.bounds.height);
  createWindow();
  startTray();
  startCursorFeed();
  startPerchScan();
  startBrain();
  startFood();
  startPanoFeed();
  if (process.env.DESKFLY_CAPTURE) startCapture();
  if (process.env.DESKFLY_VIEWER_SHOT) {
    setTimeout(toggleViewer, 3000);
    setTimeout(async () => {
      if (!viewer) return;
      const img = await viewer.webContents.capturePage();
      fs.writeFileSync(process.env.DESKFLY_VIEWER_SHOT, img.toPNG());
    }, 9000);
  }
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { try { fs.unlinkSync(PID_FILE); } catch {} });
