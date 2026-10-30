import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { FarmCatalog } from '../src/catalog.js';
import { DEFAULTS } from '../src/farm.js';
import { buildZip } from '../src/zip.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const spritesDir = join(root, '..', 'assets', 'sprites');
const outDir = join(root, 'templates');
const work = await mkdtemp(join(tmpdir(), 'cfarm-template-'));
const catalog = new FarmCatalog({ storePath: join(work, 'custom.json'), spritesDir, pointsPerDay: 288 });
catalog.load();
catalog.persist();
const custom = await readFile(catalog.storePath);

const keys = [
  'farmScale','maxPlants','cropGapScale','cropGapPct','cropScale','dropScale','groundHeight','stripHeight',
  'moodIntervalMin','startCoins','pointsPerDay','realMinutesPerDay','maxStepDays','tickIntervalMs','dryPerDay',
  'waterGain','wiltDays','startWeeds','maxWeeds','weedPerDay','weedClearRadius','dailyEvent','sowMoisture','throttle',
];
const world = Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]]).filter(([,v]) => v !== undefined));
const env = await readFile(join(root, 'src', 'ENV_PROMPT.md'));
const files = await readdir(spritesDir).catch(() => []);
const referenced = new Set();
const collect = (v) => {
  if (typeof v === 'string') { if (/^[A-Za-z0-9_-]+$/.test(v)) referenced.add(v); }
  else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === 'object') Object.values(v).forEach(collect);
};
collect(JSON.parse(custom.toString('utf8')));
const entries = [
  { name: 'template.json', data: Buffer.from(JSON.stringify({ format:'custom-farm-template', version:1, name:'田园农场', builtAt:new Date().toISOString() }, null, 2)) },
  { name: 'custom.json', data: custom },
  { name: 'world.json', data: Buffer.from(JSON.stringify(world, null, 2)) },
  { name: 'env-prompt.md', data: env },
];
for (const file of files.sort()) {
  const base = file.replace(/\.png$/i, '');
  if (!/^[A-Za-z0-9_-]+\.png$/i.test(file)) continue;
  if (!referenced.has(base)) continue;
  entries.push({ name: 'sprites/' + file, data: await readFile(join(spritesDir, file)) });
}
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'tianye-farm.zip'), buildZip(entries));
await rm(work, { recursive:true, force:true });
console.log('template entries', entries.length, '->', join(outDir, 'tianye-farm.zip'));
