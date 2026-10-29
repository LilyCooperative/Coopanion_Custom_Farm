/**
 * 从 Coopanion 的 Node 进程拉起 Electron overlay。
 *
 * 默认不下载 Electron：World 会把检测到的 electron.exe 用 --electron 传进来。
 * 只有在没有 --electron 时才退回 require('electron')（本地开发/手动装了备用包）。
 */
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');

function arg(name, fallback = '') {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

let electronPath = arg('electron');
if (!electronPath) {
  try {
    electronPath = require('electron');
  } catch (err) {
    console.error('electron runtime not found: ' + err.message);
    process.exit(2);
  }
}
if (!electronPath || typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
  console.error('electron runtime not found: ' + String(electronPath || '(empty)'));
  process.exit(2);
}

const rawArgs = process.argv.slice(2);
const electronFlag = rawArgs.indexOf('--electron');
if (electronFlag >= 0) rawArgs.splice(electronFlag, 2);
const args = [path.join(__dirname, 'main.js'), ...rawArgs];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, args, {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  env,
});
child.unref();
console.log('electron started pid=' + child.pid);
