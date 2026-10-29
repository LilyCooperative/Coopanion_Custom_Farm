/**
 * 农场目录（catalog）：把用户「农场自定义」页的配置编译成运行期数据。
 *
 *   custom.json                 ← data\farm\custom.json（作物 / 杂草 / 地面选择）
 *   <Pet>\assets\sprites\*.png  ← 用户上传的贴图（作物各阶段、种子、产物、杂草、地面）
 *
 * farm.js 只认 CROPS / SEEDS / CROP_PRICES / live（catalog-state.js），不读文件；
 * 这个模块负责读写、校验、导入贴图，并在每次改动后重新 apply()。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { CROPS, ROTATION } from './crops.js';
import { live } from './catalog-state.js';
import { CROP_PRICES, SEEDS, SEED_BY_CROP, SEED_BY_ID } from './shop.js';
import { normalizeWeathers } from './weather.js';

export const CUSTOM_VERSION = 1;
const ORIGINAL_POINTS_PER_DAY = 288;
const MAX_SPRITE_BYTES = 4 * 1024 * 1024;
const MAX_STAGES = 8;
const MIN_STAGES = 2;

/** 作物总生长点都是 288 的整数倍；默认地面是 0 号草皮。 */
const DEFAULT_GROUND = 'popo20230114_gd_grass_0';

const ORIGINAL_CROPS = Object.fromEntries(Object.entries(CROPS).map(([k, v]) => [k, structuredClone(v)]));
const ORIGINAL_SEEDS = Object.fromEntries(SEEDS.map((s) => [s.crop, { ...s }]));
const ORIGINAL_PRICES = structuredClone(CROP_PRICES);

const RULE_OPS = ['<', '<=', '>', '>=', '==', '!='];

/** 默认心情/饱食度状态 id；用户改过 id 时由 dietStateIds() 解析实际值。 */
const SATIETY_ID = 'st_satiety';
const HUNGRY_ID = 'st_hungry';
const MOOD_ID = 'mood';

/**
 * 每种可吃道具默认加多少饱食度 / 心情。
 * 主食（土豆、玉米、南瓜、米饭、意面）饱食度高；水果心情高；辣椒、大蒜这类只当调味。
 */
const DEFAULT_FOOD_EFFECTS = {
  potato: { satiety: 24, mood: 2 },
  carrot: { satiety: 16, mood: 2 },
  tomato: { satiety: 14, mood: 4 },
  strawberry: { satiety: 12, mood: 7 },
  corn: { satiety: 22, mood: 3 },
  pumpkin: { satiety: 28, mood: 4 },
  beetroot: { satiety: 16, mood: 2 },
  blueberry: { satiety: 10, mood: 7 },
  bok_choy: { satiety: 14, mood: 2 },
  cauliflower: { satiety: 16, mood: 2 },
  cucumber: { satiety: 12, mood: 3 },
  eggplant: { satiety: 15, mood: 2 },
  garlic: { satiety: 6, mood: 1 },
  pineapple: { satiety: 18, mood: 8 },
  radish: { satiety: 10, mood: 2 },
  red_chili: { satiety: 5, mood: 3 },
  red_onion: { satiety: 8, mood: 1 },
  watermelon: { satiety: 24, mood: 7 },
  rice_ear: { satiety: 8, mood: 1 },
  rice: { satiety: 30, mood: 3 },
  egg: { satiety: 10, mood: 2 },
  meat: { satiety: 20, mood: 2 },
  egg_fried_rice: { satiety: 48, mood: 10 },
  item_15: { satiety: 38, mood: 8 },
  pasta: { satiety: 42, mood: 9 },
};

/** 默认状态定义（只在缺少时补，不会覆盖用户改过的同名状态）。 */
const DEFAULT_SATIETY_STATE = { id: SATIETY_ID, name: '饱食度', kind: 'number', min: 0, max: 100, initial: 100, driftPerDay: -5, unit: '' };
const DEFAULT_HUNGRY_STATE = { id: HUNGRY_ID, name: '饥饿', kind: 'flag', initialActive: false };

/** 饥饿/无聊时优先吃的道具顺序：作物在前，主食在后补满。 */
const DEFAULT_EDIBLE_ITEMS = ['tomato', 'potato', 'rice', 'pasta', 'egg_fried_rice', 'item_15', 'carrot', 'strawberry', 'corn', 'pumpkin', 'beetroot', 'bok_choy', 'cauliflower', 'cucumber', 'eggplant', 'garlic', 'pineapple', 'radish', 'red_chili', 'red_onion', 'watermelon'];

/** 内置杂草：游戏里现成的三种野草/花，每个都有逐阶段贴图。 */
const BUILTIN_WEEDS = [
  { key: 'weed', name: '野草', stages: 4, days: [0.45, 0.45, 0.45], weight: 55, prefix: 'sprite_resource_weeds', frames: 4, itemName: '', value: 0 },
  { key: 'weed_variant0', name: '野草（变种）', stages: 4, days: [0.45, 0.45, 0.45], weight: 25, prefix: 'sprite_resource_weeds_variant0', frames: 4, itemName: '', value: 0 },
  { key: 'eden_flower', name: '伊甸花', stages: 6, days: [1, 1, 1, 1, 1], weight: 8, prefix: 'sprite_seed_eden_flower', frames: 6, itemName: '', value: 0 },
];

const clamp = (n, lo, hi, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
};
const int = (n, lo, hi, fallback) => Math.round(clamp(n, lo, hi, fallback));
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const r4 = (n) => Math.round(Number(n) * 10000) / 10000;
const num = (n, fallback = 0) => (Number.isFinite(Number(n)) ? Number(n) : fallback);
const cleanSprite = (s) => {
  const v = typeof s === 'string' ? s.trim() : '';
  return v && /^[A-Za-z0-9_\-]+$/.test(v) ? v : null;
};

function clearObject(obj) {
  for (const k of Object.keys(obj)) delete obj[k];
}

/** 只接受 PNG：overlay.ps1 的 Get-ImageFile/Get-Sprite 只拼 `.png`。 */
function pngInfo(file) {
  let size = 0;
  try { size = statSync(file).size; } catch { return null; }
  if (size <= 0 || size > MAX_SPRITE_BYTES) return null;
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 2048 || height > 2048) return null;
  return { width, height, bytes: size };
}

function labelOfGrass(file) {
  const m = /^popo\d+_gd_grass_(\d+)\.png$/i.exec(file);
  if (m) return '草皮 ' + Number(m[1]);
  return basename(file, '.png');
}

export class FarmCatalog {
  /**
   * @param {{ storePath: string, spritesDir: string, pointsPerDay?: number,
   *           waterDefaults?: { dryPerDay?: number, waterGain?: number, wiltDays?: number } }} opts
   */
  constructor(opts) {
    this.storePath = opts.storePath;
    this.spritesDir = opts.spritesDir;
    this.pointsPerDay = clamp(opts.pointsPerDay, 1, 100000, 288);
    this.waterDefaults = {
      dryPerDay: clamp(opts.waterDefaults?.dryPerDay, 0, 20, 0.15),
      waterGain: clamp(opts.waterDefaults?.waterGain, 0, 5, 1),
      wiltDays: clamp(opts.waterDefaults?.wiltDays, 0.01, 1000, 2.2),
    };
    this.store = null;
    this.compiled = [];
    this.weedCompiled = [];
  }

  // ------------------------------------------------------------------ 默认值
  builtinCrops() {
    return Object.values(ORIGINAL_CROPS).map((c) => {
      const days = Math.max(0.05, c.total / ORIGINAL_POINTS_PER_DAY / Math.max(1, c.levels - 1));
      return {
        key: c.key,
        builtin: true,
        name: c.name,
        stages: c.levels,
        days: Array.from({ length: c.levels - 1 }, () => r4(days)),
        value: Number(ORIGINAL_PRICES[c.key]?.sell ?? 0),
        seedPrice: Number(ORIGINAL_SEEDS[c.key]?.buy ?? 0),
        sprites: Array.from({ length: c.levels }, () => null),
        seedSprite: 'icon_item_' + (ORIGINAL_SEEDS[c.key]?.id ?? 'seed_' + c.key),
        itemSprite: 'icon_item_' + c.key,
        enabled: true,
      };
    });
  }

  /** Grok 画的食物/食材图标。菜品 buy=0（只在合成表里出）。 */
  builtinFoodItems() {
    return [
      { id: 'rice_ear', name: '稻穗', buy: 8, sell: 2, icon: 'icon_item_rice_ear', effects: this.defaultItemEffects('rice_ear') },
      { id: 'rice', name: '大米', buy: 15, sell: 4, icon: 'icon_item_rice', effects: this.defaultItemEffects('rice') },
      { id: 'egg', name: '鸡蛋', buy: 6, sell: 2, icon: 'icon_item_egg', effects: this.defaultItemEffects('egg') },
      { id: 'meat', name: '鲜肉', buy: 22, sell: 6, icon: 'icon_item_meat', effects: this.defaultItemEffects('meat') },
      { id: 'egg_fried_rice', name: '蛋炒饭', buy: 0, sell: 35, icon: 'icon_item_egg_fried_rice', effects: this.defaultItemEffects('egg_fried_rice') },
      { id: 'item_15', name: '番茄炒蛋', buy: 0, sell: 30, icon: 'icon_item_tomato_egg', effects: this.defaultItemEffects('item_15') },
      { id: 'pasta', name: '意大利面', buy: 0, sell: 55, icon: 'icon_item_pasta', effects: this.defaultItemEffects('pasta') },
    ];
  }

