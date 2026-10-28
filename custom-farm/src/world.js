/**
 * 自定义农场 World。
 *
 * 地里长着任意多棵作物（不重叠），每棵有自己的位置、等级、水分。
 * 熟了不发光：收下来的东西**掉在地上**，桌宠要走过去捡，捡起来才进背包。
 * 太久不浇水会枯萎；生长周期直接用真实配置数据（src/crops.js）。
 *
 *    farm_status    看田、看背包、看地上掉了什么
 *    farm_stand     站到某个位置（at 必填，来自 pet_move_to）
 *    farm_plant     在脚下种一棵（位置可自己挑，也可让世界随机）
 *    farm_water     浇水（先走到跟前，一次浇一片）
 *    farm_harvest   收脚下这棵，产物掉在地上
 *    farm_collect   把脚下的掉落物收进背包
 *
 * 刷新是纯代码 tick，只有「缺水 / 熟了 / 需要吃东西」才 pushEvent；
 * 「新的一天」要 dailyEvent=true 才推，绝不因刷新本身唤醒模型。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CROPS, ROTATION } from './crops.js';
import { FarmCatalog } from './catalog.js';
import { live } from './catalog-state.js';
import { buildZip, readZip } from './zip.js';
import { makePaths, resolvePetHome } from './paths.js';
import { CROP_PRICES, FURNITURE, FURNITURE_ENABLED, SEED_BY_CROP, SEED_BY_ID, SEEDS, sellPriceOf } from './shop.js';
import { normalizeWeathers, pickWeather, weatherById, weatherFxOf } from './weather.js';
import {
  DEFAULTS,
  REACH,
  STATE_VERSION,
  X_MAX,
  X_MIN,
  advance,
  applyFarmSize,
  clamp01,
  clockText,
  collect,
  cropFromText,
  cropOf,
  harvest,
  harvestWeed,
  isRipe,
  levelOf,
  migrate,
  moistureFactor,
  nearestPlot,
  newState,
  normalizeWeeds,
  overlayView,
  removeDeadAt,
  compareValue,
  tickStates,
  consumeActions,
  round2,
  buy,
  buyMany,
  placeFurniture,
  placeDecoration,
  plant,
  pull,
  seedWeeds,
  sell,
  stand,
  summary,
  water,
  waterTargets,
  weedTypeOf,
} from './farm.js';

const ENV_PROMPT = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const msg = (err) => (err instanceof Error ? err.message : String(err));

const pct = (x) => (x === null || x === undefined ? '?' : Math.round(Number(x) * 100));

const CROP_LIST = () => Object.values(CROPS).map((c) => c.name + '(' + c.key + ')').join('、');

export const FARM_TOOL_DECLS = [
  {
    name: 'farm_status',
    tags: ['read', 'snapshot'],
    description: '查看田地：每棵作物的位置 xPct（屏幕底部百分比）、等级、成熟进度、水分、是否熟了/枯萎了、还能收几次，以及背包里有什么、地上掉了什么、野草有几丛/哪些能收、主人自定义的状态（数值 + 开关）当前是多少。最后一行「最近田里的变化」会列出最近少掉的棵和原因——田空了先看这行，别当成存档被清。想知道情况就查这个，田地不会主动推送生长进度。',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'farm_stand',
    tags: ['write'],
    description: '站到某个位置。at 必填：先用桌宠自己的 pet_move_to 走过去，再把到达的位置（回执里那个百分比除以 100）填进 at。给了 plot 还会顺便校验你有没有真的站到那棵旁边。播种、收割、捡东西都要靠它放行。',
    parameters: {
      type: 'object',
      properties: {
        at: { type: 'number', minimum: 0, maximum: 1, description: '你现在的位置（0~1），pet_move_to 回执里那个百分比除以 100。必填。' },
        plot: { type: 'integer', description: '可选：顺便声明你站在几号地旁边。' },
      },
      required: ['at'],
      additionalProperties: false,
    },
  },
  {
    name: 'farm_plant',
    tags: ['write'],
    description: '在脚下种一棵。必须先用 pet_move_to 走过去并 farm_stand 报好位置。种一棵要消耗 1 包对应种子（背包里的 seed_tomato 这种）；没有种子就自己补 1~2 包（farm_shop 看价、farm_buy 买），不用问主人。crop 可以填作物名（番茄/南瓜/玉米/土豆/草莓/小白菜等），不填就按轮作自动选；x 不填就种在脚下，也可以自己指定 0~1，但必须在当前农田范围内（农田始终以屏幕中心为中线，宽度可调）。默认允许轻微重叠，太挤会被拒绝并告诉你已经种在哪些百分比。',
    parameters: {
      type: 'object',
      properties: {
        crop: { type: 'string', description: '作物名或者 key；不填自动轮作。' },
        x: { type: 'number', minimum: 0, maximum: 1, description: '种在屏幕底部哪个位置；不填就种在脚下。' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'farm_water',
    tags: ['write'],
    description: '浇水：走到一棵旁边（先 pet_move_to + farm_stand），一次把够得着的这一片全浇透（含旁边几棵，不用一株一株浇）。给 plot 就以那棵为中心，省略就以你站的位置为中心。已经浇透的会跳过。太久不浇会枯萎，枯了浇不活，要拔掉重种。',
    parameters: {
      type: 'object',
      properties: {
        plot: { type: 'integer', description: '可选：以这棵为中心浇它和旁边够得着的；省略则浇你脚下够得着的全部。' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'farm_harvest',
    tags: ['write'],
    description: '收割脚下这棵熟的作物，或者一丛长成、带收获物的杂草。产物会掉在地上，不会直接进背包——收完再 farm_collect 才拿到手。必须站过去。番茄能收 4 次、草莓 5 次，收完退回中间等级继续长；小麦/土豆/卷心菜/玉米/南瓜只能收 1 次，收完就拔掉（所以收一次地里就少一棵，不是 bug）。杂草要长到最高阶段才收得动；没配收获物的杂草只能靠 farm_plant 铲掉。',
    parameters: {
      type: 'object',
      properties: {
        plot: { type: 'integer', description: '收哪一棵；省略则收脚下这棵。' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'farm_pull',
    tags: ['write'],
    description: '拔掉一棵枯萎的作物（要站在它跟前）。枯萎的作物浇不活，只能拔掉重种；拔的时候会冒一团烟。',
    parameters: {
      type: 'object',
      properties: { plot: { type: 'integer', description: '拔哪一棵；省略则拔脚下这棵。' } },
      additionalProperties: false,
    },
  },
  {
    name: 'farm_sell',
    tags: ['write'],
    description: '把背包里有出售价的道具卖掉换金币（作物/种子/消耗品/装饰）。没在「道具自定义」里设出售价的不能卖。不给 count 就全卖。',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string', description: '背包里的 item id 或名字，比如 tomato / 番茄 / seed_tomato。' },
        count: { type: 'integer', description: '卖几个；省略=全卖。' },
      },
      required: ['item'],
      additionalProperties: false,
    },
  },
  {
    name: 'farm_shop',
    tags: ['read'],
    description: '看商店：列出所有设了购买价的种子/消耗品/装饰（买价、卖价）。没设购买价的不在商店；没设出售价的不能卖。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['seed', 'consumable', 'decor', 'furniture', 'all'], description: '看哪一类；默认 all。' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'farm_buy',
    tags: ['write'],
    description: '买设了购买价的道具（种子/消耗品/装饰）：id 是道具 id（seed_tomato），count 一次买几个；也可以 items:[{id,count}] 一次买多种。买来先进背包；装饰要再用 farm_place 摆。种子不够可以自己补 1~2 包，不用问；买装饰/大件先问主人。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '道具 id（seed_tomato / coffee / scarecrow）' },
        count: { type: 'integer', description: '买几个（默认 1，最多 99）' },
        items: {
          type: 'array',
          description: '一次买多种（推荐，省 token）：[{id:"seed_tomato",count:1},{id:"coffee",count:2}]',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              count: { type: 'integer' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'farm_place',
    tags: ['write'],
    description: '把背包里的装饰道具放到农场地面上（消耗 1 个）。「上」层装饰和杂草同层，会清掉落点杂草；「下」层在作物后方、不清草。x 不填就放在你当前站的位置。必须先买/合成到背包里，且道具在「道具自定义」里配了摆放贴图。',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string', description: '装饰道具 id 或名字（比如 scarecrow / 稻草人）' },
        x: { type: 'number', description: '放到屏宽的百分之几（0~1）；省略=你站的位置' },
      },
      required: ['item'],
      additionalProperties: false,
    },
  },
  {
    name: 'farm_bag',
    tags: ['write'],
    description: '打开（或唤到前面）背包面板。背包里是收下来的作物，可以看每种有多少；面板本身只读，东西还是靠种/收/捡进出。',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'farm_collect',
    tags: ['write'],
    description: '把脚下够得着的掉落物收进背包。必须站过去（先 farm_stand 报位置）。地上没有就报错并告诉你掉落物在哪些百分比。',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'farm_consume',
    tags: ['write'],
    description: '吃掉背包里的作物 / 杂草收获物，用来缓解「饥饿」这类状态。需要主人先在「状态自定义」里配好消耗行为（触发状态 + 可消耗道具 + 状态效果）。item 不填就自动挑背包里第一种可吃的；count 默认 1。吃掉后会按配置加减状态值（通常是饱食度）。',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string', description: '可选：产物 id 或名字（比如 tomato / 番茄）。不填自动挑。' },
        count: { type: 'integer', minimum: 1, maximum: 99, description: '吃几个，默认 1。' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'farm_craft',
    tags: ['write'],
    description: '按「道具合成表」消耗背包里的材料合成道具。recipe 填合成表 id；不填就列出所有合成表和材料。材料不够会报缺什么。',
    parameters: {
      type: 'object',
      properties: {
        recipe: { type: 'string', description: '合成表 id（不填=列出所有合成表）' },
      },
      additionalProperties: false,
    },
  },
];

/**
 * WebUI「配置」页签里的自定义农场玩法参数。
 *
 * 键是 `worlds.farm.*`，必须与 `DEFAULTS` 里的键一一对应（dry-mount 会检查）。
 * 都是 hot：写回 config.json 后，下一次 tick 就按新值跑，不需要重启。
 */
function farmConfigGroups(language = 'zh') {
  const zh = String(language).toLowerCase().startsWith('zh');
  const t = (a, b) => (zh ? a : b);
  const num = (title, description, minimum, maximum, suffix) => ({
    type: 'number', title, description, minimum, maximum, 'x-hot': true,
    ...(suffix ? { 'x-suffix': suffix } : {}),
  });
  const int = (title, description, minimum, maximum, suffix) => ({
    type: 'integer', title, description, minimum, maximum, 'x-hot': true,
    ...(suffix ? { 'x-suffix': suffix } : {}),
  });
  const bool = (title, description) => ({ type: 'boolean', title, description, 'x-hot': true });

  return [
    {
      id: 'world:farm/field',
      owner: 'world:farm',
      schema: {
        type: 'object',
        title: t('田地、野草与经济', 'Field, weeds & economy'),
        description: t('影响之后的操作；startCoins 主要影响新开局。', 'Affects subsequent actions; startCoins mainly affects a fresh game.'),
        properties: {
          'worlds.farm.startCoins': int(t('新开局初始金币', 'Starting coins'), t('默认 120，只影响新开档。', 'Default 120; only affects a new save.'), 0, 100000),
          'worlds.farm.overlayEnabled': bool(t('写桌面图层的 state.json', 'Write the overlay state.json'), t('默认开。关掉后桌面农场停止更新。', 'On by default. Off stops the desktop farm from updating.')),
          'worlds.farm.hideFarm': bool(t('隐藏农场', 'Hide farm'), t('勾选后停止桌面图层；农场仍在后台生长，取消勾选恢复。', 'Stop the desktop overlay; the farm keeps growing. Uncheck to show it again.')),
        },
      },
    },
  ];
}

export class FarmWorld {
  #host = null;
  #state = null;
  #started = false;
  #timer = null;
  #queue = Promise.resolve();
  #paths = null;
  #cmdTimer = null;
  #layerChild = null;
  #layerAt = 0;
  #hidden = false;
  /** 上一次 farm_status 的真实时间/游戏日：用来说明"这中间过了多久"，免得桌宠把走时当成跳档。 */
  #lastStatusAt = 0;
  #lastStatusDay = 0;
  /** 农场自定义（地面 / 作物 / 杂草），启动时从 data\farm\custom.json 载入。 */
  #catalog = null;

  constructor(opts = {}) {
    this.id = opts.id ?? 'farm';
    this.cfg = opts.cfg ?? {};
    this.dataDir = opts.dataDir ?? process.cwd();
    this.botDir = opts.botDir ?? process.cwd();
    this.packageDir = opts.packageDir ?? process.cwd();
    // 是否由这个 World 管桌面图层的启停（单元测试里传 false，避免碰到真实图层）
    this.manageLayers = opts.manageLayers !== false;
    this.language = 'zh';
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.random = typeof opts.random === 'function' ? opts.random : Math.random;
    this.setTimeoutImpl = opts.timers?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutImpl = opts.timers?.clearTimeout ?? ((t) => clearTimeout(t));
  }

