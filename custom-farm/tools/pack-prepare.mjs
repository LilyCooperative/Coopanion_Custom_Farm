/**
 * npm pack 前置：把项目根目录下与扩展同级的 overlay / overlay-electron / assets
 * 复制进 custom-farm 包内，让安装后的扩展自带图层和素材。
 *
 * 仓库里这三块放在项目根目录，方便本地开发；只有打包时临时复制，
 * postpack 再清掉，避免在 custom-farm/ 里出现第二份长期副本。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const root = resolve(pkg, '..');
const dirs = ['overlay', 'overlay-electron', 'assets'];

for (const name of dirs) {
  const src = join(root, name);
  const dst = join(pkg, name);
  if (!existsSync(src)) throw new Error('找不到 ' + src);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(pkg, { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    filter: (path) => {
      const normalized = path.replace(/\\/g, '/');
      if (normalized.includes('/overlay/runtime')) return false;
      if (normalized.includes('/overlay-electron/node_modules')) return false;
      if (normalized.endsWith('.log') || normalized.endsWith('.pid')) return false;
      return true;
    },
  });
}
console.log('pack-prepare: copied overlay, overlay-electron, assets into custom-farm/');