  builtinFoodRecipes() {
    return [
      { id: 'recipe_rice', inputs: [{ item: 'rice_ear', count: 1 }], output: { item: 'rice', count: 1 } },
      { id: 'recipe_egg_fried_rice', inputs: [{ item: 'egg', count: 1 }, { item: 'rice', count: 1 }], output: { item: 'egg_fried_rice', count: 1 } },
      { id: 'recipe_tomato_egg', inputs: [{ item: 'egg', count: 1 }, { item: 'tomato', count: 1 }], output: { item: 'item_15', count: 1 } },
      { id: 'recipe_pasta', inputs: [{ item: 'meat', count: 1 }, { item: 'tomato', count: 1 }], output: { item: 'pasta', count: 1 } },
    ];
  }

  /** 用当前自定义状态 id 生成某道具的默认效果；状态还没建好时先写内置 id。 */
  defaultItemEffects(id) {
    const spec = DEFAULT_FOOD_EFFECTS[id];
    if (!spec) return [];
    const ids = this.dietStateIds();
    return [
      { state: ids.satietyId ?? SATIETY_ID, delta: spec.satiety },
      { state: ids.moodId ?? MOOD_ID, delta: spec.mood },
    ];
  }

  /** 找到当前存档里「饱食度 / 饥饿 / 心情」的实际 id；用户改过 id 或换过名字时也能接上。 */
  dietStateIds() {
    const states = this.store?.states ?? [];
    const satiety = states.find((s) => s.kind === 'number' && (s.id === SATIETY_ID || s.name === '饱食度'));
    const hungry = states.find((s) => s.kind === 'flag' && (s.id === HUNGRY_ID || s.name === '饥饿'));
    const mood = states.find((s) => s.kind === 'number' && (s.id === MOOD_ID || s.name === '心情'));
    return { satietyId: satiety?.id ?? null, hungryId: hungry?.id ?? null, moodId: mood?.id ?? null };
  }

  /** 默认饱食度/饥饿/条件/消耗行为；已有同名状态时只补缺的部分。 */
  ensureSatiety(force = false) {
    if (!this.store) return { satiety: null, hungry: null };
    if (this.store.seededSatiety && !force) {
      const ids = this.dietStateIds();
      return { satiety: ids.satietyId, hungry: ids.hungryId };
    }
    const states = this.store.states ?? (this.store.states = []);
    let changed = false;
    let satiety = states.find((s) => s.kind === 'number' && (s.id === SATIETY_ID || s.name === '饱食度'));
    if (!satiety) {
      satiety = this.normalizeState(DEFAULT_SATIETY_STATE, states.length);
      if (satiety) { states.push(satiety); changed = true; }
    }
    let hungry = states.find((s) => s.kind === 'flag' && (s.id === HUNGRY_ID || s.name === '饥饿'));
    if (!hungry) {
      hungry = this.normalizeState(DEFAULT_HUNGRY_STATE, states.length);
      if (hungry) { states.push(hungry); changed = true; }
    }
    if (satiety && hungry) {
      const rules = this.store.rules ?? (this.store.rules = []);
      if (!rules.some((r) => r.source === satiety.id && r.target === hungry.id)) {
        const rule = this.normalizeRule({ id: 'r_hungry', source: satiety.id, op: '<', value: 30, target: hungry.id }, rules.length, states);
        if (rule) { rules.push(rule); changed = true; }
      }
      const actions = this.store.consume ?? (this.store.consume = []);
      if (!actions.some((c) => c.trigger === hungry.id && (c.items ?? []).includes('tomato'))) {
        const action = this.normalizeConsume({ id: 'c_hungry', trigger: hungry.id, items: DEFAULT_EDIBLE_ITEMS, count: 1, effectState: satiety.id, effectDelta: 25, cooldownDays: 0.5, auto: true, enabled: true }, actions.length, states);
        if (action) { actions.push(action); changed = true; }
      }
    }
    this.store.seededSatiety = true;
    if (changed) this.persist();
    return { satiety: satiety?.id ?? null, hungry: hungry?.id ?? null };
  }

  /** 旧档的饥饿消耗行为只列了几种作物；补上米饭/意面等新食物一次。 */
  ensureEdibleItems() {
    if (!this.store || this.store.seededEdibleItems) return;
    const { hungryId } = this.dietStateIds();
    let changed = false;
    if (hungryId) {
      for (const action of this.store.consume ?? []) {
        if (action.trigger !== hungryId || !Array.isArray(action.items)) continue;
        if (action.items.includes('pasta')) continue;
        action.items = [...new Set([...action.items, ...DEFAULT_EDIBLE_ITEMS])].slice(0, 24);
        changed = true;
      }
    }
    this.store.seededEdibleItems = true;
    if (changed) this.persist();
  }

  /** 给每种作物和食物补默认的 +饱食度 / +心情；只填空效果，不覆盖用户自己配的。 */
  ensureDietEffects(force = false) {
    if (!this.store) return;
    if (this.store.seededDietEffects && !force) return;
    const { satietyId, moodId } = this.dietStateIds();
    if (!satietyId || !moodId) return;
    let changed = false;
    const list = this.store.items ?? (this.store.items = []);
    const builtinFoods = new Map(this.builtinFoodItems().map((it) => [it.id, it]));
    for (const [id, spec] of Object.entries(DEFAULT_FOOD_EFFECTS)) {
      let item = list.find((it) => it.id === id);
      if (!item) {
        const def = builtinFoods.get(id);
        const crop = this.store.crops.find((c) => c.key === id && c.enabled !== false);
        if (def) {
          item = this.normalizeItem({ ...def, kind: 'consumable', consumable: true, effects: [] }, list.length, this.store.states);
        } else if (crop) {
          item = this.normalizeItem({
            id, kind: 'crop', crop: id, name: crop.name,
            icon: crop.itemSprite ?? 'icon_item_soil', buy: 0, sell: crop.value,
            consumable: true, effects: [],
          }, list.length, this.store.states);
        }
        if (!item) continue; // 作物已被用户删掉：不强行加回来
        list.push(item);
        changed = true;
      }
      if (!Array.isArray(item.effects) || item.effects.length === 0) {
        item.effects = [
          { state: satietyId, delta: spec.satiety },
          { state: moodId, delta: spec.mood },
        ];
        changed = true;
      }
    }
    // 旧存档里被清理掉的意面补回来：道具 + 用现有食材（肉 + 番茄）合成。
    const pasta = list.find((it) => it.id === 'pasta');
    if (pasta && !pasta.icon) { pasta.icon = 'icon_item_pasta'; changed = true; }
    const recipes = this.store.recipes ?? (this.store.recipes = []);
    if (!recipes.some((r) => r.id === 'recipe_pasta')) {
      const recipe = this.normalizeRecipe(this.builtinFoodRecipes().find((r) => r.id === 'recipe_pasta'), recipes.length);
      if (recipe) { recipes.push(recipe); changed = true; }
    }
    this.store.seededDietEffects = true;
    if (changed) this.persist();
  }

  /** 老存档补一次食物/配方；只补一次。 */
  ensureFood() {
    if (!this.store || this.store.seededFood) return;
    const list = this.store.items;
    for (const def of this.builtinFoodItems()) {
      const idx = list.findIndex((it) => it.id === def.id);
      if (idx < 0) {
        const item = this.normalizeItem({ ...def, kind: 'consumable', consumable: true, effects: def.effects ?? [] }, list.length, this.store.states ?? []);
        if (item) list.push(item);
      } else if (def.id === 'item_15') {
        // 旧番茄炒蛋道具改成 Grok 图标；效果不清空，后面 ensureDietEffects 会补默认值。
        list[idx] = this.normalizeItem({
          ...list[idx], name: def.name, icon: def.icon, buy: def.buy, sell: def.sell,
          kind: 'consumable', consumable: true,
        }, idx, this.store.states ?? []) ?? list[idx];
      }
    }
    this.store.recipes = this.store.recipes.filter((r) => r.output?.item !== 'item_15');
    for (const def of this.builtinFoodRecipes()) {
      if (this.store.recipes.some((r) => r.id === def.id)) continue;
      const recipe = this.normalizeRecipe(def, this.store.recipes.length);
      if (recipe) this.store.recipes.push(recipe);
    }
    this.store.seededFood = true;
    this.persist();
  }

