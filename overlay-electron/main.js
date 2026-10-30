const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const argv = process.argv;
function arg(name, fallback = '') {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

const statePath = path.resolve(arg('state-path', path.join(__dirname, '..', 'overlay', 'runtime', 'state.json')));
const screensPath = path.join(path.dirname(statePath), 'screens.json');
const assetsDir = path.resolve(arg('assets-dir', path.join(__dirname, '..', 'assets', 'sprites')));
const logPath = arg('log', '');
const pidPath = arg('pid', '');
const rawThrottle = String(arg('throttle', 'off'));
const THROTTLE = ['off', 'auto', 'on'].includes(rawThrottle) ? rawThrottle : 'off';
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

let bgWin = null;
let midWin = null;
let topWin = null;
let zorder = null;
let quitting = false;
let leaseAt = Date.now();
let leaseMtime = 0;

/** 主程序停止/卸载后 state.json 不再更新，overlay 自动退出，避免留下桌面残影。 */
function checkLease() {
  try {
    const m = fs.statSync(statePath).mtimeMs;
    if (m !== leaseMtime) { leaseMtime = m; leaseAt = Date.now(); return; }
  } catch { /* 文件不存在按超时处理 */ }
  if (Date.now() - leaseAt > 20000) { log('state lease expired; exiting'); quit(); }
}

function listScreens() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: d.label || ('Display ' + (i + 1)),
    primary: d.id === primary.id,
    width: Math.round(d.bounds.width),
    height: Math.round(d.bounds.height),
  }));
}

function writeScreens() {
  try {
    fs.mkdirSync(path.dirname(screensPath), { recursive: true });
    fs.writeFileSync(screensPath, JSON.stringify(listScreens(), null, 2), 'utf8');
  } catch (e) { log('screens.json failed: ' + e.message); }
}

function displayFor(st) {
  const all = screen.getAllDisplays();
  const id = String(st?.screen ?? '');
  return all.find((d) => String(d.id) === id) || screen.getPrimaryDisplay();
}

function bounds() {
  const st = readState() || {};
  const h = Math.min(800, Math.max(120, Number(st.stripHeight) || 320));
  const wa = displayFor(st).workArea;
  return { x: Math.round(wa.x), y: Math.round(wa.y + wa.height - h), width: Math.round(wa.width), height: h };
}

function hwndOf(win) {
  try {
    const buf = win.getNativeWindowHandle();
    return buf.readBigUInt64LE(0).toString();
  } catch { return ''; }
}

function startZOrder() {
  if (quitting || !bgWin || !midWin || !topWin) return;
  if (zorder && !zorder.killed) return;
  const bg = hwndOf(bgWin);
  const mid = hwndOf(midWin);
  const top = hwndOf(topWin);
  if (!bg || !mid || !top) return;
  try {
    zorder = spawn('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(__dirname, 'zorder.ps1'), '-Bg', bg, '-Mid', mid, '-Top', top],
      { stdio: 'ignore', windowsHide: true });
    zorder.on('exit', () => {
      log('zorder helper exited');
      zorder = null;
      if (!quitting) setTimeout(startZOrder, 1500);
    });
    zorder.on('error', (e) => { log('zorder helper error: ' + e.message); zorder = null; });
  } catch (e) {
    log('zorder helper spawn failed: ' + e.message);
  }
}

function createWindow(layer) {
  const b = bounds();
  const win = new BrowserWindow({
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
      backgroundThrottling: THROTTLE !== 'off',
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  if (THROTTLE === 'off') win.webContents.setBackgroundThrottling(false);
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { }
  win.loadFile(path.join(__dirname, 'renderer.html'), { query: { state: statePath, assets: assetsDir, layer } });
  win.once('ready-to-show', () => {
    win.showInactive();
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(true, 'screen-saver');
        log(layer + ' window shown');
      }
    }, 300);
  });
  win.on('closed', () => { if (!quitting) quit(); });
  log(layer + ' window ' + b.width + 'x' + b.height + ' at ' + b.x + ',' + b.y);
  return win;
}

function fit() {
  if (!bgWin || !midWin || !topWin) return;
  const b = bounds();
  for (const win of [bgWin, midWin, topWin]) {
    if (win.isDestroyed()) continue;
    const cur = win.getBounds();
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) {
      win.setBounds(b);
      win.webContents.send('resize');
    }
  }
}

app.commandLine.appendSwitch('enable-transparent-visuals');
if (THROTTLE === 'off') {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (topWin && !topWin.isDestroyed()) topWin.showInactive(); });
  app.whenReady().then(() => {
    writePid();
    writeScreens();
    bgWin = createWindow('bg');
    midWin = createWindow('mid');
    topWin = createWindow('top');
    setTimeout(startZOrder, 800);
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, fit);
    setInterval(checkLease, 5000);
    setInterval(fit, 1000);
    // 扩展升级会覆盖图层脚本；旧进程继续跑会出现新旧 zorder/渲染代码混用，主动退出让 World 拉起新代码。
    const watched = [__filename, path.join(__dirname, 'zorder.ps1'), path.join(__dirname, 'renderer.js')];
    const stamp = () => watched.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join(',');
    const initial = stamp();
    setInterval(() => {
      if (stamp() !== initial) { log('layer files changed; restarting overlay'); quit(); }
    }, 3000);
  });
}

function quit() {
  quitting = true;
  clearPid();
  try { if (zorder && !zorder.killed) zorder.kill(); } catch { }
  zorder = null;
  for (const win of [bgWin, midWin, topWin]) {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch { }
  }
  bgWin = null;
  midWin = null;
  topWin = null;
  if (logStream) logStream.end();
  app.quit();
}
process.on('SIGTERM', quit);
process.on('SIGINT', quit);
app.on('before-quit', clearPid);
app.on('window-all-closed', () => quit());
