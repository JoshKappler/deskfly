const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage } = require('electron');
const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const HELPER = path.join(__dirname, '..', 'helper', 'perchscan');
const BRAIN_DIR = path.join(__dirname, '..', 'brain');

let win = null;
let tray = null;
let brainWorker = null;
let paused = false;
let brainStatus = 'starting';

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
    if (win && !paused) win.webContents.send('cursor', screen.getCursorScreenPoint());
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
      try { win.webContents.send('perches', JSON.parse(out)); } catch {}
    });
  };
  setTimeout(scan, 1500);
  setInterval(scan, 2500);
}

function startBrain() {
  brainWorker = new Worker(path.join(BRAIN_DIR, 'worker.js'), {
    workerData: { dataDir: path.join(BRAIN_DIR, 'data') },
  });
  brainWorker.on('message', (m) => {
    if (m.type === 'status') { brainStatus = m.text; updateTray(); console.log('[brain]', m.text); }
    if (win) win.webContents.send('brain', m);
  });
  brainWorker.on('error', (e) => { brainStatus = `error: ${e.message}`; updateTray(); });
  ipcMain.on('stim', (_e, s) => { if (brainWorker) brainWorker.postMessage({ type: 'stim', ...s }); });
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

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  createWindow();
  startTray();
  startCursorFeed();
  startPerchScan();
  startBrain();
  if (process.env.DESKFLY_CAPTURE) startCapture();
});

app.on('window-all-closed', () => app.quit());