  /** Grok 重绘的装饰：大树、稻草人；稻草堆下架。 */
  builtinDecorItems() {
    return [
      {
        id: 'deco_tree', name: '大树', kind: 'decor', buy: 180, sell: 60,
        consumable: false, effects: [], icon: 'deco_tree', sprite: 'deco_tree', layer: 'bottom',
      },
      {
        id: 'deco_scarecrow', name: '稻草人', kind: 'decor', buy: 120, sell: 40,
        consumable: false, effects: [], icon: 'deco_scarecrow', sprite: 'deco_scarecrow', layer: 'top',
      },
      {
        id: 'deco_cabin', name: '小木屋', kind: 'decor', buy: 350, sell: 120,
        consumable: false, effects: [], icon: 'deco_cabin', sprite: 'deco_cabin', layer: 'bottom',
      },
    ];
  }

  builtinWeeds() {
    return BUILTIN_WEEDS.map((w) => ({
      key: w.key,
      builtin: true,
      name: w.name,
      stages: w.stages,
      days: [...w.days],
      weight: w.weight,
      sprites: Array.from({ length: w.stages }, () => null),
      itemName: '',
      value: 0,
      itemSprite: null,
      enabled: true,
    }));
  }

  builtinStatus() {
    return {
      water: { ...this.waterDefaults },
      fx: {
        pour: ['water_pour_1', 'water_pour_2', 'water_pour_3', 'water_pour_4'],
        burst: ['water_burst_1', 'water_burst_2', 'water_burst_3', 'water_burst_4', 'water_burst_5', 'water_burst_6'],
        pourMs: 70,
        burstMs: 80,
      },
      wither: null,
    };
  }

  defaultStore() {
    return {
      version: CUSTOM_VERSION,
      ground: { selected: DEFAULT_GROUND, custom: [] },
      crops: this.builtinCrops(),
      weeds: this.builtinWeeds(),
      status: this.builtinStatus(),
      states: [],
      rules: [],
      consume: [],
      items: this.builtinDecorItems(),
      recipes: [],
      settings: {},
      seededDecor: false,
    seededCabin: false,
    seededDecorSet: false,
    seededFreeCrops: false,
    seededFood: false,
    seededMood: false,
    seededSatiety: false,
    seededDietEffects: false,
    seededEdibleItems: false,
    };
  }

  // ------------------------------------------------------------------ 读写
  get status() {
    return this.store?.status ?? null;
  }

  get states() {
    return this.store?.states ?? [];
  }

  get rules() {
    return this.store?.rules ?? [];
  }

  get consume() {
    return this.store?.consume ?? [];
  }

  get settings() {
    return this.store?.settings ?? {};
  }

  get items() {
    return this.store?.items ?? [];
  }

  get recipes() {
    return this.store?.recipes ?? [];
  }

  load() {
    let raw = null;
    try {
      if (existsSync(this.storePath)) raw = JSON.parse(readFileSync(this.storePath, 'utf8'));
    } catch { raw = null; }
    this.store = this.normalizeStore(raw);
    this.ensureFreeCrops();
    this.ensureMood();
    this.ensureSatiety();
    this.ensureFood();
    this.ensureRiceEar();
    this.ensureRemovedFood();
    this.ensureDietEffects();
    this.ensureEdibleItems();
    this.ensureBuiltinDecor();
    this.ensureCabin();
    this.ensureDecorSet();
    this.apply();
    return this.store;
  }

  /** 默认心情状态：数值 mood + 开心/无聊两个开关 + 阈值规则 + 无聊吃东西。 */
  ensureMood() {
    if (!this.store || this.store.seededMood) return;
    const states = this.store.states ?? (this.store.states = []);
    const addState = (def) => { if (!states.some((s) => s.id === def.id)) states.push(this.normalizeState(def, states.length)); };
    addState({ id: 'mood', name: '心情', kind: 'number', min: 0, max: 100, initial: 60, driftPerDay: 0, unit: '' });
    addState({ id: 'happy', name: '开心', kind: 'flag', initialActive: false });
    addState({ id: 'bored', name: '无聊', kind: 'flag', initialActive: false });
    const rules = this.store.rules ?? (this.store.rules = []);
    const addRule = (def) => {
      if (rules.some((r) => r.id === def.id)) return;
      const r = this.normalizeRule(def, rules.length, states);
      if (r) rules.push(r);
    };
    addRule({ id: 'r_happy', source: 'mood', op: '>=', value: 70, target: 'happy' });
    addRule({ id: 'r_bored', source: 'mood', op: '<', value: 30, target: 'bored' });
    const actions = this.store.consume ?? (this.store.consume = []);
    if (!actions.some((c) => c.id === 'c_bored_eat')) {
      const items = ['tomato', 'egg_fried_rice', 'rice', 'pasta', 'egg', 'carrot', 'potato', 'strawberry', 'corn', 'pumpkin', 'beetroot', 'bok_choy', 'cauliflower', 'cucumber', 'eggplant', 'garlic', 'pineapple', 'radish', 'red_chili', 'red_onion', 'watermelon'];
      const action = this.normalizeConsume({ id: 'c_bored_eat', trigger: 'bored', items, count: 1, effectState: 'mood', effectDelta: 8, cooldownDays: 0.15, auto: true, enabled: true }, actions.length, states);
      if (action) actions.push(action);
    }
    this.store.seededMood = true;
    this.persist();
  }

  /** 旧存档切到免费素材作物集：补全新作物，删掉没有替代的小麦/卷心菜/葡萄。只迁移一次，之后保留用户改动。 */
  ensureFreeCrops() {
    if (!this.store) return;
    const removed = new Set(['wheat', 'chinese_cabbage', 'grape']);
    const filterConsume = () => {
      let changed = false;
      for (const action of this.store.consume ?? []) {
        const before = (action.items ?? []).length;
        action.items = (action.items ?? []).filter((id) => !removed.has(id) && !removed.has(String(id).replace(/^seed_/, '')));
        if ((action.items ?? []).length !== before) changed = true;
      }
      return changed;
    };
    if (this.store.seededFreeCrops) {
      const before = this.store.crops.length;
      this.store.crops = this.store.crops.filter((c) => !removed.has(c.key));
      if (filterConsume() || this.store.crops.length !== before) this.persist();
      return;
    }
    const defs = new Map(this.builtinCrops().map((c) => [c.key, c]));
    const order = Object.keys(CROPS);
    // 旧档没有 builtin 标记，但 wheat/chinese_cabbage/grape 一定是旧内置作物；删掉。
    const custom = this.store.crops.filter((c) => !c.builtin && !removed.has(c.key));
    this.store.crops = order.map((key) => defs.get(key)).filter(Boolean).concat(custom);
    filterConsume();
    this.store.seededFreeCrops = true;
    this.persist();
  }

  /** 小麦/面粉没有免费图标，整条链下架；意面改用肉 + 番茄的配方保留。 */
  /** 稻穗容易被误删；它是稻米链的入口，始终保留一个默认道具。 */
  ensureRiceEar() {
    if (!this.store) return;
    const list = this.store.items ?? [];
    if (list.some((it) => it.id === 'rice_ear')) return;
    const def = this.builtinFoodItems().find((it) => it.id === 'rice_ear');
    if (!def) return;
    const item = this.normalizeItem({ ...def, kind: 'consumable', consumable: true, effects: def.effects ?? [] }, list.length, this.store.states ?? []);
    if (item) {
      list.push(item);
      if (!(this.store.recipes ?? []).some((r) => r.id === 'recipe_rice')) {
        const recipe = this.normalizeRecipe(this.builtinFoodRecipes().find((r) => r.id === 'recipe_rice'), this.store.recipes.length);
        if (recipe) this.store.recipes.push(recipe);
      }
      this.persist();
    }
  }

  ensureRemovedFood() {
    if (!this.store) return;
    const removed = new Set(['wheat', 'flour', 'recipe_flour']);
    const beforeItems = this.store.items?.length ?? 0;
    const beforeRecipes = this.store.recipes?.length ?? 0;
    this.store.items = (this.store.items ?? []).filter((it) => !removed.has(it.id));
    this.store.recipes = (this.store.recipes ?? []).filter((r) =>
      !removed.has(r.id) &&
      !removed.has(r.output?.item) &&
      !(r.inputs ?? []).some((x) => removed.has(x.item)));
    if ((this.store.items?.length ?? 0) !== beforeItems || (this.store.recipes?.length ?? 0) !== beforeRecipes) this.persist();
  }
  /** 小木屋是后加的内置装饰；只在迁移时补一次，用户删掉后不再回来。 */
  ensureCabin() {
    if (!this.store || this.store.seededCabin) return;
    const list = this.store.items ?? (this.store.items = []);
    if (!list.some((it) => it.id === 'deco_cabin')) {
      const def = this.builtinDecorItems().find((it) => it.id === 'deco_cabin');
      if (def) {
        const item = this.normalizeItem(def, list.length, this.store.states ?? []);
        if (item) list.push(item);
      }
    }
    this.store.seededCabin = true;
    this.persist();
  }

