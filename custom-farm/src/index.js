/**
 * 扩展入口：默认导出必须是 WorldDefinition（package.json 里 cortico.kind = world、api = 6）。
 */
import { CROPS, ROTATION } from './crops.js';
import { DEFAULTS, overlayView, summary } from './farm.js';
import { FARM_TOOL_DECLS, FarmWorld, screenOptions } from './world.js';

const TOOL_SUMMARIES = {
  cfarm_status: {
    zh: '看田：每棵作物的位置、等级、进度、水分、是否可收/枯萎，外加背包、地上的掉落物、摆放的装饰物位置和最近田里的变化（少了哪棵、为什么）。',
    en: 'Show every plant (position, level, progress, moisture, ripe/wilted) plus the bag, the drops, placed decorations and recent field changes (which plant is gone and why).',
  },
  cfarm_clear: {
    zh: '铲掉脚下活/枯作物或杂草，不产生收获物；用户说拔掉/铲掉时用它。',
    en: 'Clear a live/dead crop or weed at your feet without harvesting; use it for explicit removal.',
  },
  cfarm_quickfarm: {
    zh: '一次完成附近收、捡、补种、浇水；配合 pet_move_to 使用。',
    en: 'Harvest, collect, replant and water nearby in one call after pet_move_to.',
  },
  cfarm_stand: {
    zh: '站到某个位置（at 必填），播种/收割/捡东西都要先站过去。',
    en: 'Stand at a position (at is required); planting, harvesting and collecting all need it.',
  },
  cfarm_plant: {
    zh: '在脚下种一棵：要消耗 1 包对应种子（种子在背包里，没有就自己补 1~2 包），位置可自己挑，两棵不能重叠。',
    en: 'Plant one at your feet; consumes one seed pack from the bag (restock 1–2 packs yourself if empty), position optional, no overlap.',
  },
  cfarm_water: {
    zh: '浇水：一次浇透脚下够得着的一片（含旁边几棵），已经浇透的会跳过。',
    en: 'Water the whole reachable patch in one call (neighbours included); already-full plants are skipped.',
  },
  cfarm_harvest: {
    zh: '收脚下这棵熟的，产物掉在地上，要用 cfarm_collect 捡。',
    en: 'Harvest the ripe plant at your feet; the produce drops on the ground and must be collected.',
  },
  cfarm_collect: {
    zh: '把脚下的掉落物收进背包。',
    en: 'Pick up the drops around your feet into the bag.',
  },
  cfarm_consume: {
    zh: '吃掉背包里的作物/杂草收获物，缓解「饥饿」这类状态（要主人在状态自定义里配好消耗行为）。',
    en: 'Eat a crop/weed produce to relieve states like hunger (configured in the status page).',
  },
  cfarm_craft: {
    zh: '按「道具合成表」消耗背包材料合成道具；不填 recipe 就列出所有表。',
    en: 'Craft from the configured recipes; without recipe it lists all recipes.',
  },
};

function describeTools(decls) {
  return decls.map(({ name, description, parameters, tags }) => ({
    name,
    description,
    parameters,
    tags,
    summary: TOOL_SUMMARIES[name],
  }));
}

