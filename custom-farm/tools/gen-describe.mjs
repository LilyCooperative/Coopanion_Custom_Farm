import { writeFile } from 'node:fs/promises';
import definition from '../src/index.js';
const out = { tools: definition.describe.tools, events: definition.describe.events };
await writeFile(new URL('../describe.json', import.meta.url), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('describe.json:', out.tools.length, 'tools,', out.events.length, 'events');
