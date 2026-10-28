/**
 * 从 Coopanion 的 Node 进程拉起 Electron overlay。
 * 由 World 用 node 启动；electron 是 optionalDependency。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

let electronPath;
try {
  electronPath = require('electron');
} catch (err) {
  console.error('electron not installed: ' + err.message);
  process.exit(2);
}
if (typeof electronPath !== 'string' || !electronPath) {
  console.error('electron binary path not found');
  process.exit(2);
}

const args = [path.join(__dirname, 'main.js'), ...process.argv.slice(2)];
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