  ensureDecorSet() {
    if (!this.store || this.store.seededDecorSet) return;
    this.store.items = (this.store.items ?? []).filter((it) => it.id !== 'deco_haystack');
    this.store.seededDecorSet = true;
    this.persist();
  }
  /** 老存档补一次内置装饰；只补一次，之后用户删了也不会自动回来。 */
  ensureBuiltinDecor() {
    if (!this.store || this.store.seededDecor) return;
    const list = this.store.items;
    for (const def of this.builtinDecorItems()) {
      if (list.some((it) => it.id === def.id)) continue;
      const item = this.normalizeItem(def, list.length, this.store.states ?? []);
      if (item) list.push(item);
    }
    this.store.seededDecor = true;
    this.persist();
  }

  normalizeStore(raw) {
    const def = this.defaultStore();
    if (!raw || typeof raw !== 'object') return def;
    const cropList = Array.isArray(raw.crops) && raw.crops.length ? raw.crops : def.crops;
    const weedList = Array.isArray(raw.weeds) && raw.weeds.length ? raw.weeds : def.weeds;
    const stateList = (Array.isArray(raw.states) ? raw.states : [])
      .map((s, i) => this.normalizeState(s, i))
      .filter(Boolean);
    const seenState = new Set();
    const states = stateList.filter((s) => {
      if (seenState.has(s.id)) return false;
      seenState.add(s.id);
      return true;
    });
    const seenRule = new Set();
    const rules = (Array.isArray(raw.rules) ? raw.rules : [])
      .map((r, i) => this.normalizeRule(r, i, states))
      .filter((r) => {
        if (!r || seenRule.has(r.id)) return false;
        seenRule.add(r.id);
        return true;
      });
    const seenConsume = new Set();
    const consume = (Array.isArray(raw.consume) ? raw.consume : [])
      .map((c, i) => this.normalizeConsume(c, i, states))
      .filter((c) => {
        if (!c || seenConsume.has(c.id)) return false;
        seenConsume.add(c.id);
        return true;
      });
    const seenItem = new Set();
    const items = (Array.isArray(raw.items) ? raw.items : [])
      .map((it, i) => this.normalizeItem(it, i, states))
      .filter((it) => {
        if (!it || seenItem.has(it.id)) return false;
        seenItem.add(it.id);
        return true;
      });
    const seenRecipe = new Set();
    const recipes = (Array.isArray(raw.recipes) ? raw.recipes : [])
      .map((r, i) => this.normalizeRecipe(r, i))
      .filter((r) => {
        if (!r || seenRecipe.has(r.id)) return false;
        seenRecipe.add(r.id);
        return true;
      });
    const customGround = (Array.isArray(raw.ground?.custom) ? raw.ground.custom : [])
      .map((g) => {
        const sprite = cleanSprite(g?.sprite);
        if (!sprite) return null;
        return {
          id: String(g.id ?? sprite), name: String(g.name ?? sprite),
          sprite, width: int(g.width, 1, 2048, 16), height: int(g.height, 1, 2048, 16),
        };
      })
      .filter(Boolean);
    return {
      version: CUSTOM_VERSION,
      ground: {
        selected: String(raw.ground?.selected ?? DEFAULT_GROUND),
        custom: customGround,
      },
      crops: cropList.map((c, i) => this.normalizeCrop(c, i)).filter(Boolean),
      weeds: weedList.map((w, i) => this.normalizeWeed(w, i)).filter(Boolean),
      status: this.normalizeStatus(raw.status, def.status),
      states,
      rules,
      consume,
      items,
      recipes,
      settings: this.normalizeSettings(raw.settings),
      seededDecor: Boolean(raw.seededDecor),
    seededCabin: Boolean(raw.seededCabin),
    seededDecorSet: Boolean(raw.seededDecorSet),
    seededFreeCrops: Boolean(raw.seededFreeCrops),
    seededFood: Boolean(raw.seededFood),
    seededMood: Boolean(raw.seededMood),
    seededSatiety: Boolean(raw.seededSatiety),
    seededDietEffects: Boolean(raw.seededDietEffects),
    seededEdibleItems: Boolean(raw.seededEdibleItems),
    };
  }

  normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const specs = {
      farmCells: { type: 'int', min: 12, max: 48 },
      maxPlants: { type: 'int', min: 1, max: 24 },
      cropGapScale: { type: 'num', min: 0.5, max: 1.2 },
      cropGapPct: { type: 'num', min: 0, max: 10 },
      cropScale: { type: 'num', min: 0.3, max: 2.5 },
      dropScale: { type: 'num', min: 0.3, max: 3 },
      groundHeight: { type: 'int', min: 2, max: 40 },
    stripHeight: { type: 'int', min: 120, max: 800 },
      moodIntervalMin: { type: 'int', min: 1, max: 1440 },
      startWeeds: { type: 'int', min: 0, max: 60 },
      maxWeeds: { type: 'int', min: 0, max: 60 },
      weedPerDay: { type: 'num', min: 0, max: 2 },
      weedClearRadius: { type: 'num', min: 0, max: 0.2 },
      realMinutesPerDay: { type: 'num', min: 0.5, max: 1440 },
      maxStepDays: { type: 'num', min: 0.01, max: 1000 },
      tickIntervalMs: { type: 'int', min: 1000, max: 3600000 },
      dailyEvent: { type: 'bool' },
    };
    const out = {};
    for (const [key, spec] of Object.entries(specs)) {
      if (src[key] === undefined || src[key] === null) continue;
      if (spec.type === 'bool') out[key] = Boolean(src[key]);
      else out[key] = spec.type === 'int'
        ? int(src[key], spec.min, spec.max, spec.min)
        : r2(clamp(src[key], spec.min, spec.max, spec.min));
    }
    if (Array.isArray(src.weathers)) out.weathers = normalizeWeathers(src.weathers);
    return out;
  }

  saveSettings(input) {
    if (!input || typeof input !== 'object') throw new Error('设置参数不对。');
    this.store.settings = { ...this.store.settings, ...this.normalizeSettings(input) };
    this.persist();
    this.apply();
    return this.store.settings;
  }

  normalizeState(src, index) {
    if (!src || typeof src !== 'object') return null;
    const id = (String(src.id ?? '').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 32)) || ('st_' + (index + 1));
    const name = String(src.name ?? '').trim().slice(0, 24) || ('状态' + (index + 1));
    if (src.kind === 'flag') {
      return { id, name, kind: 'flag', initialActive: Boolean(src.initialActive) };
    }
    let min = clamp(src.min, -1000000, 1000000, 0);
    let max = clamp(src.max, -1000000, 1000000, 100);
    if (!(max > min)) max = min + 1;
    return {
      id,
      name,
      kind: 'number',
      min: r2(min),
      max: r2(max),
      initial: r2(clamp(src.initial, min, max, max)),
      driftPerDay: r2(clamp(src.driftPerDay, -1000, 1000, 0)),
      unit: String(src.unit ?? '').slice(0, 8),
    };
  }

  normalizeRule(src, index, states) {
    if (!src || typeof src !== 'object') return null;
    const source = String(src.source ?? '');
    const target = String(src.target ?? '');
    const sourceDef = states.find((s) => s.id === source);
    const targetDef = states.find((s) => s.id === target);
    if (!sourceDef || sourceDef.kind !== 'number') return null;
    if (!targetDef || targetDef.kind !== 'flag' || source === target) return null;
    const id = (String(src.id ?? '').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 32)) || ('r_' + (index + 1));
    return {
      id,
      source,
      op: RULE_OPS.includes(String(src.op)) ? String(src.op) : '<',
      value: r2(clamp(src.value, -1000000, 1000000, 0)),
      target,
    };
  }

  normalizeConsume(src, index, states) {
    if (!src || typeof src !== 'object') return null;
    const trigger = String(src.trigger ?? '');
    const triggerDef = states.find((s) => s.id === trigger);
    if (!triggerDef) return null;
    const items = [...new Set((Array.isArray(src.items) ? src.items : [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean))].slice(0, 24);
    if (!items.length) return null;
    const effectDef = src.effectState
      ? states.find((s) => s.id === String(src.effectState) && s.kind === 'number')
      : null;
    const id = (String(src.id ?? '').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 32)) || ('c_' + (index + 1));
    return {
      id,
      trigger,
      items,
      count: int(src.count, 1, 99, 1),
      effectState: effectDef?.id ?? null,
      effectDelta: r2(clamp(src.effectDelta, -1000, 1000, 0)),
      cooldownDays: r2(clamp(src.cooldownDays, 0.05, 30, 0.5)),
      auto: src.auto !== false,
      enabled: src.enabled !== false,
    };
  }

  normalizeItem(src, index, states) {
    if (!src || typeof src !== 'object') return null;
    const kinds = ['seed', 'crop', 'consumable', 'decor'];
    const kind = kinds.includes(src.kind) ? src.kind : 'consumable';
    const id = (String(src.id ?? '').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 40)) || ('item_' + (index + 1));
    const name = String(src.name ?? '').trim().slice(0, 24) || id;
    const effects = (Array.isArray(src.effects) ? src.effects : [])
      .map((e) => ({
        state: String(e?.state ?? ''),
        delta: r2(clamp(e?.delta, -1000, 1000, 0)),
      }))
      .filter((e) => states.some((s) => s.id === e.state && s.kind === 'number'))
      .slice(0, 4);
    return {
      id,
      kind,
      crop: src.crop ? String(src.crop) : null,
      name,
      icon: cleanSprite(src.icon) ?? null,
      sprite: kind === 'decor' ? (cleanSprite(src.sprite) ?? null) : null,
      buy: int(src.buy, 0, 1000000, 0),
      sell: int(src.sell, 0, 1000000, 0),
      consumable: kind === 'consumable' ? true : (kind === 'crop' ? src.consumable !== false : false),
      effects: kind === 'seed' || kind === 'decor' ? [] : effects,
      layer: kind === 'decor' ? (src.layer === 'top' ? 'top' : 'bottom') : null,
      scale: kind === 'decor' ? r2(clamp(Number(src.scale), 0.3, 3, 1)) : null,
    };
  }

  normalizeRecipe(src, index) {
    if (!src || typeof src !== 'object') return null;
    const inputs = (Array.isArray(src.inputs) ? src.inputs : [])
      .map((row) => ({
        item: String(row?.item ?? '').trim(),
        count: int(row?.count, 1, 99, 1),
      }))
      .filter((row) => row.item)
      .slice(0, 4);
    if (!inputs.length || !src.output?.item) return null;
    const id = (String(src.id ?? '').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 32)) || ('recipe_' + (index + 1));
    return {
      id,
      inputs,
      output: { item: String(src.output.item), count: int(src.output.count, 1, 99, 1) },
    };
  }

  normalizeStatus(raw, def) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const water = source.water && typeof source.water === 'object' ? source.water : {};
    const fx = source.fx && typeof source.fx === 'object' ? source.fx : {};
    const frames = (value, fallback) => {
      if (!Array.isArray(value)) return [...fallback];
      return value.map((name) => cleanSprite(name)).filter(Boolean).slice(0, 32);
    };
    return {
      water: {
        dryPerDay: r2(clamp(water.dryPerDay, 0, 20, def.water.dryPerDay)),
        waterGain: r2(clamp(water.waterGain, 0, 5, def.water.waterGain)),
        wiltDays: r2(clamp(water.wiltDays, 0.01, 1000, def.water.wiltDays)),
      },
      fx: {
        pour: frames(fx.pour, def.fx.pour),
        burst: frames(fx.burst, def.fx.burst),
        pourMs: int(fx.pourMs, 10, 2000, def.fx.pourMs),
        burstMs: int(fx.burstMs, 10, 2000, def.fx.burstMs),
      },
      wither: cleanSprite(source.wither) ?? null,
    };
  }

  normalizeCrop(src, index) {
    if (!src || typeof src !== 'object') return null;
    const key = String(src.key ?? '').trim() || 'custom_crop_' + (index + 1);
    const builtin = Boolean(src.builtin) && Boolean(ORIGINAL_CROPS[key]);
    const stages = int(src.stages, MIN_STAGES, MAX_STAGES, builtin ? ORIGINAL_CROPS[key].levels : 4);
    const oldDays = Array.isArray(src.days) ? src.days : [];
    const days = Array.from({ length: stages - 1 }, (_, i) => r4(clamp(oldDays[i], 0.05, 365, 1)));
    const sprites = Array.from({ length: stages }, (_, i) => cleanSprite(Array.isArray(src.sprites) ? src.sprites[i] : null));
    return {
      key,
      builtin,
      name: String(src.name ?? (builtin ? ORIGINAL_CROPS[key].name : key)).trim().slice(0, 24) || key,
      stages,
      days,
      value: int(src.value, 0, 1000000, Number(ORIGINAL_PRICES[key]?.sell ?? 10)),
      seedPrice: int(src.seedPrice, 0, 1000000, Number(ORIGINAL_SEEDS[key]?.buy ?? 10)),
      sprites,
      seedSprite: cleanSprite(src.seedSprite) ?? (builtin ? 'icon_item_seed_' + key : null),
      itemSprite: cleanSprite(src.itemSprite) ?? (builtin ? 'icon_item_' + key : null),
      layer: src.layer === 'top' ? 'top' : 'bottom',
      enabled: src.enabled !== false,
    };
  }

  normalizeWeed(src, index) {
    if (!src || typeof src !== 'object') return null;
    const key = String(src.key ?? '').trim() || 'custom_weed_' + (index + 1);
    const builtinDef = BUILTIN_WEEDS.find((w) => w.key === key);
    const builtin = Boolean(src.builtin) && Boolean(builtinDef);
    const def = builtin ? builtinDef : null;
    const stages = int(src.stages, MIN_STAGES, MAX_STAGES, def?.stages ?? 3);
    const oldDays = Array.isArray(src.days) ? src.days : [];
    const days = Array.from({ length: stages - 1 }, (_, i) => r4(clamp(oldDays[i], 0.05, 365, def?.days?.[i] ?? 0.45)));
    const weight = int(src.weight, 0, 100, def?.weight ?? 10);
    return {
      key,
      builtin,
      name: String(src.name ?? (def?.name ?? key)).trim().slice(0, 24) || key,
      stages,
      days,
      weight,
      sprites: Array.from({ length: stages }, (_, i) => cleanSprite(Array.isArray(src.sprites) ? src.sprites[i] : null)),
      itemName: String(src.itemName ?? '').trim().slice(0, 24),
      value: int(src.value, 0, 1000000, 0),
      itemSprite: cleanSprite(src.itemSprite),
      layer: src.layer === 'bottom' ? 'bottom' : 'top',
      enabled: src.enabled !== false && weight > 0,
    };
  }

  persist() {
    mkdirSync(join(this.storePath, '..'), { recursive: true });
    const tmp = this.storePath + '.tmp-' + process.pid;
    writeFileSync(tmp, JSON.stringify(this.store, null, 2), 'utf8');
    renameSync(tmp, this.storePath);
  }

  // ------------------------------------------------------------------ 编译
  setPointsPerDay(points) {
    const next = clamp(points, 1, 100000, this.pointsPerDay);
    if (next === this.pointsPerDay) return false;
    this.pointsPerDay = next;
    this.apply();
    return true;
  }

  apply() {
    if (!this.store) this.store = this.defaultStore();
    const crops = this.store.crops.map((c) => this.compileCrop(c));
    const weeds = this.store.weeds.map((w) => this.compileWeed(w));
    const items = this.syncItems(crops, weeds);

    // CROPS / ROTATION
    clearObject(CROPS);
    for (const c of crops) CROPS[c.key] = c;
    ROTATION.splice(0, ROTATION.length, ...crops.filter((c) => c.enabled).map((c) => c.key));

    // 种子（价格/买卖来自道具表）
    const seedItems = items.filter((it) => it.kind === 'seed' && it.crop);
    SEEDS.splice(0, SEEDS.length, ...seedItems.map((it) => ({
      crop: it.crop,
      id: it.id,
      buy: it.buy,
      sell: it.sell,
      name: it.name,
    })));
    clearObject(SEED_BY_CROP);
    clearObject(SEED_BY_ID);
    for (const s of SEEDS) {
      SEED_BY_CROP[s.crop] = s;
      SEED_BY_ID[s.id] = s;
    }

    // 价格（所有有出售价的物品）
    clearObject(CROP_PRICES);
    for (const it of items) {
      if (it.sell > 0) CROP_PRICES[it.id] = { sell: it.sell, buy: it.buy, name: it.name };
    }

    // live
    live.crops = Object.fromEntries(crops.map((c) => [c.key, c]));
    live.weeds = Object.fromEntries(weeds.map((w) => [w.key, w]));
    live.weedTypes = weeds.filter((w) => w.enabled && w.weight > 0);
    live.ground.builtin = this.scanGrounds();
    live.ground.custom = this.store.ground.custom;
    const groundIds = new Set([...live.ground.builtin.map((g) => g.id), ...live.ground.custom.map((g) => g.id)]);
    if (!groundIds.has(this.store.ground.selected)) {
      this.store.ground.selected = live.ground.builtin.find((g) => g.id === DEFAULT_GROUND)?.id ?? live.ground.builtin[0]?.id ?? null;
    }
    live.ground.selected = this.store.ground.selected;
    const selectedGround = live.ground.builtin.find((g) => g.id === live.ground.selected)
      ?? live.ground.custom.find((g) => g.id === live.ground.selected);
    live.ground.tile = selectedGround?.sprite ?? null;
    live.items = Object.fromEntries(items.map((it) => [it.id, it]));
    live.decorations = items.filter((it) => it.kind === 'decor');
    live.consumables = items.filter((it) => it.consumable);
    live.itemIcons = {};
    live.names = {};
    for (const it of items) {
      live.itemIcons[it.id] = it.icon ?? 'icon_item_soil';
      live.names[it.id] = it.name;
    }
    live.status = {
      water: { ...this.store.status.water },
      fx: {
        pour: [...this.store.status.fx.pour],
        burst: [...this.store.status.fx.burst],
        pourMs: this.store.status.fx.pourMs,
        burstMs: this.store.status.fx.burstMs,
      },
      wither: this.store.status.wither,
    };
    this.compiled = crops;
    this.weedCompiled = weeds;
    return crops;
  }

  /**
   * 道具表与作物/杂草同步：
   *  - 每种作物自动有 seed_<key> 和 <key> 两个道具；
   *  - 杂草收获物自动进农作物道具（kind=crop，crop=null）；
   *  - 自定义消耗品/装饰道具原样保留。
   * 价格/效果/图标沿用旧值，名称/来源跟作物走。
   */
  syncItems(crops, weeds) {
    const old = new Map((Array.isArray(this.store.items) ? this.store.items : []).map((it) => [it.id, it]));
    const list = [];
    const push = (src) => {
      const item = this.normalizeItem(src, list.length, this.store.states);
      if (item) list.push(item);
    };
    for (const crop of crops) {
      const seedOld = old.get('seed_' + crop.key) ?? {};
      push({
        ...seedOld,
        id: 'seed_' + crop.key,
        kind: 'seed',
        crop: crop.key,
        name: crop.name + '种子',
        icon: crop.seedSprite ?? seedOld.icon ?? 'icon_item_soil',
        buy: seedOld.buy ?? crop.seedPrice,
        sell: seedOld.sell ?? crop.seedSell,
        consumable: false,
        effects: [],
      });
      const cropOld = old.get(crop.key) ?? {};
      push({
        ...cropOld,
        id: crop.key,
        kind: 'crop',
        crop: crop.key,
        name: crop.name,
        icon: crop.itemSprite ?? cropOld.icon ?? 'icon_item_soil',
        buy: cropOld.buy ?? 0,
        sell: cropOld.sell ?? crop.value,
        consumable: cropOld.consumable !== false,
        effects: cropOld.effects ?? [],
      });
    }
    for (const weed of weeds) {
      if (!weed.item) continue;
      const weedOld = old.get(weed.item) ?? {};
      push({
        ...weedOld,
        id: weed.item,
        kind: 'crop',
        crop: null,
        name: weedOld.name ?? (weed.itemName || weed.name),
        icon: weed.itemSprite ?? weedOld.icon ?? 'icon_item_soil',
        buy: weedOld.buy ?? 0,
        sell: weedOld.sell ?? weed.value,
        consumable: weedOld.consumable !== false,
        effects: weedOld.effects ?? [],
      });
    }
    for (const item of old.values()) {
      if (item.kind === 'seed' || item.kind === 'crop') continue;
      push(item);
    }
    const seen = new Set();
    const out = [];
    for (const item of list) {
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    this.store.items = out;
    return out;
  }

  compileCrop(c) {
    const stages = c.stages;
    const days = [...c.days];
    const thresholds = [];
    let acc = 0;
    for (const d of days) {
      acc += d * this.pointsPerDay;
      thresholds.push(Math.max(1, Math.round(acc)));
    }
    const total = thresholds[thresholds.length - 1] || 1;
    thresholds[thresholds.length - 1] = total;
    const original = c.builtin ? ORIGINAL_CROPS[c.key] : null;
    const widths = c.sprites.map((name) => (name ? this.spriteSize(name)?.width ?? 0 : 0));
    const spriteW = widths.reduce((m, w) => Math.max(m, w), original?.spriteW ?? 24);
    const prefix = original?.prefix ?? null;
    const frames = original?.frames ?? stages;
    const spriteNames = Array.from({ length: stages }, (_, i) => (
      c.sprites[i] ?? (prefix ? prefix + '_' + Math.min(i, Math.max(0, frames - 1)) : (c.itemSprite ?? c.seedSprite ?? 'icon_item_soil'))
    ));
    return {
      key: c.key,
      name: c.name,
      builtin: c.builtin,
      stages,
      levels: stages,
      days,
      thresholds,
      total,
      value: c.value,
      seedPrice: c.seedPrice,
      seedSell: c.seedPrice <= 0 ? 0 : Math.max(1, Math.round(c.seedPrice / 5)),
      sprites: c.sprites,
      spriteNames,
      seedSprite: c.seedSprite,
      itemSprite: c.itemSprite,
      prefix,
      frames,
      spriteW,
      layer: c.layer === 'top' ? 'top' : 'bottom',
      lifespan: original?.lifespan ?? 1,
      repeatLevel: original?.repeatLevel ?? 0,
      minCount: original?.minCount ?? 1,
      maxCount: original?.maxCount ?? original?.minCount ?? 1,
      items: [c.key],
      swing: original?.swing ?? true,
      enabled: c.enabled !== false,
    };
  }

  compileWeed(w) {
    const thresholds = [];
    let acc = 0;
    for (const d of w.days) {
      acc += d;
      thresholds.push(r2(acc));
    }
    const def = BUILTIN_WEEDS.find((x) => x.key === w.key);
    const prefix = def?.prefix ?? null;
    const frames = def?.frames ?? w.stages;
    const spriteNames = Array.from({ length: w.stages }, (_, i) => (
      w.sprites[i] ?? (prefix ? prefix + '_' + Math.min(i, Math.max(0, frames - 1)) : (w.itemSprite ?? 'icon_item_soil'))
    ));
    return {
      key: w.key,
      name: w.name,
      builtin: w.builtin,
      stages: w.stages,
      days: [...w.days],
      thresholds,
      weight: w.weight,
      sprites: w.sprites,
      spriteNames,
      prefix,
      frames,
      item: w.value > 0 && w.itemName ? 'weed_' + w.key : null,
      itemName: w.itemName,
      value: w.value,
      itemSprite: w.itemSprite,
      layer: w.layer === 'bottom' ? 'bottom' : 'top',
      enabled: w.enabled && w.weight > 0,
    };
  }

  // ------------------------------------------------------------------ 贴图
  scanGrounds() {
    let files = [];
    try { files = readdirSync(this.spritesDir); } catch { files = []; }
    const out = [];
    if (files.includes('resource_grass.png')) out.push({ id: 'resource_grass', name: '草地（原始）', sprite: 'resource_grass' });
    const grass = files
      .filter((f) => /^popo\d+_gd_grass_\d+\.png$/i.test(f))
      .sort((a, b) => Number(/(\d+)\.png$/i.exec(a)?.[1] ?? 0) - Number(/(\d+)\.png$/i.exec(b)?.[1] ?? 0));
    for (const f of grass) {
      const id = f.replace(/\.png$/i, '');
      out.push({ id, name: labelOfGrass(f), sprite: id });
    }
    return out;
  }

  spriteSize(name) {
    const f = this.spriteFile(name);
    return f ? pngInfo(f) : null;
  }

  spriteFile(name) {
    const sprite = cleanSprite(name);
    if (!sprite) return null;
    const file = join(this.spritesDir, sprite + '.png');
    return existsSync(file) ? file : null;
  }

  /** 读 PNG 交给 invokeBinary（{ $binary } 由 World 包）。 */
  spriteBase64(name) {
    const file = this.spriteFile(name);
    if (!file) throw new Error('找不到贴图：' + name);
    return { mime: 'image/png', base64: readFileSync(file).toString('base64') };
  }

  copySprite(srcPath, kind, key, slot) {
    if (!srcPath || !existsSync(srcPath)) throw new Error('找不到文件：' + srcPath);
    if (!/\.png$/i.test(srcPath)) throw new Error('只支持 PNG 贴图（overlay 只认 .png）。');
    const info = pngInfo(srcPath);
    if (!info) throw new Error('这个 PNG 读不出来，或者超过 2048×2048 / 4MB。');
    const safe = String(key ?? 'x').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 32);
    const name = 'cust_' + String(kind).replace(/[^A-Za-z0-9_\-]/g, '_') + '_' + safe + '_' + String(slot ?? 0) + '_' + Date.now().toString(36);
    mkdirSync(this.spritesDir, { recursive: true });
    copyFileSync(srcPath, join(this.spritesDir, name + '.png'));
    return { sprite: name, width: info.width, height: info.height };
  }

  importSprite(kind, key, slot, srcPath) {
    return this.copySprite(srcPath, kind, key, slot);
  }

  cropSpriteName(crop, level) {
    const i = clamp(level, 0, crop.stages - 1, 0);
    const custom = crop.sprites?.[i];
    if (custom) return custom;
    if (crop.prefix) return crop.prefix + '_' + Math.min(i, Math.max(0, crop.frames - 1));
    return crop.itemSprite ?? crop.seedSprite ?? 'icon_item_soil';
  }

  weedSpriteName(weed) {
    const def = live.weeds[weed?.type ?? 'weed'] ?? live.weeds['weed'];
    if (!def) return null;
    const i = clamp(weed?.level, 0, def.stages - 1, 0);
    const custom = def.sprites?.[i];
    if (custom) return custom;
    if (def.prefix) return def.prefix + '_' + Math.min(i, Math.max(0, def.frames - 1));
    return def.itemSprite ?? 'icon_item_soil';
  }

  // ------------------------------------------------------------------ 面板操作
  snapshot() {
    const groundSelected = this.store.ground.selected;
    return {
      ground: {
        selected: groundSelected,
        builtin: live.ground.builtin.map((g) => ({ ...g })),
        custom: this.store.ground.custom.map((g) => ({ ...g })),
      },
      crops: this.compiled.map((c) => ({
        key: c.key,
        builtin: c.builtin,
        name: c.name,
        stages: c.stages,
        days: [...c.days],
        totalDays: r2(c.days.reduce((a, b) => a + b, 0)),
        value: c.value,
        seedPrice: c.seedPrice,
        enabled: c.enabled,
        layer: c.layer === 'top' ? 'top' : 'bottom',
        sprites: [...(c.sprites ?? [])],
        seedSprite: c.seedSprite,
        itemSprite: c.itemSprite,
        preview: Array.from({ length: c.stages }, (_, i) => this.cropSpriteName(c, i)),
        previewSeed: c.seedSprite ?? 'icon_item_soil',
        previewItem: c.itemSprite ?? 'icon_item_soil',
      })),
      weeds: this.weedCompiled.map((w) => ({
        key: w.key,
        builtin: w.builtin,
        name: w.name,
        stages: w.stages,
        days: [...w.days],
        totalDays: r2(w.days.reduce((a, b) => a + b, 0)),
        weight: w.weight,
        enabled: w.enabled,
        sprites: [...(w.sprites ?? [])],
        itemName: w.itemName,
        value: w.value,
        itemSprite: w.itemSprite,
        layer: w.layer === 'bottom' ? 'bottom' : 'top',
        preview: Array.from({ length: w.stages }, (_, i) => this.weedSpriteName({ type: w.key, level: i })),
        previewItem: w.value > 0 ? (w.itemSprite ?? 'icon_item_soil') : null,
      })),
      totals: { crops: this.compiled.length, weeds: this.weedCompiled.length },
      status: {
        water: { ...this.store.status.water },
        fx: {
          pour: [...this.store.status.fx.pour],
          burst: [...this.store.status.fx.burst],
          pourMs: this.store.status.fx.pourMs,
          burstMs: this.store.status.fx.burstMs,
        },
        wither: this.store.status.wither,
        witherPreview: this.store.status.wither ?? 'sprite_crop_wither_universal',
        defaults: this.builtinStatus(),
      },
    };
  }

  selectGround(id) {
    const key = String(id ?? '');
    const exists = [...live.ground.builtin, ...live.ground.custom].some((g) => g.id === key);
    if (!exists) throw new Error('没有这块地面贴图：' + key);
    this.store.ground.selected = key;
    this.persist();
    this.apply();
    return this.snapshot();
  }

  addGround(srcPath, name) {
    const copied = this.copySprite(srcPath, 'ground', 'g', this.store.ground.custom.length);
    this.store.ground.custom.push({
      id: copied.sprite,
      name: String(name ?? '').trim().slice(0, 24) || ('自定义地面 ' + (this.store.ground.custom.length + 1)),
      sprite: copied.sprite,
      width: copied.width,
      height: copied.height,
    });
    this.store.ground.selected = copied.sprite;
    this.persist();
    this.apply();
    return this.snapshot();
  }

  removeGround(id) {
    const key = String(id ?? '');
    const idx = this.store.ground.custom.findIndex((g) => g.id === key);
    if (idx < 0) throw new Error('没有这块自定义地面：' + key);
    const [gone] = this.store.ground.custom.splice(idx, 1);
    try { unlinkSync(join(this.spritesDir, gone.sprite + '.png')); } catch { /* 文件不在就算了 */ }
    if (this.store.ground.selected === key) {
      this.store.ground.selected = live.ground.builtin.find((g) => g.id === DEFAULT_GROUND)?.id ?? live.ground.builtin[0]?.id ?? null;
    }
    this.persist();
    this.apply();
    return this.snapshot();
  }

  saveCrop(input) {
    if (!input || typeof input !== 'object') throw new Error('作物参数不对。');
    const list = this.store.crops;
    let idx = list.findIndex((c) => c.key === input.key);
    let existing = idx >= 0 ? list[idx] : null;
    if (!existing) {
      let n = 1;
      while (list.some((c) => c.key === 'custom_crop_' + n)) n += 1;
      existing = { key: 'custom_crop_' + n, builtin: false, name: '新作物', stages: 4, days: [1, 1, 1], value: 10, seedPrice: 10, sprites: [null, null, null, null], seedSprite: null, itemSprite: null, enabled: true };
      idx = list.length;
      list.push(existing);
    }
    const merged = this.normalizeCrop({
      ...existing,
      ...input,
      key: existing.key,
      builtin: existing.builtin,
      sprites: Array.isArray(input.sprites) ? input.sprites : existing.sprites,
      days: Array.isArray(input.days) ? input.days : existing.days,
    }, idx);
    merged.sprites = merged.sprites.map((s, i) => s ?? null);
    list[idx] = merged;
    this.persist();
    this.apply();
    return this.snapshot();
  }

  removeCrop(key) {
    const idx = this.store.crops.findIndex((c) => c.key === key);
    if (idx < 0) throw new Error('没有这种作物：' + key);
    this.removeRecipesUsing([key, 'seed_' + key]);
    this.removeCustomSprites('crop', key);
    this.store.crops.splice(idx, 1);
    this.persist();
    this.apply();
    return this.snapshot();
  }

  resetCrop(key) {
    const def = this.builtinCrops().find((c) => c.key === key);
    if (!def) throw new Error('不是内置作物，不能恢复默认：' + key);
    const idx = this.store.crops.findIndex((c) => c.key === key);
    if (idx < 0) this.store.crops.push(def); else this.store.crops[idx] = def;
    this.persist();
    this.apply();
    return this.snapshot();
  }

  saveWeed(input) {
    if (!input || typeof input !== 'object') throw new Error('杂草参数不对。');
    const list = this.store.weeds;
    let idx = list.findIndex((w) => w.key === input.key);
    let existing = idx >= 0 ? list[idx] : null;
    if (!existing) {
      let n = 1;
      while (list.some((w) => w.key === 'custom_weed_' + n)) n += 1;
      existing = { key: 'custom_weed_' + n, builtin: false, name: '新杂草', stages: 3, days: [1, 1], weight: 10, sprites: [null, null, null], itemName: '', value: 0, itemSprite: null, enabled: true };
      idx = list.length;
      list.push(existing);
    }
    const merged = this.normalizeWeed({
      ...existing,
      ...input,
      key: existing.key,
      builtin: existing.builtin,
      sprites: Array.isArray(input.sprites) ? input.sprites : existing.sprites,
      days: Array.isArray(input.days) ? input.days : existing.days,
    }, idx);
    list[idx] = merged;
    this.persist();
    this.apply();
    return this.snapshot();
  }

  removeWeed(key) {
    const idx = this.store.weeds.findIndex((w) => w.key === key);
    if (idx < 0) throw new Error('没有这种杂草：' + key);
    this.removeRecipesUsing(['weed_' + key]);
    this.removeCustomSprites('weed', key);
    this.store.weeds.splice(idx, 1);
    this.persist();
    this.apply();
    return this.snapshot();
  }

  /** 删除引用了这些道具 id 的合成表。 */
  removeRecipesUsing(ids) {
    const set = new Set(ids.map(String));
    this.store.recipes = this.store.recipes.filter((r) => (
      !r.inputs.some((row) => set.has(row.item)) && !set.has(r.output.item)
    ));
  }

  /** 只删这个道具/作物/杂草上传的 cust_* 贴图；内置共享贴图不动。 */
  removeCustomSprites(kind, key) {
    const safe = String(key ?? 'x').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 32);
    const prefix = 'cust_' + kind + '_' + safe + '_';
    let files = [];
    try { files = readdirSync(this.spritesDir); } catch { return; }
    for (const f of files) {
      if (!f.startsWith(prefix) || !f.endsWith('.png')) continue;
      try { unlinkSync(join(this.spritesDir, f)); } catch { /* 已经不在了 */ }
    }
  }

  resetWeed(key) {
    const def = this.builtinWeeds().find((w) => w.key === key);
    if (!def) throw new Error('不是内置杂草，不能恢复默认：' + key);
    const idx = this.store.weeds.findIndex((w) => w.key === key);
    if (idx < 0) this.store.weeds.push(def); else this.store.weeds[idx] = def;
    this.persist();
    this.apply();
    return this.snapshot();
  }

  saveStatus(input) {
    if (!input || typeof input !== 'object') throw new Error('状态设置参数不对。');
    this.store.status = this.normalizeStatus(input, this.builtinStatus());
    this.persist();
    this.apply();
    return this.snapshot();
  }

  /** 只把浇水特效/枯萎贴图恢复默认；浇水数值不动。 */
  resetFx() {
    const def = this.builtinStatus();
    this.store.status.fx = def.fx;
    this.store.status.wither = null;
    this.persist();
    this.apply();
    return this.snapshot();
  }

  saveState(input) {
    if (!input || typeof input !== 'object') throw new Error('状态参数不对。');
    const list = this.store.states;
    let idx = list.findIndex((s) => s.id === input.id);
    const base = idx >= 0 ? list[idx] : {};
    const normalized = this.normalizeState({ ...base, ...input, id: idx >= 0 ? base.id : undefined }, idx);
    if (!normalized) throw new Error('状态参数不对。');
    if (list.some((s, i) => i !== idx && s.name === normalized.name)) {
      throw new Error('状态名「' + normalized.name + '」已经有了。');
    }
    if (idx >= 0) {
      list[idx] = normalized;
    } else {
      let n = list.length + 1;
      while (list.some((s) => s.id === 'st_' + n)) n += 1;
      normalized.id = 'st_' + n;
      list.push(normalized);
    }
    // 状态改了类型/删了：引用它的规则重新校验一遍
    this.store.rules = this.store.rules.map((r, i) => this.normalizeRule(r, i, list)).filter(Boolean);
    this.store.consume = this.store.consume.map((c, i) => this.normalizeConsume(c, i, list)).filter(Boolean);
    this.store.items = this.store.items.map((it, i) => this.normalizeItem(it, i, list)).filter(Boolean);
    this.persist();
    this.apply();
    return normalized;
  }

  removeState(id) {
    const key = String(id ?? '');
    const idx = this.store.states.findIndex((s) => s.id === key);
    if (idx < 0) throw new Error('没有这个状态：' + key);
    this.store.states.splice(idx, 1);
    this.store.rules = this.store.rules.filter((r) => r.source !== key && r.target !== key);
    this.store.consume = this.store.consume.filter((c) => c.trigger !== key && c.effectState !== key);
    this.store.items = this.store.items.map((it, i) => this.normalizeItem(it, i, this.store.states)).filter(Boolean);
    this.persist();
    this.apply();
  }

  saveRule(input) {
    if (!input || typeof input !== 'object') throw new Error('条件参数不对。');
    const list = this.store.rules;
    let idx = list.findIndex((r) => r.id === input.id);
    const base = idx >= 0 ? list[idx] : {};
    const normalized = this.normalizeRule({ ...base, ...input, id: idx >= 0 ? base.id : undefined }, idx, this.store.states);
    if (!normalized) throw new Error('条件不对：源要选数值状态，目标要选开关状态，且不能是同一个。');
    if (idx >= 0) {
      list[idx] = normalized;
    } else {
      let n = list.length + 1;
      while (list.some((r) => r.id === 'r_' + n)) n += 1;
      normalized.id = 'r_' + n;
      list.push(normalized);
    }
    this.persist();
    this.apply();
    return normalized;
  }

  removeRule(id) {
    const key = String(id ?? '');
    const idx = this.store.rules.findIndex((r) => r.id === key);
    if (idx < 0) throw new Error('没有这条条件：' + key);
    this.store.rules.splice(idx, 1);
    this.persist();
    this.apply();
  }

  saveConsume(input) {
    if (!input || typeof input !== 'object') throw new Error('消耗行为参数不对。');
    const list = this.store.consume;
    let idx = list.findIndex((c) => c.id === input.id);
    const base = idx >= 0 ? list[idx] : {};
    const normalized = this.normalizeConsume({ ...base, ...input, id: idx >= 0 ? base.id : undefined }, idx, this.store.states);
    if (!normalized) throw new Error('消耗行为不对：触发状态要存在，且至少选一种道具。');
    if (idx >= 0) {
      list[idx] = normalized;
    } else {
      let n = list.length + 1;
      while (list.some((c) => c.id === 'c_' + n)) n += 1;
      normalized.id = 'c_' + n;
      list.push(normalized);
    }
    this.persist();
    this.apply();
    return normalized;
  }

  removeConsume(id) {
    const key = String(id ?? '');
    const idx = this.store.consume.findIndex((c) => c.id === key);
    if (idx < 0) throw new Error('没有这条消耗行为：' + key);
    this.store.consume.splice(idx, 1);
    this.persist();
    this.apply();
  }

  snapshotItems() {
    const effects = (item) => item.effects.map((e) => ({
      ...e,
      stateName: this.store.states.find((s) => s.id === e.state)?.name ?? e.state,
    }));
    const group = (kind) => this.store.items
      .filter((it) => it.kind === kind)
      .map((it) => ({
        ...it,
        effects: effects(it),
        preview: it.icon ?? 'icon_item_soil',
        spritePreview: it.sprite ?? null,
      }));
    return {
      seeds: group('seed'),
      crops: group('crop'),
      consumables: group('consumable'),
      decorations: group('decor'),
      states: this.store.states
        .filter((s) => s.kind === 'number')
        .map((s) => ({ id: s.id, name: s.name, min: s.min, max: s.max })),
    };
  }

  snapshotRecipes() {
    const itemView = (id) => ({ id, name: live.names?.[id] ?? id, icon: live.itemIcons?.[id] ?? 'icon_item_soil' });
    return {
      recipes: this.store.recipes.map((r) => ({
        ...r,
        inputs: r.inputs.map((row) => ({ ...row, ...itemView(row.item) })),
        output: { ...r.output, ...itemView(r.output.item) },
      })),
      items: Object.values(live.items ?? {}).map((it) => ({
        id: it.id, name: it.name, icon: it.icon ?? 'icon_item_soil', kind: it.kind,
      })),
    };
  }

  saveItem(input) {
    if (!input || typeof input !== 'object') throw new Error('道具参数不对。');
    const list = this.store.items;
    let idx = input.id ? list.findIndex((it) => it.id === input.id) : -1;
    if (!input.id) {
      if (!['consumable', 'decor'].includes(input.kind)) throw new Error('只能新增消耗品或装饰道具。');
      let n = list.length + 1;
      let id = (input.kind === 'decor' ? 'deco_' : 'item_') + n;
      while (list.some((it) => it.id === id)) { n += 1; id = (input.kind === 'decor' ? 'deco_' : 'item_') + n; }
      const item = this.normalizeItem({ ...input, id }, list.length, this.store.states);
      if (!item) throw new Error('道具参数不对。');
      list.push(item);
      this.persist();
      this.apply();
      return item;
    }
    if (idx < 0) throw new Error('没有这个道具：' + input.id);
    const existing = list[idx];
    const merged = existing.kind === 'seed' || existing.kind === 'crop'
      ? this.normalizeItem({
        ...existing,
        buy: input.buy ?? existing.buy,
        sell: input.sell ?? existing.sell,
        consumable: input.consumable ?? existing.consumable,
        effects: input.effects ?? existing.effects,
      }, idx, this.store.states)
      : this.normalizeItem({ ...existing, ...input, id: existing.id, kind: existing.kind }, idx, this.store.states);
    if (!merged) throw new Error('道具参数不对。');
    list[idx] = merged;
    this.persist();
    this.apply();
    return merged;
  }

  removeItem(id) {
    const key = String(id ?? '');
    const idx = this.store.items.findIndex((it) => it.id === key);
    if (idx < 0) throw new Error('没有这个道具：' + key);
    const item = this.store.items[idx];
    if (item.kind === 'seed' || item.kind === 'crop') throw new Error('种子/农作物道具是自动生成的，不能删；去农场自定义删作物。');
    this.store.items.splice(idx, 1);
    this.removeRecipesUsing([key]);
    this.removeCustomSprites('item', key);
    this.persist();
    this.apply();
  }

  saveRecipe(input) {
    if (!input || typeof input !== 'object') throw new Error('合成表参数不对。');
    const list = this.store.recipes;
    let idx = input.id ? list.findIndex((r) => r.id === input.id) : -1;
    const normalized = this.normalizeRecipe({ ...(idx >= 0 ? list[idx] : {}), ...input, id: idx >= 0 ? list[idx].id : undefined }, idx);
    if (!normalized) throw new Error('合成表不对：要 1~4 个材料和一个产物。');
    for (const row of normalized.inputs) {
      if (!live.items?.[row.item]) throw new Error('材料不存在：' + row.item);
    }
    if (!live.items?.[normalized.output.item]) throw new Error('产物不存在：' + normalized.output.item);
    if (idx >= 0) {
      list[idx] = normalized;
    } else {
      let n = list.length + 1;
      while (list.some((r) => r.id === 'recipe_' + n)) n += 1;
      normalized.id = 'recipe_' + n;
      list.push(normalized);
    }
    this.persist();
    this.apply();
    return normalized;
  }

  removeRecipe(id) {
    const key = String(id ?? '');
    const idx = this.store.recipes.findIndex((r) => r.id === key);
    if (idx < 0) throw new Error('没有这张合成表：' + key);
    this.store.recipes.splice(idx, 1);
    this.persist();
    this.apply();
  }

  /** 一键补齐示例：饱食度 0~100、每天 -5；低于 30 → 饥饿；并给所有食物补默认效果。 */
  addExample() {
    const ids = this.ensureSatiety(true);
    this.ensureDietEffects(true);
    this.persist();
    this.apply();
    return { satiety: ids.satiety, hungry: ids.hungry };
  }

  groundTile() {
    const id = this.store?.ground?.selected;
    if (!id) return null;
    const builtin = live.ground.builtin.find((g) => g.id === id);
    if (builtin) return builtin.sprite;
    const custom = live.ground.custom.find((g) => g.id === id);
    return custom ? custom.sprite : null;
  }
}
