const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv;
function arg(name, fallback = '') {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

const statePath = path.resolve(arg('state-path', path.join(__dirname, '..', 'overlay', 'runtime', 'state.json')));
const assetsDir = path.resolve(arg('assets-dir', path.join(__dirname, '..', 'assets', 'sprites')));
const logPath = arg('log', '');
const pidPath = arg('pid', '');
const capturePath = arg('capture', '');
const logStream = logPath ? fs.createWriteStream(logPath, { flags: 'a' }) : null;
function log(s) {
  const line = new Date().toISOString() + ' [electron] ' + s + '\n';
  if (logStream) logStream.write(line);
}

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return null; }
}

function writePid() {
  if (!pidPath) return;
  try { fs.mkdirSync(path.dirname(pidPath), { recursive: true }); fs.writeFileSync(pidPath, String(process.pid)); } catch { }
}
function clearPid() {
  if (!pidPath) return;
  try { if (fs.readFileSync(pidPath, 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidPath); } catch { }
}

let win = null;
let leaseMtime = 0;
let leaseAt = Date.now();

/** 主程序停止/卸载后 state.json 不再更新，overlay 自动退出，避免留下桌面残影。 */
function checkLease() {
  try {
    const m = fs.statSync(statePath).mtimeMs;
    if (m !== leaseMtime) { leaseMtime = m; leaseAt = Date.now(); return; }
  } catch { /* 文件不存在按超时处理 */ }
  if (Date.now() - leaseAt > 20000) { log('state lease expired; exiting'); quit(); }
}


function bounds() {
  const st = readState() || {};
  const h = Math.min(800, Math.max(120, Number(st.stripHeight) || 320));
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(wa.x), y: Math.round(wa.y + wa.height - h), width: Math.round(wa.width), height: h };
}

function createWindow() {
  const b = bounds();
  win = new BrowserWindow({
    ...b,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { }
  win.loadFile(path.join(__dirname, 'renderer.html'), {
    query: { state: statePath, assets: assetsDir },
  });
  if (capturePath) setTimeout(async () => { try { const image = await win.webContents.capturePage(); fs.writeFileSync(capturePath, image.toPNG()); log('capture ' + capturePath); } catch (e) { log('capture failed ' + e.message); } }, 3000);
  win.once('ready-to-show', () => {
    win.show();
    setTimeout(() => {
      if (!win) return;
      win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
      log('window shown / topmost');
    }, 500);
  });
  win.on('closed', () => { win = null; });
  log('window ' + b.width + 'x' + b.height + ' at ' + b.x + ',' + b.y);
}

app.commandLine.appendSwitch('enable-transparent-visuals');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) win.showInactive(); });
  app.whenReady().then(() => {
    writePid();
    createWindow();
    screen.on('display-metrics-changed', () => {
      if (!win) return;
      const b = bounds();
      win.setBounds(b);
      win.webContents.send('resize');
    });
    setInterval(checkLease, 5000);
    setInterval(() => {
      if (!win) return;
      const st = readState() || {};
      const h = Math.min(800, Math.max(120, Number(st.stripHeight) || 320));
      const b = bounds();
      if (win.getBounds().height !== h) { win.setBounds(b); win.webContents.send('resize'); }
    }, 1000);
  });
}

function quit() { clearPid(); if (logStream) logStream.end(); app.quit(); }
process.on('SIGTERM', quit);
process.on('SIGINT', quit);
app.on('before-quit', clearPid);
app.on('window-all-closed', () => quit());
