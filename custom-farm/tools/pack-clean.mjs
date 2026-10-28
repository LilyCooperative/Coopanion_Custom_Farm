/** npm pack 后清理 pack-prepare 临时复制进来的 overlay / overlay-electron / assets。 */
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
for (const name of ['overlay', 'overlay-electron', 'assets']) {
  rmSync(join(pkg, name), { recursive: true, force: true });
}
console.log('pack-clean: removed temporary overlay, overlay-electron, assets');
