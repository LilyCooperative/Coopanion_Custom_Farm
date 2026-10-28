/**
 * 扩展入口：默认导出必须是 WorldDefinition（package.json 里 cortico.kind = world、api = 6）。
 */
import { CROPS, ROTATION } from './crops.js';
import { DEFAULTS, overlayView, summary } from './farm.js';
import { FARM_TOOL_DECLS, FarmWorld } from './world.js';

const TOOL_SUMMARIES = {
  farm_status: {
    zh: '看田：每棵作物的位置、等级、进度、水分、是否可收/枯萎，外加背包、地上的掉落物、摆放的装饰物位置和最近田里的变化（少了哪棵、为什么）。',
    en: 'Show every plant (position, level, progress, moisture, ripe/wilted) plus the bag, the drops, placed decorations and recent field changes (which plant is gone and why).',
  },
  farm_stand: {
    zh: '站到某个位置（at 必填），播种/收割/捡东西都要先站过去。',
    en: 'Stand at a position (at is required); planting, harvesting and collecting all need it.',
  },
  farm_plant: {
    zh: '在脚下种一棵：要消耗 1 包对应种子（种子在背包里，没有就自己补 1~2 包），位置可自己挑，两棵不能重叠。',
    en: 'Plant one at your feet; consumes one seed pack from the bag (restock 1–2 packs yourself if empty), position optional, no overlap.',
  },
  farm_water: {
    zh: '浇水：一次浇透脚下够得着的一片（含旁边几棵），已经浇透的会跳过。',
    en: 'Water the whole reachable patch in one call (neighbours included); already-full plants are skipped.',
  },
  farm_harvest: {
    zh: '收脚下这棵熟的，产物掉在地上，要用 farm_collect 捡。',
    en: 'Harvest the ripe plant at your feet; the produce drops on the ground and must be collected.',
  },
  farm_collect: {
    zh: '把脚下的掉落物收进背包。',
    en: 'Pick up the drops around your feet into the bag.',
  },
  farm_consume: {
    zh: '吃掉背包里的作物/杂草收获物，缓解「饥饿」这类状态（要主人在状态自定义里配好消耗行为）。',
    en: 'Eat a crop/weed produce to relieve states like hunger (configured in the status page).',
  },
  farm_craft: {
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
  }),
  describe: {
    tools: describeTools(FARM_TOOL_DECLS),
    events: [
      {
        type: 'farm.ripe',
        description: {
          zh: '有作物成熟了；正文写明哪几棵、在屏幕底部百分之几，并提示走过去收、收完再捡。',
          en: 'Some plants ripened; the text names them and their position, and says to walk over, harvest, then collect.',
        },
        trigger: 'debounce',
      },
      {
        type: 'farm.dry',
        description: {
          zh: '有作物土太干了；正文列出哪几棵、在屏幕底部百分之几，提示走过去浇水。',
          en: 'Some plants are running dry; the text names them and their position and says to water them.',
        },
        trigger: 'debounce',
      },
      {
        type: 'farm.day',
        description: {
          zh: '翻到新的一天；正文带上天气、可收数量、地上的掉落物、土干的数量和背包件数。',
          en: 'A new day started: weather, ripe count, drops on the ground, dry plants and bag size.',
        },
        trigger: 'debounce',
      },
      {
        type: 'farm.state',
        description: {
          zh: '自定义状态触发消耗行为：比如「饥饿」生效时自动吃掉一个作物（正文写明吃了什么、状态变化），或者提醒桌宠用 farm_consume 去吃；背包里没有可吃道具时也会提醒。',
          en: 'A custom state triggered a consume action: e.g. hunger ate a crop (the text says what and the state change), or asks the pet to use farm_consume; also fires when nothing edible is in the bag.',
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
