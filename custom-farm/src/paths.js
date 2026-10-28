/**
 * 路径解析：所有东西都从扩展自己的位置推出来，不写死本机绝对路径。
 *
 *   <Pet>\custom-farm\src\paths.js   ← 本文件
 *   <Pet>\overlay\overlay.ps1
 *   <Pet>\bag\bag.ps1
 *   <Pet>\assets\sprites\
 *
 * 所以「整个 Pet 文件夹」拷到另一台机器（或换个盘）都能直接用。
 * 扩展被复制进 Coopanion 的 extensions 目录（而不是 link）时，用环境变量
 * PET_HOME 或 World 配置里的 petRoot 指定 <Pet> 在哪。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_DIR = resolve(SRC_DIR, '..');

const looksLikePetHome = (dir) => Boolean(dir) && (
  existsSync(join(dir, 'overlay', 'overlay.ps1')) ||
  (existsSync(join(dir, 'overlay-electron', 'main.js')) && existsSync(join(dir, 'assets', 'sprites')))
);

/** 找到 <Pet> 根目录；找不到就返回 null（图层和背包会被自动关掉，不影响农场本身）。 */
export function resolvePetHome(cfgRoot) {
  const candidates = [];
  if (typeof cfgRoot === 'string' && cfgRoot.trim()) candidates.push(resolve(cfgRoot.trim()));
  const env = process.env.PET_HOME;
  if (env && env.trim()) candidates.push(resolve(env.trim()));
  candidates.push(EXTENSION_DIR);
  candidates.push(resolve(EXTENSION_DIR, '..'));
  for (const dir of candidates) {
    if (looksLikePetHome(dir)) return dir;
  }
  return null;
}

export function makePaths(petHome) {
  const home = petHome ?? resolve(EXTENSION_DIR, '..');
  return {
    home,
    overlayDir: join(home, 'overlay'),
    overlayScript: join(home, 'overlay', 'overlay.ps1'),
    overlayState: join(home, 'overlay', 'runtime', 'state.json'),
    electronDir: join(home, 'overlay-electron'),
    bagScript: join(home, 'bag', 'bag.ps1'),
    assetsDir: join(home, 'assets', 'sprites'),
  };
}
