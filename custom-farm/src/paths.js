/**
 * 路径解析：home 目录里放 overlay / overlay-electron / assets。
 *
 * 默认 home 是 <dataDir>/custom-farm；扩展从 npm 安装时，包内也自带这三个目录，
 * 首次启动会把它们复制过去。之后在「游戏配置 → 安装」里改路径，World 会把 home
 * 搬到新位置并重启桌面图层。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_DIR = resolve(SRC_DIR, '..');

export const HOME_NAME = 'custom-farm';

/** 一个目录是否已经有可用的桌面图层和素材。 */
export function looksLikeHome(dir) {
  if (!dir) return false;
  return existsSync(join(dir, 'overlay', 'overlay.ps1'))
    || (existsSync(join(dir, 'overlay-electron', 'main.js')) && existsSync(join(dir, 'assets', 'sprites')));
}

/** 默认 home：Coopanion 数据目录下的 custom-farm。 */
export function defaultHome(dataDir) {
  return join(dataDir, HOME_NAME);
}

/** 扩展包自带或开发目录里的 overlay / assets 源。 */
export function bundleHome(packageDir) {
  const candidates = [packageDir, resolve(packageDir, '..'), EXTENSION_DIR, resolve(EXTENSION_DIR, '..')];
  for (const dir of candidates) {
    if (looksLikeHome(dir)) return dir;
  }
  return packageDir;
}

export function makePaths(home) {
  return {
    home,
    overlayDir: join(home, 'overlay'),
    overlayScript: join(home, 'overlay', 'overlay-webview.ps1'),
    webviewDir: join(home, 'overlay', 'webview2'),
    overlayState: join(home, 'overlay', 'runtime', 'state.json'),
    electronDir: join(home, 'overlay-electron'),
    assetsDir: join(home, 'assets', 'sprites'),
  };
}