export const farmDefinition = {
  id: 'farm',
  label: '自定义农场',
  defaults: () => structuredClone(DEFAULTS),
  preflight: () => {
    if (typeof structuredClone !== 'function') throw new Error('自定义农场需要 Node 22+ 的 structuredClone。');
  },
  create: (ctx) => new FarmWorld({
    id: ctx.id,
    cfg: ctx.cfg,
    dataDir: ctx.dataDir,
    botDir: ctx.botDir,
    packageDir: ctx.packageDir,
    persist: (patch) => ctx.persist(patch),
    restart: () => ctx.restart(),
  }),
  configOptions: (kind, language) => {
    if (kind === 'farm-screens') return screenOptions(language);
    if (kind === 'farm-engines') {
      const zh = String(language).toLowerCase().startsWith('zh');
      return [
        { value: 'auto', label: zh ? '自动（有备用 Electron 就用，否则 WPF/WebView2）' : 'Auto (fallback Electron, else WPF/WebView2)' },
        { value: 'electron', label: zh ? '备用 Electron（需要 electron.exe）' : 'Fallback Electron (needs electron.exe)' },
        { value: 'wpf', label: zh ? 'WPF/WebView2（不需要 Electron）' : 'WPF/WebView2 (no Electron)' },
      ];
    }
    if (kind === 'farm-modes') {
      const zh = String(language).toLowerCase().startsWith('zh');
      return [
        { value: 'independent', label: zh ? '请求全部独立（每次只做一个动作）' : 'Independent requests (one action per request)' },
        { value: 'merge', label: zh ? '请求部分合并（走过去后一次收获/补种/浇水）' : 'Partly merged (walk once, then harvest/replant/water)' },
        { value: 'auto', label: zh ? '全自动无请求（自动收、买种、补种、浇水）' : 'Fully automatic (harvest, buy, replant, water without requests)' },
      ];
    }
    if (kind === 'farm-throttle') {
      const zh = String(language).toLowerCase().startsWith('zh');
      return [
        { value: 'off', label: zh ? '不节流（默认，推荐）' : 'Off (default, recommended)' },
        { value: 'auto', label: zh ? '自动（交给 Chromium）' : 'Auto (Chromium decides)' },
        { value: 'on', label: zh ? '节流（后台/遮挡时降帧）' : 'On (throttle when backgrounded/occluded)' },
      ];
    }
    return [];
  },
  describe: {
    tools: describeTools(FARM_TOOL_DECLS),
    events: [
      {
        type: 'cfarm.ripe',
        description: {
          zh: '有作物成熟了；正文写明哪几棵、在屏幕底部百分之几，并提示走过去收、收完再捡。',
          en: 'Some plants ripened; the text names them and their position, and says to walk over, harvest, then collect.',
        },
        trigger: 'debounce',
      },
      {
        type: 'cfarm.dry',
        description: {
          zh: '有作物土太干了；正文列出哪几棵、在屏幕底部百分之几，提示走过去浇水。',
          en: 'Some plants are running dry; the text names them and their position and says to water them.',
        },
        trigger: 'debounce',
      },
      {
        type: 'cfarm.work',
        description: {
          zh: '请求部分合并模式下，成熟/缺水的地块被合并成一条；正文带位置，提示 pet_move_to 后一次 cfarm_quickfarm 完成收、捡、补种、浇水。',
          en: 'In partly-merged mode, ripe/dry plots are combined into one event; it gives the position and says to use one cfarm_quickfarm after pet_move_to.',
        },
        trigger: 'debounce',
      },
      {
        type: 'cfarm.day',
        description: {
          zh: '翻到新的一天；正文带上天气、可收数量、地上的掉落物、土干的数量和背包件数。',
          en: 'A new day started: weather, ripe count, drops on the ground, dry plants and bag size.',
        },
        trigger: 'debounce',
      },
      {
        type: 'cfarm.state',
        description: {
          zh: '自定义状态进入「桌宠主动消耗」时触发：正文列出消耗品池里当前可用的道具，让桌宠自己用 cfarm_consume 挑；随机消耗不推这条事件。',
          en: 'A custom state in pet-choice consume mode fires: the text lists available items so the pet can pick one with cfarm_consume; random consume does not emit this event.',
        },
        trigger: 'debounce',
      },
      {
        type: 'cfarm.product',
        description: {
          zh: '动物产物掉在地上；正文写明产物、数量和屏幕位置，提示走过去 cfarm_stand 再 cfarm_collect。',
          en: 'An animal product dropped on the ground; the text names it, its amount and position, and says to walk over and collect.',
        },
        trigger: 'debounce',
      },
      {
        type: 'cfarm.env',
        description: {
          zh: '第一次启用时环境自检发现 Electron/WPF 运行时缺失；正文说明缺什么、怎么在「游戏配置 → 环境自检」里修复，让桌宠转告主人。',
          en: 'The first-start environment check found a missing Electron/WPF runtime; the text says what is missing and how to fix it in Game Config → Environment check, so the pet can tell its owner.',
        },
        trigger: 'debounce',
      },
    ],
  },
};

export default farmDefinition;
export { FarmWorld, FARM_TOOL_DECLS };
export { CROPS, ROTATION };
export { DEFAULTS as FARM_DEFAULTS, STATE_VERSION, X_MIN, X_MAX } from './farm.js';
export { advance, collect, harvest, overlayView, plant, stand, summary, water } from './farm.js';