  // ------------------------------------------------------------------ 配置
  #num(key, min, max) {
    const override = this.#catalog?.settings?.[key];
    const raw = override === undefined || override === null ? this.cfg?.[key] : override;
    const fallback = Number(DEFAULTS[key]);
    const n = Number(raw === undefined || raw === null ? fallback : raw);
    const base = Number.isFinite(n) ? n : fallback;
    return Math.min(Math.max(base, min), max);
  }

  #flag(key) {
    const override = this.#catalog?.settings?.[key];
    const raw = override === undefined || override === null ? this.cfg?.[key] : override;
    if (raw === undefined || raw === null) return Boolean(DEFAULTS[key]);
    return Boolean(raw);
  }

  #cfgAll() {
    // 屏幕宽度以图层实际工作区为准：overlay 每次重排会写 runtime/screen.json。
    // 换电脑/改分辨率后这里自动跟上，格宽、作物间距和农田边界都是同一套 DIP。
    let screenWidth = this.#num('screenWidth', 640, 8192);
    try {
      const info = JSON.parse(readFileSync(join(dirname(this.overlayFile()), 'screen.json'), 'utf8'));
      if (Number.isFinite(info.width) && info.width >= 320) screenWidth = Math.round(info.width);
    } catch { /* 图层还没起来，用配置值 */ }
    const pointsPerDay = this.#num('pointsPerDay', 1, 100000);
    // 生长点/天改了：阈值要重算（days 不变，只是换算成生长点）
    try { this.#catalog?.setPointsPerDay(pointsPerDay); } catch { /* 目录没加载就算了 */ }
    // 浇水三项已搬到「农场自定义 → 生态」：以 custom.json 为准，config 只作首次默认值
    const water = this.#catalog?.status?.water ?? null;
    return {
      ...DEFAULTS,
      maxPlants: this.#num('maxPlants', 1, 24),
      screenWidth,
      zoom: this.#num('zoom', 1, 8),
      spriteGapPx: this.#num('spriteGapPx', 0, 64),
      cropGapScale: this.#num('cropGapScale', 0.5, 1.2),
      cropGapPct: this.#num('cropGapPct', 0, 10),
      cropScale: this.#num('cropScale', 0.3, 2.5),
      dropScale: this.#num('dropScale', 0.3, 3),
      groundHeight: this.#num('groundHeight', 2, 40),
      weathers: normalizeWeathers(this.#catalog?.settings?.weathers ?? DEFAULTS.weathers),
      stripHeight: this.#num('stripHeight', 120, 800),
      farmCells: Math.round(this.#num('farmCells', 12, 48)),
      startWeeds: this.#num('startWeeds', 0, 60),
      maxWeeds: this.#num('maxWeeds', 0, 60),
      weedPerDay: this.#num('weedPerDay', 0, 2),
      weedClearRadius: this.#num('weedClearRadius', 0, 0.2),
      pointsPerDay,
      realMinutesPerDay: this.#num('realMinutesPerDay', 0.005, 1440),
      maxStepDays: this.#num('maxStepDays', 0.01, 1000),
      dryPerDay: water ? Number(water.dryPerDay) : this.#num('dryPerDay', 0, 20),
      waterGain: water ? Number(water.waterGain) : this.#num('waterGain', 0, 5),
      wiltDays: water ? Number(water.wiltDays) : this.#num('wiltDays', 0.01, 1000),
      drynessBase: this.#num('drynessBase', 0, 5),
      drynessGain: this.#num('drynessGain', 0, 10),
      sowMoisture: this.#num('sowMoisture', 0, 1),
      startMinute: this.#num('startMinute', 0, 1439),
      minutesPerDay: this.#num('minutesPerDay', 1, 1440),
      startCoins: this.#num('startCoins', 0, 1e9),
      stateDefs: this.#catalog?.states ?? [],
      stateRules: this.#catalog?.rules ?? [],
    };
  }

  #tickMs() {
    return Math.round(this.#num('tickIntervalMs', 1000, 3600000));
  }

  /** 自定义目录：custom.json + assets\sprites。找不到 <Pet> 时退回扩展上一级。 */
  #createCatalog() {
    const petHome = resolvePetHome(this.cfg?.petRoot);
    const spritesDir = petHome
      ? join(petHome, 'assets', 'sprites')
      : join(this.packageDir, '..', 'assets', 'sprites');
    return new FarmCatalog({
      storePath: join(this.dataDir, 'farm', 'custom.json'),
      spritesDir,
      pointsPerDay: this.#num('pointsPerDay', 1, 100000),
      waterDefaults: {
        dryPerDay: this.#num('dryPerDay', 0, 20),
        waterGain: this.#num('waterGain', 0, 5),
        wiltDays: this.#num('wiltDays', 0.01, 1000),
      },
    });
  }

  #catalogOrThrow() {
    if (!this.#catalog) throw new Error('自定义目录还没加载。');
    return this.#catalog;
  }

  stateFile() {
    return join(this.dataDir, 'farm', 'state.json');
  }

  /** 图层状态文件。配置里给了就用配置，否则按扩展位置推（换机器不用改配置）。 */
  overlayFile() {
    const p = this.cfg?.overlayStatePath;
    if (typeof p === 'string' && p.trim()) return p.trim();
    this.#paths ??= makePaths(resolvePetHome(this.cfg?.petRoot));
    return this.#paths.overlayState;
  }

  bagScript() {
    this.#paths ??= makePaths(resolvePetHome(this.cfg?.petRoot));
    return this.#paths.bagScript;
  }

  envPromptVars() {
    return {};
  }

  // ------------------------------------------------------------------ 工具
  tools() {
    return FARM_TOOL_DECLS.map((decl) => ({
      ...decl,
      handler: (args) => this.#runTool(decl.name, args ?? {}),
    }));
  }

  async #runTool(name, args) {
    try {
      return await this.#serial(() => this.#tool(name, args));
    } catch (err) {
      return { text: '[' + name + ' 失败] ' + msg(err), failed: true };
    }
  }

  async #tool(name, args) {
    switch (name) {
      case 'farm_status': return this.#statusTool();
      case 'farm_stand': return await this.#standTool(args);
      case 'farm_plant': return await this.#plantTool(args);
      case 'farm_water': return await this.#waterTool(args);
      case 'farm_harvest': return await this.#harvestTool(args);
      case 'farm_collect': return await this.#collectTool();
    case 'farm_consume': return await this.#consumeTool(args);
    case 'farm_craft': return await this.#craftTool(args);
      case 'farm_bag': return await this.#bagTool();
      case 'farm_pull': return await this.#pullTool(args);
      case 'farm_sell': return await this.#sellTool(args);
      case 'farm_shop': return this.#shopTool(args);
      case 'farm_buy': return await this.#buyTool(args);
      case 'farm_place': return await this.#placeTool(args);
      default: return { text: '[' + name + ' 失败] 不认识这个工具。', failed: true };
    }
  }

  /** 旧存档里删掉的作物/道具：清田、背包/种子、掉落和配方。 */
  #pruneRemovedCrops() {
    if (!this.#state) return;
    const valid = new Set(Object.keys(CROPS));
    const removed = ['chinese_cabbage', 'grape'];
    this.#state.plots = (this.#state.plots ?? []).filter((p) => valid.has(p.crop));
    this.#state.drops = (this.#state.drops ?? []).filter((d) => valid.has(d.crop));
    for (const key of removed) {
      delete this.#state.inventory?.[key];
      delete this.#state.inventory?.['seed_' + key];
    }
    delete this.#state.inventory?.seed_wheat;
    for (const key of ['wheat', 'flour', 'pasta']) delete this.#state.inventory?.[key];
    this.#state.furniture = (this.#state.furniture ?? []).filter((f) => f.id !== 'deco_haystack');
    delete this.#state.inventory?.deco_haystack;
    this.#catalog?.removeRecipesUsing(['chinese_cabbage', 'seed_chinese_cabbage', 'grape', 'seed_grape', 'wheat', 'flour', 'pasta']);
  }
  #ensureStarted() {
    if (!this.#started || !this.#state) throw new Error('自定义农场 World 还没启动；等它启用后再试。');
  }

  #peek() {
    const cfg = this.#cfgAll();
    const copy = structuredClone(this.#state);
    advance(copy, this.now(), cfg, () => 0);
    return copy;
  }

  #statusTool() {
    this.#ensureStarted();
    const s = summary(this.#peek(), this.#cfgAll());
    const here = this.#state.current ?? null;
    const lines = [
      '田地  ·  第 ' + s.day + ' 天 ' + s.clock + '  ·  ' + s.weather + '  ·  金币 ' + s.coins +
        '  ·  1 天 = ' + s.realMinutesPerDay + ' 分钟现实',
      '种着 ' + s.planted + '/' + s.max + ' 棵，' + s.ripe + ' 棵能收，' + s.dead + ' 棵枯了；背包 ' + s.bagTotal + ' 件；地上 ' + s.drops + ' 个掉落物。' +
        (s.standingAt !== null ? '你在 ' + Math.round(s.standingAt * 100) + '%。' : '你还没报过位置。'),
    ];
    if (s.plots.length === 0) lines.push('  地是空的：走到想种的地方，farm_stand 之后 farm_plant。');
    if (this.#lastStatusAt && this.now() - this.#lastStatusAt >= 60_000) {
      const mins = Math.max(1, Math.round((this.now() - this.#lastStatusAt) / 60000));
      const away = mins >= 120 ? (Math.round(mins / 6) / 10) + ' 小时' : mins + ' 分钟';
      lines.push('距上次看田：' + away + ' 现实（第 ' + this.#lastStatusDay + ' 天 → 第 ' + s.day + ' 天，游戏时间走了 ' +
        Math.max(0, s.day - this.#lastStatusDay) + ' 天；1 天 = ' + s.realMinutesPerDay + ' 分钟现实）——这是走时，不是跳档。');
    }
    this.#lastStatusAt = this.now();
    this.#lastStatusDay = s.day;
    for (const p of s.plots) {
      const tag = p.dead ? '枯萎了，拔掉重种' : (p.ready ? '熟了，可以收' : ('还差约 ' + p.daysToRipe + ' 天（现实 ' + p.realMinutesToRipe + ' 分钟）'));
      const times = p.lifespan > 1 ? '已收 ' + p.harvests + '/' + p.lifespan + ' 次' : '只能收 1 次（收完就拔掉）';
      lines.push('  ' + p.id + ' 号 ' + p.crop + ' · ' + p.xPct + '% · 等级 ' + p.levelName + ' · 进度 ' + p.progress +
        '% · 土湿 ' + p.moisture + '%' + (p.dry ? '（干了）' : '') + ' · ' + times + ' · ' + tag);
    }
    // 田里少掉的棵都记了原因：桌宠不用再猜"是不是存档被清了"
    if (s.fieldLog.length) {
      const kk = { harvest: '收满次数拔掉', pull: '拔掉枯株', wilt: '干枯死掉', resize: '缩放删掉', replant: '重种时拔掉枯株', weedHarvest: '收走' };
      lines.push('最近田里的变化：' + s.fieldLog
        .map((e) => '第 ' + e.day + ' 天 ' + clockText(e.minute) + ' ' + (e.id ?? '?') + ' 号' + (CROPS[e.crop]?.name ?? e.crop) + ' ' + (kk[e.kind] ?? e.kind))
        .join('；') + '。');
    }
    if (s.weeds > 0) {
      if (s.weedRipe > 0) {
        lines.push('野草 ' + s.weeds + ' 丛，其中 ' + s.weedRipe + ' 丛长成能收：' +
          s.weedList.map((w) => w.name + '（' + w.xPct + '%）').join('、') + '。走过去 farm_harvest 收，产物掉地上再 farm_collect。');
      } else {
        lines.push('野草 ' + s.weeds + ' 丛（都还没长成；种东西时会把脚下的铲掉）。');
      }
    }
    if (s.states.length) {
      lines.push('状态：' + s.states.map((st) => (st.kind === 'flag'
        ? st.name + (st.active ? '（生效）' : '（未生效）')
        : st.name + ' ' + st.value + (st.unit || '') + '/' + st.max)).join('、') + '。');
    }
    if (s.dropList.length) {
      lines.push('地上掉落：' + s.dropList.map((d) => d.item + '（' + d.xPct + '%）').join('、') + '。走过去 farm_collect 捡起来。');
    }
    const bag = Object.entries(s.bag);
    if (bag.length) {
      lines.push('背包：' + bag.map(([k, v]) => (cropFromText(k) ? cropOf(cropFromText(k)).name : k) + '×' + v).join('、') + '。');
    }
    if (s.ripe > 0) {
      const targets = s.plots.filter((p) => p.ready).map((p) => p.xPct + '%（' + p.id + ' 号）').join('、');
      lines.push('要收的：' + targets + '。先 pet_move_to 走过去，farm_stand 之后 farm_harvest。');
    }
    return { text: lines.join('\n') };
  }

  async #standTool(args) {
    this.#ensureStarted();
    const cfg = this.#cfgAll();
    const rawAt = args?.at;
    if (rawAt === undefined || rawAt === null || rawAt === '') {
      throw new Error('at 没给，我不能确认你走过去了。先去 pet_move_to 走到那儿，把到达的位置填进 at（比如 38% 就填 0.38）再调。');
    }
    const plotId = args?.plot === undefined || args?.plot === null ? null : Number(args.plot);
    await this.#mutate((state) => { stand(state, plotId, rawAt, cfg); return null; });
    const here = Math.round(Number(this.#state.standingAt) * 100);
    const near = nearestPlot(this.#state, this.#state.standingAt);
    const drops = this.#state.drops.filter((d) => Math.abs(Number(d.x) - Number(this.#state.standingAt)) <= REACH);
    const lines = ['记下了：你在 ' + here + '%。'];
    if (near) {
      const crop = cropOf(near.crop);
      lines.push('脚下是 ' + near.id + ' 号 ' + crop.name + '（等级 ' + (near.level + 1) + '/' + crop.levels + '，' +
        (near.dead ? '枯萎了' : (isRipe(near) ? '熟了' : '还没熟')) + '）。');
    } else {
      lines.push('脚下没有作物，这里可以种。');
    }
    if (drops.length) lines.push('这一带地上有 ' + drops.length + ' 个掉落物，可以 farm_collect。');
    return { text: lines.join('\n') };
  }

  async #plantTool(args) {
    this.#ensureStarted();
    const cfg = this.#cfgAll();
    const at = this.#state.standingAt;
    if (!Number.isFinite(Number(at))) throw new Error('还没报位置：先 pet_move_to 走过去，farm_stand 把 at 报上来，再来种。');
    const wanted = args?.crop ? cropFromText(args.crop) : null;
    if (args?.crop && !wanted) throw new Error('没有这种作物：' + args.crop + '。能种的是 ' + CROP_LIST() + '。');
    const x = args?.x === undefined || args?.x === null || args?.x === '' ? Number(at) : Number(args.x);
    const plot = await this.#mutate((state) => {
      removeDeadAt(state, x);
      return plant(state, { x, crop: wanted, cfg, random: this.random });
    });
    const crop = cropOf(plot.crop);
    const s = summary(this.#state, cfg);
    const seed = SEED_BY_CROP[crop.key];
    const seedLeft = Number(this.#state.inventory?.[seed?.id] ?? 0);
    return {
      text: [
        '你在 ' + pct(plot.x) + '% 种下了' + crop.name + '（' + plot.id + ' 号）。',
        seed ? '用了 1 包' + seed.name + '，背包还剩 ' + seedLeft + ' 包。' +
          (seedLeft === 0 ? '种子用完了。自己补 1~2 包：farm_buy {items:[{id:"' + seed.id + '",count:1}]}。' : '')
          : '',
        '它一共 ' + crop.levels + ' 级、' + crop.total + ' 生长点（游戏里 ' + Math.round(crop.total / cfg.pointsPerDay) + ' 天）；按当前水分大约 ' +
          Math.round((crop.total / (cfg.pointsPerDay * moistureFactor(plot.moisture, cfg))) * cfg.realMinutesPerDay) + ' 真实分钟后熟。' +
          (crop.lifespan > 1 ? '这是能反复收的作物：能收 ' + crop.lifespan + ' 次，收完退回第 ' + (crop.repeatLevel + 1) + ' 级继续长。' : '只能收一次。'),
        '现在种着 ' + s.planted + '/' + s.max + ' 棵。',
      ].filter(Boolean).join('\n'),
    };
  }

  async #waterTool(args) {
    this.#ensureStarted();
    const cfg = this.#cfgAll();
    const at = this.#requireHere();
    const raw = args?.plot;
    let plotId = raw === undefined || raw === null ? null : Number(raw);
    if (plotId !== null && !Number.isInteger(plotId)) throw new Error('plot 要是整数。');
    // 走到一棵旁边，一次把够得着的这一片（含邻近几棵）全浇了；不用一株一株挪位置
    if (plotId !== null) {
      const target = this.#state.plots.find((p) => Number(p.id) === plotId);
      if (!target) throw new Error(plotId + ' 号地没有作物。');
      if (target.dead) throw new Error(plotId + ' 号已经枯了，浇水救不活；走到跟前用 farm_plant 拔掉重种。');
      const gap = Math.abs(Number(target.x) - at);
      if (gap > REACH) {
        throw new Error(plotId + ' 号在 ' + pct(target.x) + '%，你站在 ' + pct(at) + '%，够不着。先 pet_move_to 走过去再浇。');
      }
    }
    const ids = waterTargets(this.#state.plots, at, plotId, REACH);
    if (!ids || ids.length === 0) {
      const near = nearestPlot(this.#state, at);
      if (!near) throw new Error('脚下没有作物，没什么可浇的。先 pet_move_to 走到要浇的那棵跟前。');
      throw new Error('最近的 ' + near.id + ' 号在 ' + pct(near.x) + '%，你站在 ' + pct(at) + '%，够不着。先 pet_move_to 走过去再浇。');
    }
    const result = await this.#mutate((state) => {
      const merged = { plots: [], fx: [], skipped: [] };
      for (const id of ids) {
        const one = water(state, cfg, id);
        merged.plots.push(...one.plots);
        merged.fx.push(...one.fx);
        merged.skipped.push(...one.skipped);
      }
      return merged;
    });
    if (result.plots.length === 0) {
      if (result.skipped.length > 0) return { text: '这几棵都浇透了（土湿 100%），不用再浇。' };
      throw new Error('脚下没有可浇的作物。');
    }
    // 回执压成一行：一次浇一片，模型不用为每棵单独再调一次（省 token）
    const idsText = result.plots.map((p) => p.id).join('、');
    const allFull = result.plots.every((p) => Number(p.moistureAfter) >= 0.999);
    const wetText = allFull
      ? '土湿都到 100%'
      : '土湿 ' + Math.round(Math.min(...result.plots.map((p) => Number(p.moistureBefore))) * 100) +
        '%→' + Math.round(Math.max(...result.plots.map((p) => Number(p.moistureAfter))) * 100) + '%';
    let text = '浇了 ' + result.plots.length + ' 棵（' + idsText + ' 号），' + wetText + '。';
    if (result.plots.length > 1) text += '旁边够得着的也一起浇了。';
    if (result.skipped.length > 0) {
      text += ' ' + result.skipped.map((p) => p.id).join('、') + ' 号本来就浇透了。';
    }
    return { text };
  }

  async #pullTool(args) {
    this.#ensureStarted();
    const cfg = this.#cfgAll();
    const at = this.#requireHere();
    const plots = this.#state.plots.filter((p) => !p.dead ? false : true);
    let target = null;
    if (args?.plot !== undefined && args?.plot !== null) {
      target = this.#state.plots.find((p) => Number(p.id) === Number(args.plot));
      if (!target) throw new Error(args.plot + ' 号地没有作物。');
    } else {
      target = nearestPlot(this.#state, at) ?? null;
      if (!target) throw new Error('脚下没有作物。');
      if (Math.abs(Number(target.x) - at) > REACH) throw new Error('脚下这棵在 ' + pct(target.x) + '%，你站在 ' + pct(at) + '%，够不着。');
    }
    const r = await this.#mutate((state) => pull(state, cfg, target.id));
    return { text: '把 ' + pct(r.x) + '% 那棵枯掉的' + r.crop + '拔掉了，腾出空地。想种就 farm_plant。' };
  }

  async #sellTool(args) {
    this.#ensureStarted();
    const cfg = this.#cfgAll();
    let key = String(args?.item ?? '').trim();
    // 支持：item id（seed_tomato / tomato）、道具中文名、作物中文名、"番茄种子"
    if (!this.#state.inventory?.[key]) {
      const byName = Object.keys(live.names ?? {}).find((id) => live.names[id] === key);
      if (byName && this.#state.inventory?.[byName]) key = byName;
    }
    if (!this.#state.inventory?.[key]) {
      const cropKey = cropFromText(key);
      if (cropKey && this.#state.inventory?.[cropKey]) key = cropKey;
      else if (key.endsWith('种子')) {
        const base = cropFromText(key.slice(0, -2));
        const sid = base ? (SEED_BY_CROP[base]?.id ?? 'seed_' + base) : null;
        if (sid && this.#state.inventory?.[sid]) key = sid;
      }
    }
    const r = await this.#mutate((state) => sell(state, cfg, key, args?.count));
    const s = summary(this.#state, cfg);
    const seedLine = this.#seedLine();
    return {
      text: '卖了 ' + r.count + ' 个' + (r.name ?? cropOf(key)?.name ?? key) + '（单价 ' + r.unit + '）→ +' + r.coins +
        ' 金币，现在有 ' + Math.floor(s.coins) + ' 金币。' + (r.left > 0 ? '背包还剩 ' + r.left + ' 个。' : '') +
        (seedLine ? ' ' + seedLine + '要补就 farm_buy（自己补 1~2 包，不用问）。' : ''),
    };
  }

  /** 背包里可卖的东西（作物 / 种子）与总价，给"钱不够/刚收获"时的一句话提示用。 */
  #sellableSummary() {
    const items = Object.entries(this.#state?.inventory ?? {})
      .map(([id, n]) => ({
        id,
        n: Number(n),
        unit: sellPriceOf(id),
        name: SEED_BY_ID[id]?.name ?? CROP_PRICES[id]?.name ?? id,
      }))
      .filter((x) => x.n > 0 && x.unit > 0);
    return {
      items,
      count: items.reduce((a, x) => a + x.n, 0),
      value: items.reduce((a, x) => a + x.unit * x.n, 0),
    };
  }

  #sellableLine() {
    const bag = this.#sellableSummary();
    if (!bag.count) return null;
    const top = bag.items
      .slice()
      .sort((a, b) => b.unit * b.n - a.unit * a.n)
      .slice(0, 3)
      .map((x) => x.name + '×' + x.n + '（' + x.unit + '）')
      .join('、');
    return '背包里 ' + bag.count + ' 件可卖 ' + bag.value + ' 金币（' + top + '）。';
  }

  /** 现在每种种子还剩几包。 */
  #seedStock() {
    const inv = this.#state?.inventory ?? {};
    const items = SEEDS.map((s) => ({ ...s, have: Number(inv[s.id] ?? 0) }));
    return { items, total: items.reduce((a, s) => a + s.have, 0) };
  }

  /** 种子少于等于 1 包时的一句话；够用就返回 null（不占回执）。 */
  #seedLine() {
    const st = this.#seedStock();
    if (st.total > 1) return null;
    const have = st.items.filter((s) => s.have > 0).map((s) => s.name + ' ' + s.have).join('、') || '一包都没有';
    const lack = st.items.filter((s) => s.have === 0 && s.buy > 0).slice().sort((a, b) => a.buy - b.buy).slice(0, 3)
      .map((s) => s.name + '（' + s.buy + '）').join('、');
    return '种子：' + have + (lack ? '；缺 ' + lack : '') + '。';
  }

  #shopTool(args) {
    this.#ensureStarted();
    if (args?.kind === 'furniture') {
      return { text: '家具下架了；现在用「道具自定义 → 装饰道具」加装饰，再用 farm_place 摆到地上。' };
    }
    const kind = ['seed', 'consumable', 'decor', 'all'].includes(args?.kind) ? args.kind : 'all';
    const shop = Object.values(live.items ?? {}).filter((it) => it.buy > 0);
    const groups = [
      ['seed', '种子（种一棵消耗 1 包）'],
      ['consumable', '消耗品'],
      ['decor', '装饰（买回来用 farm_place 摆）'],
    ];
    const lines = ['商店（金币 ' + Math.floor(this.#state.coins ?? 0) + '）：'];
    for (const [g, title] of groups) {
      if (kind !== 'all' && kind !== g) continue;
      const rows = shop.filter((it) => it.kind === g);
      lines.push(title + '（买 / 卖）：');
      if (!rows.length) lines.push('  （这一类还没有设购买价的道具）');
      for (const it of rows) lines.push('  ' + it.id + ' · ' + it.name + ' · 买 ' + it.buy + ' / 卖 ' + (it.sell > 0 ? it.sell : '不卖'));
    }
    lines.push('买：farm_buy {items:[{id:"seed_tomato",count:1}]}（多种写一个 items 里，省 token；没设购买价的不在商店）。');
    lines.push('卖：farm_sell {item}（没设出售价的不能卖）。');
    return { text: lines.join('\n') };
  }

  async #buyTool(args) {
    this.#ensureStarted();
    const rawItems = Array.isArray(args?.items) && args.items.length
      ? args.items
      : [{ id: args?.id, count: args?.count }];
    const cart = rawItems.map((x) => ({
      id: String(x?.id ?? '').trim(),
      count: x?.count === undefined || x?.count === null ? 1 : Number(x.count),
    }));
    if (cart.some((x) => !x.id)) throw new Error('要买什么？给 id（seed_tomato）或 items:[{id,count}]。');
    if (cart.some((x) => !Number.isInteger(x.count) || x.count < 1)) throw new Error('count 要是正整数。');
    let r;
    try {
      r = await this.#mutate((state) => buyMany(state, cart));
    } catch (err) {
      const text = msg(err);
      if (/钱不够/.test(text)) {
        const line = this.#sellableLine();
        if (line) throw new Error(text + ' ' + line + '先 farm_sell，或者问主人一声要不要卖。');
      }
      throw err;
    }
    const s = summary(this.#state, this.#cfgAll());
    const parts = r.items.map((x) => x.count + ' 个' + x.name + '（' + x.price + '，背包 ' + x.left + ' 个）');
    return {
      text: '买了 ' + parts.join('、') + '，共 -' + r.total + ' 金币，还剩 ' + Math.floor(s.coins) + ' 金币。' +
        (r.items.some((x) => x.kind === 'decor') ? '装饰要摆就 farm_place {item:"id"}。' : ''),
    };
  }

  async #placeTool(args) {
    this.#ensureStarted();
    const raw = String(args?.item ?? args?.id ?? '').trim();
    if (!raw) throw new Error('要放什么？给装饰道具 id 或名字。');
    const item = live.items?.[raw] ?? Object.values(live.items ?? {}).find((it) => it.name === raw && it.kind === 'decor');
    if (!item || item.kind !== 'decor') throw new Error('「' + raw + '」不是装饰道具。');
    if (!item.sprite) throw new Error(item.name + ' 还没设置摆放贴图，去「道具自定义」上传。');
    const fallbackX = Number.isFinite(Number(this.#state.standingAt)) ? Number(this.#state.standingAt) : 0.5;
    const x = args?.x === undefined || args?.x === null ? fallbackX : Number(args.x);
    if (!Number.isFinite(x) || x < 0 || x > 1) throw new Error('x 是 0~1 的小数（屏宽百分比）。');
    const r = await this.#mutate((state) => placeDecoration(state, item, x));
    return { text: '把' + r.name + '放在了 ' + Math.round(r.x * 100) + '%' +
      (r.cleared ? '，清掉了 ' + r.cleared + ' 丛杂草' : '') + '。' };
  }

  async #bagTool() {
    if (process.platform !== 'win32') {
      return { text: '背包窗口是 Windows WPF；当前平台请在 Coopanion WebUI 的「背包」页查看。' };
    }
    const script = this.bagScript();
    if (!existsSync(script)) {
      throw new Error('找不到背包脚本：' + script + '（整个 Pet 文件夹要一起拷贝）');
    }
    // 注意：Windows 上不能加 detached——那会用 DETACHED_PROCESS 起进程，
    // PowerShell 5.1 在那种情况下起不来（表现为窗口一直没出现、日志也没有）。不加 detached 也一样能活过父进程。
    const child = spawn('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script],
      { stdio: 'ignore', windowsHide: true });
    child.unref();
    return { text: '背包面板叫出来了（' + script + '）。它只读，里面有多少就是背包里有多少。' };
  }

  #requireHere() {
    const at = this.#state.standingAt;
    if (!Number.isFinite(Number(at))) {
      throw new Error('还没报位置：先 pet_move_to 走过去，farm_stand 把 at 报上来。');
    }
    return Number(at);
  }

  async #harvestTool(args) {
    this.#ensureStarted();
    const cfg = this.#cfgAll();
    const at = this.#requireHere();
    let plotId = args?.plot === undefined || args?.plot === null ? null : Number(args.plot);
    if (plotId === null) {
      const near = nearestPlot(this.#state, at);
      if (!near) {
        // 脚下没作物：看看是不是一丛长成、带收获物的杂草
        const weed = this.#nearestWeed(at);
        if (weed) return await this.#harvestWeedTool(weed, at, cfg);
        throw new Error('你站在 ' + pct(at) + '%，脚下没有作物，也没有能收的杂草。走到那棵旁边再收。');
      }
      plotId = near.id;
    }
    const plot = this.#state.plots.find((p) => p.id === plotId);
    if (!plot) throw new Error('没有 ' + plotId + ' 号地了。');
    if (Math.abs(Number(plot.x) - at) > REACH + 0.01) {
      throw new Error('你站在 ' + pct(at) + '%，' + plotId + ' 号地在 ' + pct(plot.x) + '%，够不着。先 pet_move_to 走过去。');
    }
    if (plot.dead) throw new Error(plotId + ' 号地枯萎了，收不了。farm_plant 在同一个位置会把它拔掉重种。');
    if (!isRipe(plot)) {
      throw new Error(plotId + ' 号地还没熟（进度 ' + Math.round((plot.growth / cropOf(plot.crop).total) * 100) + '%）。');
    }
    const crop = cropOf(plot.crop);
    const result = await this.#mutate((state) => harvest(state, cfg, plotId, this.random));
    const item = result.harvested[0];
    if (!item) throw new Error('没收成，再试一次。');
    const lines = [
      '你收了 ' + item.id + ' 号地的' + item.crop + '，' + item.count + ' 个' + (item.name ?? crop.name) + '掉在 ' + pct(item.x) + '% 的地上。',
    ];
    if (result.removed.length) lines.push(crop.lifespan <= 1
      ? '这棵只能收 1 次，收完就拔掉了，位置空出来了（土豆/玉米/南瓜/胡萝卜都是这样）。'
      : '这棵收满 ' + crop.lifespan + ' 次了，已经拔掉，位置空出来了。');
    else lines.push('它退回第 ' + (crop.repeatLevel + 1) + ' 级继续长，还能再收 ' + Math.max(0, crop.lifespan - plot.harvests) + ' 次。');
    const s = summary(this.#state, cfg);
    if (s.dropList.length) lines.push('地上现在有：' + s.dropList.map((d) => d.item + '（' + d.xPct + '%）').join('、') + '。站在原地 farm_collect 就能捡。');
    // 收获时是"要不要卖"的触发点：只提一句，别每 tick 都问
    const sale = this.#sellableLine();
    if (sale) lines.push(sale + '钱不够买种子就 farm_sell；要卖先问主人一声。');
    const seedLine = this.#seedLine();
    if (seedLine) lines.push(seedLine + '要补就 farm_buy（自己补 1~2 包，不用问）。');
    return { text: lines.join('\n') };
  }

  #nearestWeed(at) {
    let best = null;
    let bestD = Infinity;
    for (const w of this.#state?.weeds ?? []) {
      const d = Math.abs(Number(w.x) - Number(at));
      if (d <= REACH + 0.01 && d < bestD) { bestD = d; best = w; }
    }
    return best;
  }

  async #harvestWeedTool(weed, at, cfg) {
    const type = weedTypeOf(weed);
    if (!type) throw new Error('这丛杂草没有可用的类型。');
    const lv = Number(weed.level ?? 0);
    if (lv < type.stages - 1) {
      throw new Error('你站在 ' + pct(at) + '%，脚下是一丛' + type.name + '（' + (lv + 1) + '/' + type.stages +
        ' 阶段），还没长成。等它长到最高阶段再来，或者 farm_plant 直接铲掉。');
    }
    if (!type.item || Number(type.value) <= 0) {
      throw new Error('脚下是一丛' + type.name + '，没有可收的产物。想清掉就 farm_plant 在这里种一棵。');
    }
    const result = await this.#mutate((state) => harvestWeed(state, cfg, weed.id, this.random));
    const lines = [
      '你收了 ' + pct(result.weed.x) + '% 的' + result.weed.name + '，' + result.drop.count + ' 个' +
        result.drop.name + '掉在 ' + pct(result.drop.x) + '% 的地上。',
      '站在原地 farm_collect 就能捡。',
    ];
    const s = summary(this.#state, cfg);
    if (s.dropList.length) lines.push('地上现在有：' + s.dropList.map((d) => d.item + '（' + d.xPct + '%）').join('、') + '。');
    return { text: lines.join('\n') };
  }

  async #collectTool() {
    this.#ensureStarted();
    const cfg = this.#cfgAll();
    const at = this.#requireHere();
    const result = await this.#mutate((state) => collect(state, cfg, at));
    const s = summary(this.#state, cfg);
    const got = result.collected.map((d) => (d.name ?? live.names[d.item] ?? cropOf(d.crop).items[0]) + '×' + d.count).join('、');
    const lines = ['捡起来了：' + got + '（' + pct(result.at) + '% 附近）。', '背包现在 ' + s.bagTotal + ' 件。'];
    if (s.dropList.length) lines.push('地上还剩：' + s.dropList.map((d) => d.item + '（' + d.xPct + '%）').join('、') + '。');
    return { text: lines.join('\n') };
  }

  async #consumeTool(args) {
    this.#ensureStarted();
    const cfg = this.#cfgAll();
    const catalog = this.#catalogOrThrow();
    const actions = catalog.consume ?? [];
    const raw = args?.item ? String(args.item).trim() : '';
    const wanted = raw
      ? (Object.keys(live.names ?? {}).find((id) => id === raw || live.names[id] === raw) ?? raw)
      : '';
    const invOf = (id) => Number(this.#state.inventory?.[id] ?? 0);
    const actionFor = (id) => actions.find((a) => a.items.includes(id)) ?? null;
    let pick = null;
    if (wanted) {
      const def = live.items?.[wanted];
      if (!def) throw new Error('没有这个道具：' + wanted);
      if (!def.consumable) throw new Error(def.name + ' 被设成不可消耗了。');
      if (invOf(def.id) < 1) throw new Error('背包里没有' + def.name + '。');
      pick = { item: def.id, action: actionFor(def.id) };
    } else {
      const fromActions = actions
        .flatMap((a) => a.items.map((id) => ({ item: id, action: a })))
        .filter((c) => invOf(c.item) > 0 && live.items?.[c.item]?.consumable !== false);
      pick = fromActions[0] ?? Object.values(live.items ?? {})
        .filter((it) => it.consumable && invOf(it.id) > 0)
        .map((it) => ({ item: it.id, action: actionFor(it.id) }))[0] ?? null;
      if (!pick) throw new Error('背包里没有能消耗的道具。');
    }
    const have = invOf(pick.item);
    if (have < 1) throw new Error('背包里没有' + (live.names?.[pick.item] ?? pick.item) + '。');
    const count = Math.max(1, Math.min(99, Math.floor(Number(args?.count) || 1)));
    const result = await this.#mutate((state) => {
      const n = Number(state.inventory?.[pick.item] ?? 0);
      const take = Math.min(n, count);
      state.inventory[pick.item] = n - take;
      if (state.inventory[pick.item] <= 0) delete state.inventory[pick.item];
      const itemDef = live.items?.[pick.item];
      const effectSpec = Array.isArray(itemDef?.effects) && itemDef.effects.length
        ? itemDef.effects
        : (pick.action?.effectState ? [{ state: pick.action.effectState, delta: pick.action.effectDelta }] : []);
      const effects = [];
      for (const spec of effectSpec) {
        const def = catalog.states.find((s) => s.id === spec.state);
        if (!def || def.kind !== 'number') continue;
        const before = Number(state.states?.[def.id]?.value ?? def.initial);
        const after = Math.min(Number(def.max), Math.max(Number(def.min), before + Number(spec.delta ?? 0) * take));
        state.states = state.states ?? {};
        state.states[def.id] = { value: round2(after) };
        effects.push({ name: def.name, delta: round2(after - before), value: round2(after), max: def.max });
      }
      if (!effectSpec.some((s) => s.state === 'mood')) {
        const mood = catalog.states.find((s) => s.id === 'mood');
        if (mood) {
          const before = Number(state.states?.mood?.value ?? mood.initial);
          const after = Math.min(Number(mood.max), Math.max(Number(mood.min), before + 8 * take));
          state.states = state.states ?? {};
          state.states.mood = { value: round2(after) };
          effects.push({ name: mood.name, delta: round2(after - before), value: round2(after), max: mood.max });
        }
      }
      tickStates(state, catalog.states, catalog.rules, 0);
      if (pick.action) {
        state.stateActions = state.stateActions ?? {};
        state.stateActions[pick.action.id] = { lastAt: Number(state.elapsedDays) || 0 };
      }
      return { item: pick.item, name: live.names?.[pick.item] ?? pick.item, count: take, effects };
    });
    const lines = ['你吃了' + result.name + '×' + result.count + '。'];
    if (result.effects.length) {
      for (const e of result.effects) {
        lines.push(e.name + ' ' + (e.delta >= 0 ? '+' : '') + e.delta + '（现在 ' + e.value + '/' + e.max + '）。');
      }
    } else {
      lines.push('这个道具没有配置状态效果。');
    }
    const s = summary(this.#state, cfg);
    if (s.states.length) {
      lines.push('状态：' + s.states.map((st) => (st.kind === 'flag'
        ? st.name + (st.active ? '（生效）' : '（未生效）')
        : st.name + ' ' + st.value + (st.unit || '') + '/' + st.max)).join('、') + '。');
    }
    lines.push('背包现在 ' + s.bagTotal + ' 件。');
    return { text: lines.join('\n') };
  }

  async #craftTool(args) {
    this.#ensureStarted();
    const recipes = this.#catalogOrThrow().recipes;
    if (!recipes.length) throw new Error('还没有合成表，去「道具合成表」加一张。');
    const raw = String(args?.recipe ?? '').trim();
    const label = (id) => live.names?.[id] ?? id;
    if (!raw) {
      const lines = ['合成表：'];
      for (const r of recipes) {
        lines.push('  ' + r.id + '：' + r.inputs.map((i) => label(i.item) + '×' + i.count).join(' + ') +
          ' → ' + label(r.output.item) + '×' + r.output.count);
      }
      lines.push('要合成：farm_craft {recipe:"' + recipes[0].id + '"}。');
      return { text: lines.join('\n') };
    }
    const recipe = recipes.find((r) => r.id === raw);
    if (!recipe) throw new Error('没有这张合成表：' + raw);
    const need = recipe.inputs.map((row) => ({
      ...row,
      have: Number(this.#state.inventory?.[row.item] ?? 0),
    }));
    const missing = need.filter((row) => row.have < row.count);
    if (missing.length) {
      throw new Error('材料不够：' + missing.map((row) => label(row.item) + ' ' + row.have + '/' + row.count).join('、') + '。');
    }
    await this.#mutate((state) => {
      state.inventory = state.inventory ?? {};
      for (const row of recipe.inputs) {
        state.inventory[row.item] = Number(state.inventory[row.item] ?? 0) - row.count;
        if (state.inventory[row.item] <= 0) delete state.inventory[row.item];
      }
      state.inventory[recipe.output.item] = Number(state.inventory[recipe.output.item] ?? 0) + recipe.output.count;
      return null;
    });
    return {
      text: '合成了 ' + label(recipe.output.item) + '×' + recipe.output.count +
        '（消耗 ' + need.map((row) => label(row.item) + '×' + row.count).join('、') + '）。',
    };
  }

  // ------------------------------------------------------------------ 状态存取
  async #mutate(action) {
    this.#ensureStarted();
    const cfg = this.#cfgAll();
    const next = structuredClone(this.#state);
    const size = applyFarmSize(next, cfg, this.random);
    if (size.changed) {
      this.#host?.log?.info?.('自定义农场：' + (next.lastMessage || '农田大小调整'), {
        from: size.oldCells, to: size.newCells, removed: size.removed, refunded: size.refunded,
        weedsRemoved: size.weedsRemoved, weedsAdded: size.weedsAdded,
      });
    }
    advance(next, this.now(), cfg, this.random);
    const result = action(next);
    next.v = STATE_VERSION;
    this.#state = next;
    await this.#saveOrThrow();
    return result;
  }

  /** 删除道具/作物/杂草定义后，把背包、已摆放装饰和掉落物里的引用一起清掉。 */
  async #purgeItemState(ids) {
    const set = new Set(ids.map(String));
    await this.#mutate((state) => {
      state.inventory = state.inventory ?? {};
      for (const id of set) delete state.inventory[id];
      state.furniture = (state.furniture ?? []).filter((f) => !set.has(String(f.id)));
      state.drops = (state.drops ?? []).filter((d) => !set.has(String(d.item)) && !set.has(String(d.crop)));
      return null;
    });
  }

  #stamp() {
    if (this.#state) this.#state.savedAt = new Date(this.now()).toISOString();
  }

  async #save() {
    if (!this.#state) return false;
    try {
      this.#stamp();
      await writeJsonAtomic(this.stateFile(), this.#state);
    } catch (err) {
      this.#host?.log?.warn?.('自定义农场：状态没存下来', { file: this.stateFile(), err: msg(err) });
      return false;
    }
    await this.#saveOverlay();
    return true;
  }

  async #saveOrThrow() {
    if (!this.#state) return;
    try {
      this.#stamp();
      await writeJsonAtomic(this.stateFile(), this.#state);
    } catch (err) {
      throw new Error('存档没写下去（磁盘只读/被占用？）：' + msg(err));
    }
    await this.#saveOverlay();
  }

  async #saveOverlay() {
    if (this.#flag('hideFarm')) return;
    if (!this.#flag('overlayEnabled')) return;
    try {
      if (this.#state) {
        const cfg = this.#cfgAll();
        this.#state.cropScale = cfg.cropScale;
        this.#state.dropScale = cfg.dropScale;
        this.#state.groundHeight = cfg.groundHeight;
        this.#state.stripHeight = cfg.stripHeight;
      }
      await writeJsonAtomic(this.overlayFile(), overlayView(this.#state));
    } catch (err) {
      this.#host?.log?.debug?.('自定义农场：图层状态没写出去', { file: this.overlayFile(), err: msg(err) });
    }
  }

  async #loadOrInit() {
    const file = this.stateFile();
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.plots)) {
        const loaded = migrate(parsed, this.#cfgAll(), this.random);
        if (loaded) {
          // 修复历史存档：旧版 levelOf 在玉米这种 total/(levels-1) 不是整数的作物上
          // 永远到不了最高级（进度 100% 却卡在 5/6、收不了）。按 growth 重算一遍 level。
          let repaired = 0;
          for (const plot of loaded.plots) {
            if (plot.dead) continue;
            const lv = levelOf(cropOf(plot.crop), plot.growth);
            if (Number(plot.level) !== lv) {
              plot.level = lv;
              repaired++;
            }
          }
          if (repaired > 0) this.#host?.log?.info?.('自定义农场：修复了 ' + repaired + ' 棵作物的等级（旧版玉米 5/6 bug）');
          this.#host?.log?.info?.('自定义农场：读到存档', {
            file,
            from: parsed.v,
            to: loaded.v,
            day: loaded.day,
            minute: Math.round(loaded.minute),
            coins: loaded.coins,
            plots: loaded.plots.length,
            drops: loaded.drops.length,
            savedAt: loaded.savedAt ?? '(无)',
          });
          return loaded;
        }
        this.#host?.log?.warn?.('自定义农场：存档版本不认识，重新开局', { file, v: parsed.v });
      }
    } catch (err) {
      if (err && typeof err === 'object' && err.code !== 'ENOENT') {
        this.#host?.log?.warn?.('自定义农场：读存档失败，重新开局', { file, err: msg(err) });
      }
    }
    this.#host?.log?.info?.('自定义农场：没有可用存档，开新局', { file });
    return newState(this.now(), this.#cfgAll(), this.random);
  }

  // ------------------------------------------------------------------ 时间推进
  #schedule() {
    if (!this.#started) return;
    if (this.#timer) {
      this.clearTimeoutImpl(this.#timer);
      this.#timer = null;
    }
    const timer = this.setTimeoutImpl(() => {
      this.#timer = null;
      void this.#serial(() => this.#tick())
        .catch((err) => this.#host?.log?.warn?.('自定义农场：tick 失败', { err: msg(err) }))
        .finally(() => this.#schedule());
    }, this.#tickMs());
    if (timer && typeof timer.unref === 'function') timer.unref();
    this.#timer = timer;
  }

  async #tick() {
    if (!this.#started || !this.#state) return;
    const cfg = this.#cfgAll();
    this.#syncLayerVisibility();
    const now = this.now();
    const size = applyFarmSize(this.#state, cfg, this.random);
    if (size.changed) {
      this.#host?.log?.info?.('自定义农场：' + (this.#state.lastMessage || '农田大小调整'), {
        from: size.oldCells, to: size.newCells, removed: size.removed, refunded: size.refunded,
        weedsRemoved: size.weedsRemoved, weedsAdded: size.weedsAdded,
      });
    }
    const result = advance(this.#state, now, cfg, this.random);
    this.#applyWeather(cfg, now);
    const weatherMoodChanges = this.#tickMood(cfg, now);
    if (result.cappedDays > 0) {
      // 关机/睡眠回来：只补算 maxStepDays 天，剩下的不补。否则一次 tick 就能跳几十天、整片田干死。
      this.#host?.log?.info?.('自定义农场：离线/睡眠的时间已截断', {
        skippedGameDays: result.cappedDays,
        maxStepDays: cfg.maxStepDays,
        realMinutesPerDay: cfg.realMinutesPerDay,
      });
    }
    const entered = new Set([...(result.stateChanges ?? []), ...weatherMoodChanges]
      .filter((c) => c.to === true)
      .map((c) => c.id));
    if (entered.size) {
      try { await this.#runStateActions(entered); } catch (err) {
        this.#host?.log?.warn?.('自定义农场：状态消耗行为失败', { err: msg(err) });
      }
    }
    try { await this.#pushMoodChanges([...(result.stateChanges ?? []), ...weatherMoodChanges]); } catch (err) {
      this.#host?.log?.warn?.('自定义农场：心情提醒没送出去', { err: msg(err) });
    }
    if (result.becameRipe.length) {
      try { await this.#pushRipe(result.becameRipe); } catch (err) { this.#host?.log?.warn?.('自定义农场：成熟提醒没送出去', { err: msg(err) }); }
    }
    if (result.becameDry.length) {
      try { await this.#pushDry(result.becameDry); } catch (err) { this.#host?.log?.warn?.('自定义农场：缺水提醒没送出去', { err: msg(err) }); }
    }
    // 枯萎不单独唤醒模型：没有可执行的补救动作，等它下次看 status 就行。
    // 每天的那条提醒默认不发：桌宠每被唤醒一次都要花 token，而"又过了一天"对它没有行动价值。
    // 只有"熟了 / 缺水 / 吃东西"这种真的需要它动的事才推事件。
    if (result.newDay) {
      if (this.#flag('dailyEvent')) {
        try { await this.#pushDay(); } catch (err) { this.#host?.log?.warn?.('自定义农场：新的一天提醒没送出去', { err: msg(err) }); }
      }
    }
    await this.#save();
  }

  async #pushDry(ids) {
    const host = this.#host;
    if (!host?.pushEvent) return;
    const s = summary(this.#state, this.#cfgAll());
    const mine = s.plots.filter((p) => ids.includes(p.id));
    if (mine.length === 0) return;
    const list = mine.map((p) => '  ' + p.id + ' 号' + p.crop + '（' + p.xPct + '%）土湿只剩 ' + Math.round(p.moisture * 100) + '%').join('\n');
    await host.pushEvent({
      type: 'farm.dry',
      source: 'farm',
      senderKey: 'farm.dry',
      origin: 'world',
      ts: new Date().toISOString(),
      text: '自定义农场：' + mine.length + ' 棵渴了，再不浇就要枯：\n' + list + '\n走到跟前 farm_water 就行。',
      meta: { plots: mine.map((p) => p.id) },
    }, { deliver: true, trigger: 'debounce' });
  }

  async #pushRipe(ids) {
    const host = this.#host;
    if (!host?.pushEvent) return;
    const s = summary(this.#state, this.#cfgAll());
    const mine = s.plots.filter((p) => ids.includes(p.id));
    await host.pushEvent({
      type: 'farm.ripe',
      source: this.id,
      senderKey: 'farm.ripe',
      origin: 'internal',
      ts: new Date(this.now()).toISOString(),
      text: '自定义农场：' + mine.map((p) => p.id + ' 号' + p.crop + '（' + p.xPct + '%）').join('、') +
        ' 熟了。走过去 farm_stand、farm_harvest，收完东西会掉在地上，再 farm_collect 捡进背包。',
      meta: { ids, spots: mine.map((p) => ({ id: p.id, xPct: p.xPct })) },
    }, { deliver: true, trigger: 'debounce' });
    host.log?.info?.('自定义农场：成熟', { ids });
  }

  async #pushDay() {
    const host = this.#host;
    if (!host?.pushEvent) return;
    const s = summary(this.#state, this.#cfgAll());
    const dry = s.plots.filter((p) => !p.dead && !p.ready && p.moisture < 40).length;
    await host.pushEvent({
      type: 'farm.day',
      source: this.id,
      senderKey: 'farm.day',
      origin: 'internal',
      ts: new Date(this.now()).toISOString(),
      text: '自定义农场：第 ' + s.day + ' 天，天气' + s.weather + '。' + (s.ripe ? s.ripe + ' 棵能收。' : '') +
        (s.drops ? '地上有 ' + s.drops + ' 个掉落物没捡。' : '') + (dry ? dry + ' 棵土干了。' : '') + '背包 ' + s.bagTotal + ' 件。',
      meta: { day: s.day, weather: s.weather, ripe: s.ripe, drops: s.drops, dry },
    }, { deliver: true, trigger: 'debounce' });
    host.log?.info?.('自定义农场：新的一天', { day: s.day, weather: s.weather });
  }

  #serial(task) {
    const run = () => task();
    const result = this.#queue.then(run, run);
    this.#queue = result.then(() => {}, () => {});
    return result;
  }

  // ------------------------------------------------------------------ WebUI
  webUi(language = 'zh') {
    this.language = language === 'en' ? 'en' : 'zh';
    const s = this.#state ? summary(this.#state, this.#cfgAll()) : null;
    const started = Boolean(s);
    return {
      label: '自定义农场',
      lamps: [{
        label: '田地',
        state: started ? 'online' : 'offline',
        hint: started ? (s.ripe > 0 ? s.ripe + ' 棵可收' : (s.drops > 0 ? s.drops + ' 个掉落物' : '生长中，' + s.clock)) : '未启动',
      }],
      badges: [
        { label: '背包', value: started ? s.bagTotal + ' 件' : '—', tone: started && s.bagTotal > 0 ? 'on' : 'off' },
        { label: '可收', value: started ? s.ripe + ' 棵' : '—', tone: started && s.ripe > 0 ? 'on' : 'off' },
        { label: '掉落', value: started ? s.drops + ' 个' : '—', tone: started && s.drops > 0 ? 'on' : 'off' },
        { label: '天数', value: started ? '第 ' + s.day + ' 天' : '—', tone: 'plain' },
      ],
      panels: [{
        id: 'bag',
        title: '背包',
        description: '背包、农场预览、摆放道具与手动合成；装饰在这里输入坐标放置。',
        getMethods: ['state'],
      }, {
        id: 'shop',
        title: '商店',
        description: '只列买价 > 0 的道具；点「买 1」放进背包。',
        getMethods: ['state'],
      }, {
        id: 'customize',
        title: '农场自定义',
        description: '农场地面、作物与杂草：增删、阶段天数、价值与贴图。',
        getMethods: ['state'],
      }, {
        id: 'ecology',
        title: '生态自定义',
        description: '生长条件与天气：时间、浇水、天气持续/概率、作物与装饰摇摆。',
        getMethods: ['state'],
      }, {
        id: 'status',
        title: '状态自定义',
        description: '自定义数值/开关状态与条件：比如饱食度低于 30 时进入饥饿。',
        getMethods: ['state'],
      }, {
        id: 'items',
        title: '道具自定义',
        description: '种子/农作物/消耗品/装饰：买卖价、消耗效果、贴图与摆放。',
        getMethods: ['state'],
      }],
      // 状态用 lamp + badges 展示，玩法参数放到下面的 config，走框架自带的「配置」页签。
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      config: farmConfigGroups(language),
      promptDocs: [{
        key: 'worlds.' + this.id + '.env',
        title: '环境提示词',
        description: '发给桌宠的环境提示词：吃饭/状态、节奏、工具用法。它是静态文字，不会跟作物/价格设置自动同步；具体数据以 farm_status / farm_shop 为准。',
        path: ENV_PROMPT,
        role: 'envPrompt',
      }],
    };
  }

  async invoke(panel, method, args = []) {
    return this.#serial(async () => {
      const cfg = this.#cfgAll();
      if (panel === 'status') return this.#statusInvoke(method, args, cfg);
      if (panel === 'bag') return this.#bagInvoke(method, args);
      if (panel === 'shop') return this.#shopInvoke(method, args);
      if (panel === 'items' && (method === 'saveRecipe' || method === 'removeRecipe')) return this.#recipesInvoke(method, args);
      if (panel === 'items') return this.#itemsInvoke(method, args);
      if (panel === 'recipes') return this.#recipesInvoke(method, args);
      if (panel === 'customize' || panel === 'ecology') return this.#customInvoke(method, args, cfg);
      if (method === 'state') {
        if (!this.#started) return { started: false, plots: [], bagTotal: 0 };
        return { started: true, ...summary(this.#state, cfg) };
      }
      if (method === 'water') {
        const plotId = args?.[0] === undefined || args?.[0] === null ? null : Number(args[0]);
        await this.#mutate((state) => water(state, cfg, plotId));
        return { started: true, ...summary(this.#state, cfg) };
      }
      if (method === 'harvest') {
        await this.#mutate((state) => harvest(state, cfg, null, this.random));
        return { started: true, ...summary(this.#state, cfg) };
      }
      if (method === 'plant') {
        const x = args?.[0] === undefined ? null : Number(args[0]);
        const crop = args?.[1] ? cropFromText(args[1]) : null;
        await this.#mutate((state) => plant(state, { x, crop, cfg, random: this.random }));
        return { started: true, ...summary(this.#state, cfg) };
      }
      throw new Error('不认识的方法：' + method);
    });
  }

  #settingsSnapshot() {
    const cfg = this.#cfgAll();
    const water = this.#catalog?.status?.water ?? { dryPerDay: 0.15, waterGain: 1, wiltDays: 2.2 };
    return {
      farmCells: cfg.farmCells,
      maxPlants: cfg.maxPlants,
      cropGapScale: cfg.cropGapScale,
      cropGapPct: cfg.cropGapPct,
      cropScale: cfg.cropScale,
      dropScale: cfg.dropScale,
      groundHeight: cfg.groundHeight,
      stripHeight: cfg.stripHeight,
      moodIntervalMin: this.#num('moodIntervalMin', 1, 1440),
      startWeeds: cfg.startWeeds,
      maxWeeds: cfg.maxWeeds,
      weedPerDay: cfg.weedPerDay,
      weedClearRadius: cfg.weedClearRadius,
      realMinutesPerDay: cfg.realMinutesPerDay,
      maxStepDays: cfg.maxStepDays,
      tickIntervalMs: this.#num('tickIntervalMs', 1000, 3600000),
      dailyEvent: this.#flag('dailyEvent'),
      water: {
        dryPerDay: Number(water.dryPerDay ?? 0.15),
        waterGain: Number(water.waterGain ?? 1),
        wiltDays: Number(water.wiltDays ?? 2.2),
      },
      weathers: cfg.weathers,
    };
  }

  /** 「农场自定义」页的数据面。统一返回最新 snapshot，面板不用再读一次。 */
  async #customInvoke(method, args, cfg) {
    if (method === 'sprite') {
      const name = String(args?.[0] ?? '');
      return { $binary: this.#catalogOrThrow().spriteBase64(name) };
    }
    const catalog = this.#catalogOrThrow();
    const snap = () => ({ ...catalog.snapshot(), settings: this.#settingsSnapshot() });
    const after = async () => {
      try { await this.#saveOverlay(); } catch { /* 图层没写好不影响面板 */ }
      return snap();
    };
    switch (method) {
      case 'state':
        return { started: Boolean(this.#state), catalog: snap() };
      case 'saveSettings': {
        const input = args?.[0] ?? {};
        const { water, ...rest } = input;
        catalog.saveSettings(rest);
        if (water) {
          catalog.saveStatus({
            ...catalog.status,
            water: { ...catalog.status.water, ...water },
          });
        }
        if (input.weathers) this.#applyWeather(this.#cfgAll(), this.now());
        return after();
      }
      case 'applyWeatherNow': {
        const id = String(args?.[0] ?? '');
        const cur = weatherById(cfg.weathers, id);
        if (!cur) throw new Error('没有这种天气：' + id);
        this.#state.weatherId = cur.id;
        this.#state.weather = cur.name;
        this.#state.weatherUntil = this.now() + cur.duration * 1000;
        this.#state.weatherFx = weatherFxOf(cur);
        try { await this.#saveOverlay(); } catch { /* 图层没写好不影响切换 */ }
        return after();
      }
      case 'previewWeather': {
        const id = String(args?.[0] ?? '');
        const cur = weatherById(cfg.weathers, id);
        if (!cur) throw new Error('没有这种天气：' + id);
        this.#state.weatherId = cur.id;
        this.#state.weather = cur.name;
        this.#state.weatherUntil = this.now() + 5000;
        this.#state.weatherFx = weatherFxOf(cur);
        try { await this.#saveOverlay(); } catch { /* 图层没写好不影响预览 */ }
        return after();
      }
      case 'selectGround':
        catalog.selectGround(args?.[0]);
        return after();
      case 'addGround':
        catalog.addGround(args?.[0], args?.[1]);
        return after();
      case 'removeGround':
        catalog.removeGround(args?.[0]);
        return after();
      case 'saveCrop': {
        const input = args?.[0] ?? {};
        catalog.saveCrop(input);
        return after();
      }
      case 'removeCrop': {
        const key = String(args?.[0] ?? '');
        const crop = CROPS[key];
        if (!crop) throw new Error('没有这种作物：' + key);
        if (this.#compiledCropCount() <= 1) throw new Error('至少要留一种作物，不能全删光。');
        const n = (this.#state?.plots ?? []).filter((p) => p.crop === key).length;
        if (n > 0) throw new Error('田里还种着 ' + n + ' 棵' + crop.name + '，先收掉或拔掉再删。');
        catalog.removeCrop(key);
        await this.#purgeItemState([key, 'seed_' + key]);
        return after();
      }
      case 'resetCrop':
        catalog.resetCrop(args?.[0]);
        return after();
      case 'saveWeed': {
        const input = args?.[0] ?? {};
        catalog.saveWeed(input);
        return after();
      }
      case 'removeWeed': {
        const key = String(args?.[0] ?? '');
        const type = live.weeds?.[key];
        if (!type) throw new Error('没有这种杂草：' + key);
        const n = (this.#state?.weeds ?? []).filter((w) => (w.type ?? 'weed') === key).length;
        if (n > 0) throw new Error('田里还有 ' + n + ' 丛' + type.name + '，先铲掉再删。');
        catalog.removeWeed(key);
        await this.#purgeItemState(['weed_' + key]);
        return after();
      }
      case 'resetWeed':
        catalog.resetWeed(args?.[0]);
        return after();
      case 'saveStatus':
        catalog.saveStatus(args?.[0]);
        return after();
      case 'resetFx':
        catalog.resetFx();
        return after();
      case 'importSprite':
        return catalog.importSprite(args?.[0], args?.[1], args?.[2], args?.[3]);
      case 'exportTemplate':
        return await this.#exportTemplate();
      case 'importTemplate':
        await this.#importTemplate(args?.[0]);
        return after();
      default:
        throw new Error('农场自定义不支持这个方法：' + method);
    }
  }

  async #exportTemplate() {
    const catalog = this.#catalogOrThrow();
    try { catalog.persist(); } catch { /* 写不进去也尽量导出内存里的 */ }
    const entries = [
      {
        name: 'template.json',
        data: Buffer.from(JSON.stringify({
          format: 'custom-farm-template',
          version: 1,
          createdAt: new Date(this.now()).toISOString(),
        }, null, 2)),
      },
      { name: 'custom.json', data: await readFile(catalog.storePath) },
    ];
    let files = [];
    try { files = await readdir(catalog.spritesDir); } catch { /* 没有自定义贴图 */ }
    for (const file of files.sort()) {
      if (!/^cust_[A-Za-z0-9_-]+\.png$/i.test(file)) continue;
      entries.push({ name: 'sprites/' + file, data: await readFile(join(catalog.spritesDir, file)) });
    }
    const zip = buildZip(entries);
    return {
      $binary: { mime: 'application/zip', base64: zip.toString('base64') },
    };
  }

  async #importTemplate(srcPath) {
    const file = String(srcPath ?? '').trim();
    if (!file) throw new Error('没选 ZIP 文件。');
    if (!/\.zip$/i.test(file)) throw new Error('模板要选 .zip 文件。');
    if (!existsSync(file)) throw new Error('找不到这个文件：' + file);
    const buf = await readFile(file);
    if (buf.length > 64 * 1024 * 1024) throw new Error('ZIP 太大了（>64MB）。');
    const entries = readZip(buf);
    const customEntry = entries.find((e) => e.name === 'custom.json' || e.name === 'farm/custom.json');
    if (!customEntry) throw new Error('ZIP 里没有 custom.json，不像是自定义农场模板。');
    if (customEntry.data.length > 5 * 1024 * 1024) throw new Error('custom.json 太大了。');
    let raw;
    try { raw = JSON.parse(customEntry.data.toString('utf8')); } catch { throw new Error('custom.json 不是有效 JSON。'); }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.crops) || !raw.crops.length) {
      throw new Error('custom.json 缺少作物设置。');
    }
    const meta = entries.find((e) => e.name === 'template.json');
    if (meta) {
      try {
        const info = JSON.parse(meta.data.toString('utf8'));
        if (info?.format && info.format !== 'custom-farm-template') throw new Error('模板格式不匹配：' + info.format);
      } catch (err) {
        if (/模板格式不匹配/.test(msg(err))) throw err;
      }
    }
    const sprites = entries.filter((e) => /^sprites\/[^/]+\.png$/i.test(e.name));
    const catalog = this.#catalogOrThrow();
    const backup = existsSync(catalog.storePath) ? await readFile(catalog.storePath) : null;
    const spriteBackup = new Map();
    const spriteWritten = [];
    try {
      await mkdir(catalog.spritesDir, { recursive: true });
      await mkdir(dirname(catalog.storePath), { recursive: true });
      for (const entry of sprites) {
        const name = entry.name.split('/').pop();
        if (!/^cust_[A-Za-z0-9_-]+\.png$/i.test(name)) throw new Error('模板贴图名不合法：' + name);
        if (entry.data.length > 4 * 1024 * 1024) throw new Error('模板贴图超过 4MB：' + name);
        if (entry.data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('模板贴图不是 PNG：' + name);
        const target = join(catalog.spritesDir, name);
        if (existsSync(target)) spriteBackup.set(name, await readFile(target));
        await writeFile(target, entry.data);
        spriteWritten.push(name);
      }
      const tmp = catalog.storePath + '.import-' + process.pid;
      await writeFile(tmp, Buffer.from(customEntry.data));
      await rename(tmp, catalog.storePath);
      catalog.load();
      this.#syncStateValues();
      await this.#saveOrThrow();
    } catch (err) {
      for (const name of spriteWritten) {
        const target = join(catalog.spritesDir, name);
        try {
          if (spriteBackup.has(name)) await writeFile(target, spriteBackup.get(name));
          else await unlink(target);
        } catch { /* 尽量恢复 */ }
      }
      if (backup) {
        try { await writeFile(catalog.storePath, backup); catalog.load(); } catch { /* 尽量恢复 */ }
      }
      throw new Error('导入模板失败（已尽量恢复原设置）：' + msg(err));
    }
    return catalog.snapshot();
  }

  #compiledCropCount() {
    return Object.keys(CROPS).length;
  }

  // ------------------------------------------------------------------ 道具自定义
  async #itemsInvoke(method, args) {
    const catalog = this.#catalogOrThrow();
    const snap = () => ({
      ...catalog.snapshotItems(),
      ...catalog.snapshotRecipes(),
    });
    const after = async () => {
      try { await this.#save(); } catch { /* 面板操作失败另报 */ }
      return snap();
    };
    switch (method) {
      case 'state':
        return snap();
      case 'saveItem':
        catalog.saveItem(args?.[0]);
        return after();
      case 'removeItem':
        catalog.removeItem(args?.[0]);
        await this.#purgeItemState([args?.[0]]);
        return after();
      case 'importSprite':
        return catalog.importSprite('item', String(args?.[0] ?? 'item'), String(args?.[1] ?? 'icon'), args?.[2]);
      case 'sprite':
        return { $binary: catalog.spriteBase64(args?.[0]) };
      case 'placeItem': {
        const r = await this.#placeItem(args?.[0], args?.[1]);
        return { ...snap(), ...r };
      }
      default:
        throw new Error('道具自定义不支持这个方法：' + method);
    }
  }

  async #placeItem(id, xArg) {
    const key = String(id ?? '');
    const item = live.items?.[key];
    if (!item || item.kind !== 'decor') throw new Error('不是装饰道具：' + key);
    if (!item.sprite) throw new Error(item.name + ' 还没有摆放贴图，先去「道具自定义」上传。');
    const wanted = xArg === undefined || xArg === null ? NaN : Number(xArg);
    const x = Number.isFinite(wanted)
      ? Math.min(1, Math.max(0, wanted))
      : (Number.isFinite(Number(this.#state?.standingAt)) ? Number(this.#state.standingAt) : 0.5);
    const r = await this.#mutate((state) => placeDecoration(state, item, x));
    return {
      text: '把' + r.name + '放在了 ' + Math.round(r.x * 100) + '%' +
        (r.cleared ? '，清掉了 ' + r.cleared + ' 丛杂草' : '') + '。',
    };
  }

  // ------------------------------------------------------------------ 背包 / 商店
  #bagSnapshot() {
    const inv = this.#state?.inventory ?? {};
    const items = Object.entries(inv)
      .filter(([, n]) => Number(n) > 0)
      .map(([id, count]) => {
        const def = live.items?.[id] ?? {};
        return {
          id,
          name: live.names?.[id] ?? id,
          icon: live.itemIcons?.[id] ?? 'icon_item_soil',
          count: Number(count),
          kind: def.kind ?? 'item',
          sell: sellPriceOf(id),
          placeable: def.kind === 'decor' && Boolean(def.sprite),
          consumable: Boolean(def.consumable),
          sprite: def.sprite ?? '',
        };
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'zh'));
    const shop = Object.values(live.items ?? {})
      .filter((it) => it.buy > 0)
      .map((it) => ({
        id: it.id,
        name: it.name,
        icon: it.icon ?? 'icon_item_soil',
        buy: it.buy,
        sell: it.sell,
        kind: it.kind,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'zh'));
    const recipes = (this.#catalog?.recipes ?? []).map((r) => {
      const inputs = r.inputs.map((row) => ({
        item: row.item,
        count: row.count,
        name: live.names?.[row.item] ?? row.item,
        icon: live.itemIcons?.[row.item] ?? 'icon_item_soil',
        have: Number(inv[row.item] ?? 0),
      }));
      const output = {
        item: r.output.item,
        count: r.output.count,
        name: live.names?.[r.output.item] ?? r.output.item,
        icon: live.itemIcons?.[r.output.item] ?? 'icon_item_soil',
        have: Number(inv[r.output.item] ?? 0),
      };
      const max = inputs.length
        ? Math.min(...inputs.map((row) => Math.floor(row.have / row.count)))
        : 0;
      return { id: r.id, inputs, output, max };
    });
    return {
      coins: Math.floor(Number(this.#state?.coins ?? 0)),
      bagTotal: items.reduce((a, x) => a + x.count, 0),
      items,
      shop,
      recipes,
      preview: this.#previewSnapshot(),
    };
  }

  #previewSnapshot() {
    const view = overlayView(this.#state);
    const items = [];
    for (const p of view.plots ?? []) {
      items.push({
        key: 'crop:' + p.id,
        kind: 'crop',
        id: p.crop,
        plotId: p.id,
        name: p.name,
        icon: live.itemIcons?.[p.crop] ?? p.sprite ?? 'icon_item_soil',
        layer: 'crop',
        count: 1,
        positions: [{ x: p.x, sprite: p.sprite ?? '' }],
      });
    }
    for (const f of view.furniture ?? []) {
      items.push({
        key: 'decor:' + f.uid,
        kind: 'decor',
        id: f.id,
        uid: f.uid,
        name: live.names?.[f.id] ?? f.id,
        icon: live.itemIcons?.[f.id] ?? f.sprite ?? 'icon_item_soil',
        layer: f.layer ?? 'bottom',
        count: 1,
        positions: [{ x: f.x, sprite: f.sprite ?? '' }],
      });
    }
    items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'crop' ? -1 : 1;
      const byName = a.name.localeCompare(b.name, 'zh');
      return byName !== 0 ? byName : Number(a.positions[0]?.x ?? 0) - Number(b.positions[0]?.x ?? 0);
    });
    return { ground: view.ground?.tile ?? '', items };
  }

  async #shopInvoke(method, args) {
    switch (method) {
      case 'state':
        return this.#bagSnapshot();
      case 'buy':
        return this.#bagInvoke('buy', args);
      case 'sprite':
        return this.#bagInvoke('sprite', args);
      default:
        throw new Error('商店不支持这个方法：' + method);
    }
  }

  async #bagInvoke(method, args) {
    const catalog = this.#catalogOrThrow();
    switch (method) {
      case 'state':
        return this.#bagSnapshot();
      case 'sprite':
        return { $binary: catalog.spriteBase64(args?.[0]) };
      case 'sell': {
        const cfg = this.#cfgAll();
        const r = await this.#mutate((state) => sell(state, cfg, args?.[0], args?.[1]));
        return {
          ...this.#bagSnapshot(),
          text: '卖了 ' + r.count + ' 个' + r.name + '，+' + r.coins + ' 金币。',
        };
      }
      case 'buy': {
        const r = await this.#mutate((state) => buy(state, args?.[0], args?.[1]));
        return {
          ...this.#bagSnapshot(),
          text: '买了 ' + (r.item?.name ?? String(args?.[0] ?? '道具')) + '×' + (r.count ?? 1) +
            '，-' + r.price + ' 金币。',
        };
      }
      case 'placeItem': {
        const r = await this.#placeItem(args?.[0], args?.[1]);
        return { ...this.#bagSnapshot(), ...r };
      }
      case 'removeCrop': {
        const raw = args?.[0];
        const plots = this.#state?.plots ?? [];
        let plot = plots.find((p) => String(p.id) === String(raw));
        if (!plot) plot = plots.find((p) => p.crop === String(raw));
        if (!plot) throw new Error('田里没有这株作物。');
        const name = live.names?.[plot.crop] ?? plot.crop;
        await this.#mutate((state) => {
          state.plots = state.plots.filter((p) => p.id !== plot.id);
          return null;
        });
        return { ...this.#bagSnapshot(), text: '铲除了 1 棵' + name + '。' };
      }
      case 'recycleDecor': {
        const raw = args?.[0];
        const furniture = this.#state?.furniture ?? [];
        let owned = furniture.find((f) => String(f.uid) === String(raw));
        if (!owned) owned = furniture.find((f) => f.id === String(raw));
        if (!owned) throw new Error('农场里没有这个装饰。');
        const name = live.names?.[owned.id] ?? owned.id;
        await this.#mutate((state) => {
          state.furniture = state.furniture.filter((f) => f.uid !== owned.uid);
          state.inventory = state.inventory ?? {};
          state.inventory[owned.id] = Number(state.inventory[owned.id] ?? 0) + 1;
          return null;
        });
        return { ...this.#bagSnapshot(), text: '回收了 1 个' + name + '，已经放回背包。' };
      }
      case 'craft': {
        const id = String(args?.[0] ?? '');
        const n = Math.max(1, Math.min(99, Math.floor(Number(args?.[1]) || 1)));
        const recipe = catalog.recipes.find((r) => r.id === id);
        if (!recipe) throw new Error('没有这张合成表：' + id);
        const inv = this.#state?.inventory ?? {};
        const missing = recipe.inputs.filter((row) => Number(inv[row.item] ?? 0) < row.count * n);
        if (missing.length) {
          throw new Error('材料不够：' + missing.map((row) =>
            (live.names?.[row.item] ?? row.item) + ' ' + Number(inv[row.item] ?? 0) + '/' + (row.count * n)).join('、') + '。');
        }
        await this.#mutate((state) => {
          state.inventory = state.inventory ?? {};
          for (const row of recipe.inputs) {
            state.inventory[row.item] = Number(state.inventory[row.item] ?? 0) - row.count * n;
            if (state.inventory[row.item] <= 0) delete state.inventory[row.item];
          }
          state.inventory[recipe.output.item] = Number(state.inventory[recipe.output.item] ?? 0) + recipe.output.count * n;
          return null;
        });
        return {
          ...this.#bagSnapshot(),
          text: '合成了 ' + (live.names?.[recipe.output.item] ?? recipe.output.item) + '×' + (recipe.output.count * n) + '。',
        };
      }
      default:
        throw new Error('背包不支持这个方法：' + method);
    }
  }

  // ------------------------------------------------------------------ 道具合成表
  async #recipesInvoke(method, args) {
    const catalog = this.#catalogOrThrow();
    const after = async () => {
      try { await this.#save(); } catch { /* 面板操作失败另报 */ }
      return catalog.snapshotRecipes();
    };
    switch (method) {
      case 'state':
        return catalog.snapshotRecipes();
      case 'saveRecipe':
        catalog.saveRecipe(args?.[0]);
        return after();
      case 'removeRecipe':
        catalog.removeRecipe(args?.[0]);
        return after();
      default:
        throw new Error('道具合成表不支持这个方法：' + method);
    }
  }

  // ------------------------------------------------------------------ 自定义状态
  #statusSnapshot() {
    const catalog = this.#catalogOrThrow();
    const defs = catalog.states;
    const rules = catalog.rules;
    const liveVals = this.#state?.states ?? {};
    const nameOf = (id) => defs.find((d) => d.id === id)?.name ?? id;
    const items = Object.entries(live.names ?? {})
      .filter(([id]) => live.consumables?.some((it) => it.id === id) && live.itemIcons?.[id])
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return {
      states: defs.map((d) => ({
        ...d,
        value: d.kind === 'flag' ? null : round2(Number(liveVals[d.id]?.value ?? d.initial)),
        active: d.kind === 'flag' ? Boolean(liveVals[d.id]?.active ?? d.initialActive) : null,
      })),
      rules: rules.map((r) => ({
        ...r,
        sourceName: nameOf(r.source),
        targetName: nameOf(r.target),
        current: compareValue(liveVals[r.source]?.value, r.op, r.value),
      })),
      consume: (catalog.consume ?? []).map((c) => ({
        ...c,
        triggerName: nameOf(c.trigger),
        effectName: c.effectState ? nameOf(c.effectState) : null,
        itemNames: c.items.map((id) => live.names?.[id] ?? id),
      })),
      items,
      ops: ['<', '<=', '>', '>=', '==', '!='],
      exampleExists: defs.some((d) => d.name === '饱食度') || defs.some((d) => d.name === '饥饿'),
    };
  }

  /** 状态定义变了以后：补齐新状态、丢掉已删状态、按初始值/规则重算一遍。 */
  #syncStateValues() {
    if (!this.#state) return;
    const defs = this.#catalog?.states ?? [];
    if (!this.#state.states || typeof this.#state.states !== 'object') this.#state.states = {};
    tickStates(this.#state, defs, this.#catalog?.rules ?? [], 0);
  }

  /** 推一条“状态触发了消耗”的事件给桌宠。 */
  async #pushStateEvent(text, meta) {
    const host = this.#host;
    if (!host?.pushEvent) return;
    await host.pushEvent({
      type: 'farm.state',
      source: this.id,
      senderKey: 'farm.state',
      origin: 'internal',
      ts: new Date(this.now()).toISOString(),
      text,
      meta,
    }, { deliver: true, trigger: 'debounce' });
  }

  /** 每个 tick 调一次：触发状态生效后，自动/提醒桌宠消耗配置里的道具。 */
  async #runStateActions(onlyTriggers = null) {
    const catalog = this.#catalog;
    if (!catalog || !(catalog.consume?.length)) return;
    const results = consumeActions(this.#state, catalog.states, catalog.rules, catalog.consume, this.#state.elapsedDays, onlyTriggers);
    for (const r of results) {
      const meta = { trigger: r.action.trigger, action: r.action.id, item: r.item ?? null, count: r.count ?? 0 };
      if (r.missing) {
        const names = r.action.items.map((id) => live.names?.[id] ?? id).join('、');
        await this.#pushStateEvent('「' + r.triggerName + '」生效了，但背包里没有能消耗的道具（' + names + '）。去收菜或 farm_shop 买点。', meta);
        continue;
      }
      if (r.promptOnly) {
        const eff = r.action.effectState
          ? '，吃掉会' + (live.names?.[r.action.effectState] ?? r.action.effectState) + ' ' + (Number(r.action.effectDelta) >= 0 ? '+' : '') + Number(r.action.effectDelta)
          : '';
        await this.#pushStateEvent('「' + r.triggerName + '」生效了：吃点东西吧。背包里有' + r.itemName +
          '；farm_consume {item:"' + r.item + '"} 可以吃掉 1 个' + eff + '。', meta);
        continue;
      }
      let text = '「' + r.triggerName + '」生效：吃掉了' + r.itemName + '×' + r.count;
      if (r.effects?.length) {
        text += '，' + r.effects.map((e) => e.name + ' ' + (e.delta >= 0 ? '+' : '') + e.delta +
          '（现在 ' + e.value + '/' + e.max + '）').join('、');
      }
      text += '。';
      await this.#pushStateEvent(text, meta);
    }
  }

  async #statusInvoke(method, args) {
    const catalog = this.#catalogOrThrow();
    const after = async () => {
      this.#syncStateValues();
      try { await this.#save(); } catch { /* 保存失败由面板另报 */ }
      return this.#statusSnapshot();
    };
    switch (method) {
      case 'state':
        return this.#statusSnapshot();
      case 'saveState':
        catalog.saveState(args?.[0]);
        return after();
      case 'removeState':
        catalog.removeState(args?.[0]);
        return after();
      case 'saveRule':
        catalog.saveRule(args?.[0]);
        return after();
      case 'removeRule':
        catalog.removeRule(args?.[0]);
        return after();
      case 'saveConsume':
        catalog.saveConsume(args?.[0]);
        return after();
      case 'removeConsume':
        catalog.removeConsume(args?.[0]);
        return after();
      case 'addExample':
        catalog.addExample();
        return after();
      case 'setValue': {
        const id = String(args?.[0] ?? '');
        const def = catalog.states.find((s) => s.id === id);
        if (!def) throw new Error('没有这个状态：' + id);
        const raw = args?.[1];
        let value = 0;
        if (def.kind === 'flag') {
          value = Boolean(raw);
        } else {
          value = Number(raw);
          if (!Number.isFinite(value)) throw new Error('数值不对。');
          value = Math.min(Number(def.max), Math.max(Number(def.min), value));
        }
        await this.#mutate((state) => {
          state.states = state.states ?? {};
          state.states[id] = def.kind === 'flag' ? { active: Boolean(value) } : { value: round2(value) };
          // 手动改完立刻按规则重算开关状态，保证存下去的也是重算后的结果
          tickStates(state, catalog.states, catalog.rules, 0);
          return null;
        });
        return this.#statusSnapshot();
      }
      default:
        throw new Error('状态自定义不支持这个方法：' + method);
    }
  }

  /**
   * 停止两块桌面图层。返回 Promise：World 重启时先等旧守护真的退出，
   * 否则紧接着的 -Ensure 会被这个 -Stop 杀掉（竞态）。
   */
  /** 游戏配置里的「隐藏农场」开关：停止/恢复桌面图层，不停止农场 tick。 */
  /** 按天气持续时间/权重推进天气；视觉参数写入 state.weatherFx。 */
  #applyWeather(cfg, now) {
    if (!this.#state) return;
    const list = normalizeWeathers(cfg.weathers);
    let cur = weatherById(list, this.#state.weatherId);
    if (!cur || !this.#state.weatherUntil || now >= Number(this.#state.weatherUntil)) {
      cur = pickWeather(list, this.random);
      this.#state.weatherId = cur.id;
      this.#state.weather = cur.name;
      this.#state.weatherUntil = now + cur.duration * 1000;
    }
    this.#state.weather = cur.name;
    this.#state.weatherFx = weatherFxOf(cur);
  }
  /** 按真实分钟结算天气对心情的影响。返回 happy/bored 的变化。 */
  #tickMood(cfg, now) {
    if (!this.#state) return [];
    const defs = cfg.stateDefs ?? [];
    const moodDef = defs.find((d) => d.id === 'mood');
    if (!moodDef) return [];
    const interval = Math.max(1, Number(cfg.moodIntervalMin ?? 10)) * 60000;
    const last = Number(this.#state.moodAt);
    if (!Number.isFinite(last) || last <= 0) { this.#state.moodAt = now; return []; }
    if (now - last < interval) return [];
    const steps = Math.floor((now - last) / interval);
    this.#state.moodAt = last + steps * interval;
    const weather = (cfg.weathers ?? []).find((w) => w.id === this.#state.weatherId);
    const delta = Number(weather?.mood ?? 0) * steps;
    if (delta !== 0) {
      this.#state.states = this.#state.states ?? {};
      const before = Number(this.#state.states.mood?.value ?? moodDef.initial);
      const after = Math.min(Number(moodDef.max), Math.max(Number(moodDef.min), before + delta));
      this.#state.states.mood = { value: round2(after) };
    }
    const beforeFlags = {};
    for (const id of ['happy', 'bored']) beforeFlags[id] = Boolean(this.#state.states?.[id]?.active);
    const changes = tickStates(this.#state, defs, cfg.stateRules ?? [], 0);
    return changes.filter((c) => (c.id === 'happy' || c.id === 'bored') && c.to === true);
  }

  /** happy / bored 变成 true 时推一条事件，让桌宠说话或吃东西。 */
  async #pushMoodChanges(changes) {
    if (!Array.isArray(changes) || !changes.length) return;
    const seen = new Set();
    for (const c of changes) {
      if (c.to !== true || seen.has(c.id)) continue;
      seen.add(c.id);
      const mood = this.#state?.states?.mood?.value;
      if (c.id === 'happy') {
        await this.#pushStateEvent('心情很好（' + mood + '/100），想和主人说句话。', { mood, moodState: 'happy' });
      } else if (c.id === 'bored') {
        await this.#pushStateEvent('有点无聊（' + mood + '/100），想吃点东西，或者和主人聊两句。', { mood, moodState: 'bored' });
      }
    }
  }

  #syncLayerVisibility() {
    const hide = this.#flag('hideFarm');
    if (hide === this.#hidden) return;
    this.#hidden = hide;
    if (hide) void this.#stopLayers('隐藏农场');
    else this.#ensureLayers('显示农场');
  }

  #stopLayers(reason) {
    if (!this.manageLayers) { return Promise.resolve(); }
    try {
      const pidFile = join(this.dataDir, 'farm', 'electron.pid');
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, 'utf8').trim());
        if (pid > 0) { try { process.kill(pid); } catch { } }
        try { unlinkSync(pidFile); } catch { }
      }
    } catch { }
    if (process.platform !== 'win32') {
      try {
        const pidFile = join(this.dataDir, 'farm', 'electron.pid');
        if (existsSync(pidFile)) {
          const pid = Number(readFileSync(pidFile, 'utf8').trim());
          if (pid > 0) { try { process.kill(pid); } catch { } }
          try { unlinkSync(pidFile); } catch { }
        }
      } catch { }
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      try {
        const paths = this.#paths ?? (this.#paths = makePaths(resolvePetHome(this.cfg?.petRoot)));
        const script = join(paths.overlayDir, 'restart-layers.ps1');
        if (!existsSync(script)) { finish(); return; }
        const child = spawn('powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Stop', '-Quiet'],
          { stdio: 'ignore', windowsHide: true });
        child.on('exit', finish);
        child.on('error', finish);
        child.unref();
        this.#host?.log?.info?.('自定义农场：正在停止桌面图层' + (reason ? '（' + reason + '）' : ''));
      } catch (err) {
        this.#host?.log?.warn?.('自定义农场：停止桌面图层失败', { err: msg(err) });
        finish();
        return;
      }
      // 最多等 5 秒，App 关机能尽快走完（不要 unref：否则事件循环空了会留下没 resolve 的 await）
      setTimeout(finish, 5000);
    });
  }

  /**
   * 确保两块桌面图层在跑：交给 overlay\restart-layers.ps1（单守护 + 自愈 + 幂等）。
   * 只 -Ensure，绝不杀健康的图层 —— 以前"巡检发现不在 → 杀掉重启"正是背景层消失的原因。
   */
  /** Electron overlay 是否可用：launch.js 和 electron 模块都在。 */
  #electronReady(paths) {
    const launcher = join(paths.electronDir, 'launch.js');
    const local = join(paths.electronDir, 'node_modules', 'electron');
    const pkg = join(paths.home, 'node_modules', 'electron');
    return existsSync(launcher) && (existsSync(local) || existsSync(pkg));
  }

  #electronPidAlive() {
    try {
      const pidFile = join(this.dataDir, 'farm', 'electron.pid');
      if (!existsSync(pidFile)) return false;
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      if (!(pid > 0)) return false;
      process.kill(pid, 0);
      return true;
    } catch { return false; }
  }

  #startElectron(paths) {
    if (!this.#electronReady(paths)) return false;
    if (this.#electronPidAlive()) return true;
    try {
      const launcher = join(paths.electronDir, 'launch.js');
      const pidFile = join(this.dataDir, 'farm', 'electron.pid');
      const child = spawn(process.execPath, [launcher, '--state-path', paths.overlayState, '--assets-dir', paths.assetsDir, '--pid', pidFile, '--log', join(dirname(this.overlayFile()), 'electron.log')], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      child.unref();
      this.#layerChild = child;
      this.#layerAt = Date.now();
      this.#host?.log?.info?.('自定义农场：已启动 Electron overlay');
      return true;
    } catch (err) {
      this.#host?.log?.warn?.('自定义农场：Electron overlay 没起来', { err: msg(err) });
      return false;
    }
  }

  #ensureLayers(reason) {
    if (!this.manageLayers || this.#flag('hideFarm')) { return; }
    const paths0 = this.#paths ?? (this.#paths = makePaths(resolvePetHome(this.cfg?.petRoot)));
    if (this.#electronReady(paths0)) {
      if (this.#electronPidAlive()) return;
      if (process.platform === 'win32') {
        try {
          const script = join(paths0.overlayDir, 'restart-layers.ps1');
          if (existsSync(script)) {
            const stop = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Stop', '-Quiet'], { stdio: 'ignore', windowsHide: true });
            stop.on('exit', () => { this.#startElectron(paths0); });
            stop.unref();
            return;
          }
        } catch { /* fall through */ }
      }
      this.#startElectron(paths0);
      return;
    }
    if (process.platform !== 'win32') {
      try {
        const paths = this.#paths ?? (this.#paths = makePaths(resolvePetHome(this.cfg?.petRoot)));
        const launcher = join(paths.electronDir, 'launch.js');
        const localElectron = join(paths.electronDir, 'node_modules', 'electron');
        const packageElectron = join(paths.home, 'node_modules', 'electron');
        if (existsSync(launcher) && (existsSync(localElectron) || existsSync(packageElectron))) {
          const pidFile = join(this.dataDir, 'farm', 'electron.pid');
          const child = spawn(process.execPath, [launcher, '--state-path', paths.overlayState, '--assets-dir', paths.assetsDir, '--pid', pidFile, '--log', join(dirname(this.overlayFile()), 'electron.log')], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
          child.unref();
          this.#layerChild = child;
          this.#layerAt = Date.now();
          this.#host?.log?.info?.('自定义农场：已启动 Electron overlay');
        }
      } catch (err) { this.#host?.log?.warn?.('自定义农场：Electron overlay 没起来', { err: msg(err) }); }
      return;
    }
    try {
      const paths = this.#paths ?? (this.#paths = makePaths(resolvePetHome(this.cfg?.petRoot)));
      const script = join(paths.overlayDir, 'restart-layers.ps1');
      if (!existsSync(script)) return;
      const child = spawn('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Ensure', '-Quiet'],
        { stdio: 'ignore', windowsHide: true });
      child.unref();
      this.#layerChild = child;
      this.#layerAt = Date.now();
      this.#host?.log?.info?.('自定义农场：正在确保桌面图层在跑' + (reason ? '（' + reason + '）' : ''));
    } catch (err) {
      this.#host?.log?.warn?.('自定义农场：桌面图层没起来', { err: msg(err) });
    }
  }

  /**
   * 不再做周期巡检。
   * 旧版每 90 秒检查一次 weeds.pid，发现"不在"就重启整组图层 —— 结果把健康的
   * 背景层也一起杀掉，日志停在 snapshot 却没有任何 closed/CAUGHT（外部 Stop-Process）。
   * 现在：图层进程由 overlay\restart-layers.ps1 的守护自己看护，World 只在启动时 -Ensure。
   */

  /** 背包/图层 -> World 的命令文件（UI 不能直接调工具，用文件当通道）。 */
  commandDir() {
    return join(dirname(this.overlayFile()), 'commands');
  }

  commandFile() {
    return join(this.commandDir(), 'pending.json');
  }

  async #drainCommands() {
    const dir = this.commandDir();
    let files = [];
    try { files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort(); } catch { return; }
    if (files.length === 0) return;
    const list = [];
    for (const name of files) {
      const file = join(dir, name);
      try {
        const raw = await readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list.push(...parsed); else list.push(parsed);
      } catch { /* 写了一半的文件，跳过 */ }
      try { await unlink(file); } catch { /* 已经被删 */ }
    }
    if (list.length === 0) return;
    const cfg = this.#cfgAll();
    const done = [];
    for (const cmd of list) {
      try { done.push(await this.#applyCommand(cmd, cfg)); }
      catch (err) { done.push({ ok: false, text: msg(err) }); }
    }
    this.#state.lastMessage = done.map((d) => d.text).join('；');
    await this.#save().catch(() => {});
    for (const d of done) if (d.ok) this.#host?.log?.info?.('自定义农场：' + d.text);
  }

  async #applyCommand(cmd, cfg) {
    const kind = String(cmd?.cmd ?? '');
    if (kind === 'sell') {
      const r = sell(this.#state, cfg, cmd.item, cmd.count);
      return { ok: true, text: '卖了 ' + r.count + ' 个' + (r.name ?? r.item) + '，+' + r.coins + ' 金币（余 ' + Math.floor(this.#state.coins) + '）' };
    }
    if (kind === 'buy') {
      const r = buy(this.#state, cmd.id, cmd.count);
      const boughtName = r.item?.name ?? r.seed?.name ?? r.spec?.name ?? String(cmd.id ?? '道具');
      return { ok: true, text: '买了' + boughtName + '×' + (r.count ?? 1) + '（-' + r.price + ' 金币），背包 ' + (r.left ?? 0) };
    }
    if (kind === 'placePending') {
      const uid = Number(cmd.uid);
      this.#state.pendingPlace = Number.isFinite(uid) ? uid : null;
      return { ok: true, text: this.#state.pendingPlace ? '点桌面上的草地放下家具' : '取消放置' };
    }
    if (kind === 'place') {
      const r = placeFurniture(this.#state, cmd.uid, cmd.x);
      return { ok: true, text: r.placed ? '把家具放到了 ' + Math.round(r.x * 100) + '%' : '家具收起来了' };
    }
    if (kind === 'placeItem') {
      const item = live.items?.[String(cmd.item ?? '')];
      if (!item || item.kind !== 'decor') throw new Error('不是装饰道具：' + String(cmd.item ?? ''));
      if (!item.sprite) throw new Error(item.name + ' 还没有摆放贴图。');
      const x = cmd.x === undefined || cmd.x === null ? 0.5 : Number(cmd.x);
      const r = placeDecoration(this.#state, item, x);
      return {
        ok: true,
        text: '把' + r.name + '放到了 ' + Math.round(r.x * 100) + '%' +
          (r.cleared ? '，清掉了 ' + r.cleared + ' 丛杂草' : ''),
      };
    }
    return { ok: false, text: '不认识的命令：' + kind };
  }

  // ------------------------------------------------------------------ 生命周期
  async start(host) {
    if (this.#started) return;
    this.#host = host;
    try {
      this.#catalog = this.#createCatalog();
      try {
        this.#catalog.load();
      } catch (err) {
        host?.log?.warn?.('自定义农场：自定义目录读不出来，先用默认作物/杂草', { err: msg(err) });
      }
      this.#state = await this.#loadOrInit();
      this.#pruneRemovedCrops();
      this.#state.current = null;
      this.#state.standingAt = null;
      // 老存档的 drySince 是按"游戏分钟"存的，换成按"累计游戏日"之后要清一次，免得永远不枯萎
      if (!Number.isFinite(this.#state.elapsedDays) || this.#state.elapsedDays === 0) {
        this.#state.elapsedDays = 0;
        for (const plot of this.#state.plots) plot.drySince = null;
      }
      const cfg = this.#cfgAll();
      this.#applyWeather(cfg, this.now());
      // 启动阶段的任何异常都不能往外抛：World 起不来会连带整个 App 起不来（桌宠一起消失）。
      try {
        // 历史数据里可能混着'花'或没有 type/kind，统一成当前杂草目录
        normalizeWeeds(this.#state);
        const size = applyFarmSize(this.#state, cfg, () => Math.random());
        if (size.changed) {
          host?.log?.info?.('自定义农场：' + (this.#state.lastMessage || '农田大小调整'), {
            from: size.oldCells, to: size.newCells, removed: size.removed, refunded: size.refunded,
            weedsRemoved: size.weedsRemoved, weedsAdded: size.weedsAdded,
          });
        }
        seedWeeds(this.#state, cfg, () => Math.random());
        const init = advance(this.#state, this.now(), cfg, () => 0);
        if (init.cappedDays > 0) {
          host?.log?.info?.('自定义农场：离线/睡眠的时间已截断', {
            skippedGameDays: init.cappedDays,
            maxStepDays: cfg.maxStepDays,
            realMinutesPerDay: cfg.realMinutesPerDay,
          });
        }
        await this.#save();
      } catch (err) {
        host?.log?.error?.('自定义农场：启动初始化失败（已忽略，继续用空田跑）', { err: msg(err) });
      }
      this.#started = true;
      this.#schedule();
      this.#cmdTimer = setInterval(() => { void this.#drainCommands(); }, 1000);
      this.#hidden = this.#flag('hideFarm');
      if (!this.#hidden) { try { this.#ensureLayers(); } catch { /* 忽略 */ } }
      // 不做周期巡检：巡检会触发"杀掉再起"，和正在启动的进程互相打断（这就是之前反复缺层的原因）
      if (typeof this.#cmdTimer?.unref === 'function') this.#cmdTimer.unref();
      const s = summary(this.#state, cfg);
      host?.log?.info?.('自定义农场已就绪', {
        day: s.day,
        clock: s.clock,
        plants: s.planted,
        bag: s.bagTotal,
        drops: s.drops,
        tickIntervalMs: this.#tickMs(),
        stateFile: this.stateFile(),
        overlayFile: this.#flag('overlayEnabled') ? this.overlayFile() : '(关闭)',
      });
    } catch (err) {
      this.#started = false;
      this.#state = null;
      this.#host = null;
      throw err;
    }
  }

  async stop() {
    if (!this.#started && !this.#timer) return;
    this.#started = false;
    if (this.#timer) {
      this.clearTimeoutImpl(this.#timer);
      this.#timer = null;
    }
    await this.#queue;
    await this.#save();
    // 桌宠 App 退出 / 禁用自定义农场时，图层也跟着退（正常退出的快路径；
    // 崩溃退出由 restart-layers.ps1 里"桌宠不在 + state.json 过期"兜底）
    await this.#stopLayers('World 停止').catch(() => {});
    this.#state = null;
    this.#host = null;
  }
}

/** 原子写：先写 .tmp 再 rename，图层那边永远读不到半截文件。 */
export async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  try {
    await rename(tmp, file);
  } catch (err) {
    try { await unlink(tmp); } catch { /* 清不掉就算了 */ }
    throw err;
  }
}

export { advance, CROPS, ROTATION, STATE_VERSION, X_MIN, X_MAX, clockText, clamp01, cropOf, isRipe, moistureFactor, overlayView, summary, water, harvest, plant, stand, collect };
