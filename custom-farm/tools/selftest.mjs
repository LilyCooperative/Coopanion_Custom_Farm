/**
 * 不装进 Coopanion 也能跑的冒烟测试：假 host、假时间、真文件。
 * 用法：node tools/selftest.mjs
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import definition, { CROPS, FarmWorld } from '../src/index.js';
import { FarmCatalog } from '../src/catalog.js';
import { live } from '../src/catalog-state.js';
import { buildZip, readZip } from '../src/zip.js';
import { CROP_PRICES, FURNITURE, FURNITURE_ENABLED, SEED_BY_CROP, SEED_BY_ID } from '../src/shop.js';
import {
  REACH, checkSpot, cropOf, growthForLevel, isRipe, levelOf, minGapX, newState, pickSpot, water, waterTargets,
  X_MIN, X_MAX, farmBounds, applyFarmSize, overlayView, advance, removeDeadAt, summary, harvestWeed,
  placeDecoration,
  tickStates, compareValue, consumeActions,
} from '../src/farm.js';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  —  ' + detail : ''));
};

const dataDir = await mkdtemp(join(tmpdir(), 'farm-selftest-'));
const overlayFile = join(dataDir, 'overlay-state.json');

let clock = 1_760_000_000_000;
const now = () => clock;
const random = (() => { let s = 42; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();

const events = [];
const logs = [];
const host = {
  pushEvent: async (e, opts) => { events.push({ ...e, opts }); return { ...e, cursor: events.length }; },
  store: { range: () => [], latestCursor: () => 0 },
  modelFacts: {},
  log: { info: (t, m) => logs.push(['info', t, m]), warn: (t, m) => logs.push(['warn', t, m]), error: (t, m) => logs.push(['error', t, m]), debug: () => {} },
};

// 1 秒 = 60 游戏分钟：几拍就能熟，测试跑得快
const cfg = {
  zoom: 2,
  screenWidth: 2048,
  spriteGapPx: 4,
  realMinutesPerDay: 0.02,  // 1 游戏日 = 1.2 秒，十拍能熟
  tickIntervalMs: 1000,
  pointsPerDay: 288,
  dryPerDay: 0,             // 主流程不测枯萎（单独一个 world 测）
  wiltDays: 40,
  maxPlants: 8,
  startCoins: 5000,          // 测试里要买种子/家具
  overlayStatePath: overlayFile,
  overlayEnabled: true,
};

let pendingTimer = null;
const timers = {
  setTimeout: (fn, ms) => { pendingTimer = { fn, ms }; return { unref() {} }; },
  clearTimeout: () => { pendingTimer = null; },
};

const world = new FarmWorld({ cfg, dataDir, botDir: dataDir, packageDir, now, random, timers, manageLayers: false });
const tool = (name) => world.tools().find((t) => t.name === name).handler;

async function fireTick() {
  const t = pendingTimer;
  if (!t) return false;
  pendingTimer = null;
  t.fn();
  const deadline = Date.now() + 3000;
  while (!pendingTimer && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2));
  return true;
}
async function tickSeconds(n) {
  let did = 0;
  for (let i = 0; i < n; i += 1) {
    clock += 1000;
    if (await fireTick()) did += 1;
  }
  return did;
}
const readState = async () => JSON.parse(await readFile(world.stateFile(), 'utf8'));

// --- 1. 定义 ---------------------------------------------------------------
check('definition.id = farm', definition.id === 'farm');
check('18 种作物', Object.keys(CROPS).length === 18, Object.keys(CROPS).join(','));
check('describe 有 13 个工具', definition.describe.tools.length === 13, definition.describe.tools.map((t) => t.name).join(','));
check('describe 有 4 个事件', definition.describe.events.length === 4, definition.describe.events.map((e) => e.type).join(','));

// --- 模板 ZIP 读写 ---------------------------------------------------------
{
  const zip = buildZip([
    { name: 'custom.json', data: JSON.stringify({ crops: [1], hello: '农场' }) },
    { name: 'sprites/cust_demo_1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  ]);
  const back = readZip(zip);
  check('模板 ZIP：读回两个文件', back.length === 2 && back[0].name === 'custom.json' &&
    back[1].name === 'sprites/cust_demo_1.png', back.map((e) => e.name).join(','));
  check('模板 ZIP：内容与中文正确', JSON.parse(back[0].data.toString('utf8')).hello === '农场' &&
    back[1].data.length === 8);
  let badPath = false;
  try {
    readZip(buildZip([{ name: '../evil.txt', data: 'x' }]));
  } catch { badPath = true; }
  check('模板 ZIP：拒绝 ../ 路径', badPath);
}
check('作物表来自游戏数据（番茄 total=2016）', CROPS.tomato.total === 2016 && CROPS.tomato.levels === 6);
check('番茄可多次收获（lifespan 4）', CROPS.tomato.lifespan === 4 && CROPS.pumpkin.lifespan === 1);
// 间距倍率：1 = 刚好不重叠；0.5 = 更密（允许轻微重叠）
{
  const tight = minGapX(CROPS.tomato, CROPS.tomato, { ...cfg, cropGapScale: 0.5 });
  const exact = minGapX(CROPS.tomato, CROPS.tomato, { ...cfg, cropGapScale: 1 });
  check('作物间距倍率可调', tight < exact, tight.toFixed(4) + ' < ' + exact.toFixed(4));
  const direct = minGapX(CROPS.tomato, CROPS.tomato, { ...cfg, cropGapPct: 2.5 });
  check('作物间距可直接按屏宽百分比', Math.abs(direct - 0.025) < 1e-9, String(direct));
}
// 农田整体大小：底边始终满宽；整块内容缩放、位置重映射；缩小补野草且仍可种
{
  const mk = (id, x) => ({ id, crop: 'tomato', x, level: 0, growth: 0, moisture: 0.6, harvests: 0, drySince: null, dead: false, ripeNotified: false });
  const s = newState(clock, { ...cfg }, random);
  s.plots = [mk(1, 0.05), mk(2, 0.5), mk(3, 0.95), mk(4, 0.3)];
  s.inventory = { seed_tomato: 0 };
  s.weeds = [];
  s.farmCells = 48;
  s.screenWidth = 2048;
  const shrink = applyFarmSize(s, { ...cfg, farmCells: 24 }, random);
  check('农田缩小：不删作物、不退种子', shrink.removed.length === 0 && s.plots.length === 4 && s.inventory.seed_tomato === 0, JSON.stringify(shrink.removed));
  check('农田缩小：作物整体变小', Math.abs(shrink.cropScale - 0.5) < 1e-9, String(shrink.cropScale));
  const moved = s.plots.find((p) => p.id === 4);
  check('农田缩小：作物位置按中心缩放', moved && Math.abs(moved.x - 0.4) < 0.01, String(moved && moved.x));
  check('农田缩小：新野地补杂草', shrink.weedsAdded > 0, 'added=' + shrink.weedsAdded);
  check('农田缩小：野地也能种', checkSpot(s, 0.1, 'tomato', { ...cfg, farmCells: 24 }).ok);
  // 24 格时在野地种一棵；扩到 48 格会被推出屏幕，删除并退种子
  s.plots.push(mk(5, 0.1));
  const grow = applyFarmSize(s, { ...cfg, farmCells: 48 }, random);
  check('农田扩大：被推出屏幕的作物删除并退种子', grow.removed.includes(5) && s.inventory.seed_tomato === 1 && !s.plots.some((p) => p.id === 5), JSON.stringify(grow.removed));
  check('农田扩大：作物整体变大', Math.abs(grow.cropScale - 1) < 1e-9, String(grow.cropScale));
  check('农田扩大：屏幕内作物保留', s.plots.length === 4, String(s.plots.length));
}
// 关机/睡眠回来不能把整段时间一次补完（否则 1 天 = 1 小时时，关一晚就跳 12 天、田全枯）
{
  const slowCfg = { ...cfg, dryPerDay: 0.15, realMinutesPerDay: 60, maxStepDays: 1, startMinute: 360, minutesPerDay: 1440 };
  const mk = (id, x) => ({ id, crop: 'tomato', x, level: 0, growth: 0, moisture: 1, harvests: 0, drySince: null, dead: false, ripeNotified: false });
  const st = newState(clock, slowCfg, random);
  st.day = 100;
  st.minute = 400;
  st.elapsedDays = 0;
  st.lastTickMs = clock;
  st.plots = [mk(1, 0.5)];
  st.weeds = [];
  const res = advance(st, clock + 12 * 3600 * 1000, slowCfg, random);
  check('离线 12 小时只补 1 个游戏日（不跳天）', st.day === 101 && res.cappedDays >= 10.9, 'day=' + st.day + ' capped=' + res.cappedDays);
  check('离线 12 小时不会把土一次抽干', st.plots[0].moisture > 0.8, String(st.plots[0].moisture));
  check('正常一拍不受上限影响', advance(st, clock + 12 * 3600 * 1000 + 5000, slowCfg, random).cappedDays === 0);
  const noCap = { ...slowCfg, maxStepDays: 1000 };
  const st2 = newState(clock, noCap, random);
  st2.day = 100; st2.minute = 400; st2.elapsedDays = 0; st2.lastTickMs = clock;
  st2.plots = [mk(1, 0.5)]; st2.weeds = [];
  advance(st2, clock + 12 * 3600 * 1000, noCap, random);
  check('把上限调大仍可离线生长（可配置）', st2.day > 110, 'day=' + st2.day);
}
// 玉米曾经因为 levelSpan 四舍五入（2304/5=460.8→461，5×461>2304）永远到不了第 6 级
{
  const stuck = Object.values(CROPS).filter((c) => levelOf(c, c.total) !== c.levels - 1);
  check('满总生长点能到最高级（玉米 5/6 bug）', stuck.length === 0, stuck.map((c) => c.key + ':' + levelOf(c, c.total)).join(',') || 'all');
  check('最高级所需生长点 = total', Object.values(CROPS).every((c) => growthForLevel(c, c.levels - 1) === c.total));
  const back = Object.values(CROPS).filter((c) => levelOf(c, growthForLevel(c, c.repeatLevel)) !== Math.min(c.levels - 1, c.repeatLevel));
  check('多次收获退回的等级正确（growthForLevel 不差 1 点）', back.length === 0, back.map((c) => c.key).join(','));
  const corn = cropOf('corn');
  check('玉米满进度 isRipe', isRipe({ crop: 'corn', level: levelOf(corn, corn.total), dead: false }) === true);
}

// --- 1b. 农场自定义目录（地面 / 作物 / 杂草） -------------------------------
{
  const catDir = await mkdtemp(join(tmpdir(), 'farm-catalog-'));
  const spritesDir = join(catDir, 'sprites');
  await mkdir(spritesDir, { recursive: true });
  copyFileSync(join(packageDir, '..', 'assets', 'sprites', 'popo20230114_gd_grass_0.png'), join(spritesDir, 'popo20230114_gd_grass_0.png'));
  const cat = new FarmCatalog({ storePath: join(catDir, 'custom.json'), spritesDir, pointsPerDay: 288 });
  cat.load();
  check('目录：内置番茄 6 阶段 / 7 天 / 2016 点',
    CROPS.tomato.stages === 6 && CROPS.tomato.days.length === 5 && CROPS.tomato.total === 2016,
    CROPS.tomato.days.join(',') + ' total=' + CROPS.tomato.total);
  check('目录：地面默认 0 号草皮', live.ground.tile === 'popo20230114_gd_grass_0', String(live.ground.tile));
  check('目录：默认 3 种杂草', live.weedTypes.length === 3, live.weedTypes.map((w) => w.key).join(','));
  const snap0 = cat.snapshot();
  check('目录快照有作物/杂草/地面', snap0.crops.length === 18 && snap0.weeds.length === 3 && snap0.ground.builtin.length === 1);

  cat.saveCrop({ name: '测试菜', stages: 3, days: [0.5, 0.25], value: 42, seedPrice: 10 });
  const key = Object.keys(CROPS).find((k) => CROPS[k].name === '测试菜');
  check('目录：新增作物进 CROPS（阈值）', Boolean(key) && CROPS[key].thresholds[0] === 144 && CROPS[key].total === 216,
    key ? JSON.stringify(CROPS[key].thresholds) : 'missing');
  check('目录：新增作物有种子和售价', SEED_BY_CROP[key]?.buy === 10 && CROP_PRICES[key]?.sell === 42);
  cat.saveWeed({ name: '测试草', stages: 3, days: [0.1, 0.1], weight: 7, itemName: '草籽', value: 3, layer: 'bottom' });
  const wk = Object.keys(live.weeds).find((k) => live.weeds[k].name === '测试草');
  check('目录：新增杂草 + 收获物价格 + 下层', Boolean(wk) && live.weedTypes.some((w) => w.key === wk) && CROP_PRICES['weed_' + wk]?.sell === 3 && live.weeds[wk].layer === 'bottom',
    wk || 'missing');

  const stw = newState(clock, { ...cfg, dryPerDay: 0 }, random);
  stw.weeds = [{ id: 1, x: 0.5, kind: 'weed', type: wk, level: 2, age: 1 }];
  stw.drops = [];
  check('图层：杂草上下层传给 overlay', overlayView(stw).weeds[0].layer === 'bottom');
  const wres = harvestWeed(stw, cfg, 1, random);
  check('目录：自定义杂草能收出产物', wres.drop.item === 'weed_' + wk && stw.weeds.length === 0 && stw.drops.length === 1,
    wres.drop.item);

  const pick = snap0.ground.builtin[0];
  cat.selectGround(pick.id);
  check('目录：换地面写进图层', live.ground.tile === pick.sprite, String(live.ground.tile));

  check('目录：浇水默认值来自配置', cat.status.water.dryPerDay === 0.15 && cat.status.water.waterGain === 1 && cat.status.water.wiltDays === 2.2,
    JSON.stringify(cat.status.water));
  check('目录：默认浇水帧 4+6', cat.status.fx.pour.length === 4 && cat.status.fx.burst.length === 6,
    cat.status.fx.pour.length + '+' + cat.status.fx.burst.length);
  cat.saveStatus({
    water: { dryPerDay: 0.2, waterGain: 1.5, wiltDays: 3 },
    fx: { pour: ['water_pour_1', 'water_pour_2'], burst: [], pourMs: 100, burstMs: 120 },
    wither: null,
  });
  check('目录：状态设置保存', cat.status.water.dryPerDay === 0.2 && cat.status.water.waterGain === 1.5 && cat.status.fx.pour.length === 2 && cat.status.fx.burst.length === 0,
    JSON.stringify(cat.status));
  const statusView = overlayView(newState(clock, { ...cfg, dryPerDay: 0 }, random));
  check('图层：浇水帧与枯萎贴图来自目录', statusView.waterFx.pour.length === 2 && statusView.waterFx.pourMs === 100 && statusView.wither === null,
    JSON.stringify(statusView.waterFx));
  cat.resetFx();
  check('目录：恢复默认特效', cat.status.fx.pour.length === 4 && cat.status.fx.burst.length === 6, cat.status.fx.pour.length + '+' + cat.status.fx.burst.length);

  check('目录：默认自带心情/饱食度/饥饿状态',
    cat.states.length === 5 && cat.states.some((s) => s.id === 'mood') &&
    cat.states.some((s) => s.id === 'st_satiety' && s.kind === 'number') &&
    cat.states.some((s) => s.id === 'st_hungry' && s.kind === 'flag') &&
    cat.rules.length === 3,
    JSON.stringify(cat.states.map((s) => s.id)) + ' rules=' + cat.rules.length);
  check('目录：默认饥饿条件 + 自动吃东西',
    cat.rules.some((r) => r.source === 'st_satiety' && r.target === 'st_hungry' && r.value === 30) &&
    cat.consume.some((c) => c.trigger === 'st_hungry' && c.effectState === 'st_satiety' && c.auto === true),
    JSON.stringify(cat.consume));
  check('目录：默认食物效果（作物 + 米饭/意面都有饱食度和心情）',
    ['potato', 'tomato', 'watermelon', 'rice', 'pasta'].every((id) => {
      const it = cat.items.find((x) => x.id === id);
      return it && it.effects.some((e) => e.state === 'st_satiety' && e.delta > 0) &&
        it.effects.some((e) => e.state === 'mood' && e.delta > 0);
    }),
    JSON.stringify(cat.items.filter((it) => ['potato', 'rice', 'pasta'].includes(it.id)).map((it) => [it.id, it.effects])));
  const beforeExample = { states: cat.states.length, rules: cat.rules.length, consume: cat.consume.length };
  const example = cat.addExample();
  check('目录：补齐示例幂等（不重复加状态/条件/消耗行为）',
    example.satiety === 'st_satiety' && example.hungry === 'st_hungry' &&
    cat.states.length === beforeExample.states && cat.rules.length === beforeExample.rules && cat.consume.length === beforeExample.consume,
    JSON.stringify(example));

  const seedTomato = cat.items.find((it) => it.id === 'seed_tomato');
  const cropTomato = cat.items.find((it) => it.id === 'tomato');
  check('目录：道具表自动生成种子/农作物', Boolean(seedTomato) && Boolean(cropTomato) &&
    seedTomato.buy === 120 && cropTomato.sell === 70, JSON.stringify([seedTomato, cropTomato]));
  cat.saveItem({ id: 'seed_tomato', buy: 0, sell: 24 });
  check('目录：种子买价 0（商店不卖）', cat.items.find((it) => it.id === 'seed_tomato').buy === 0 &&
    SEED_BY_ID.seed_tomato.buy === 0);
  cat.saveItem({ id: 'seed_tomato', buy: 120, sell: 24 });
  cat.saveItem({ id: 'tomato', consumable: true, effects: [{ state: 'st_satiety', delta: 20 }] });
  check('目录：农作物可消耗 + 状态效果', cat.items.find((it) => it.id === 'tomato').consumable === true &&
    live.items.tomato.effects[0]?.state === 'st_satiety' && live.items.tomato.effects[0].delta === 20);
  const deco = cat.saveItem({ kind: 'decor', name: '测试装饰', buy: 10, sell: 5, icon: 'icon_item_soil', sprite: 'icon_item_soil', layer: 'top' });
  check('目录：新增装饰道具', Boolean(deco) && cat.items.some((it) => it.id === deco.id) && deco.layer === 'top');
  const foodIds = ['rice_ear', 'rice', 'egg', 'meat', 'egg_fried_rice', 'item_15', 'pasta'];
  check('目录：食材/菜谱道具和价格（含意面）', foodIds.every((id) => cat.items.some((it) => it.id === id)) &&
    cat.items.find((it) => it.id === 'item_15')?.buy === 0 &&
    cat.items.find((it) => it.id === 'egg_fried_rice')?.buy === 0 &&
    cat.items.find((it) => it.id === 'pasta')?.buy === 0 &&
    !cat.items.some((it) => it.id === 'flour') &&
    cat.items.find((it) => it.id === 'egg')?.buy === 6,
    JSON.stringify(cat.items.filter((it) => foodIds.includes(it.id)).map((it) => [it.id, it.buy, it.sell])));
  check('目录：4 张食物合成表（含肉酱意面）', ['recipe_rice', 'recipe_egg_fried_rice', 'recipe_tomato_egg', 'recipe_pasta']
    .every((id) => cat.recipes.some((r) => r.id === id)), JSON.stringify(cat.recipes));
  const recipeBase = cat.recipes.length;
  const customRecipe = cat.saveRecipe({ inputs: [{ item: 'tomato', count: 2 }], output: { item: deco.id, count: 1 } });
  check('目录：合成表保存', cat.recipes.length === recipeBase + 1 && customRecipe.output.item === deco.id, JSON.stringify(cat.recipes));
  cat.removeRecipe(customRecipe.id);
  const decoIcon = join(spritesDir, 'cust_item_' + deco.id + '_icon_1.png');
  const decoSprite = join(spritesDir, 'cust_item_' + deco.id + '_sprite_1.png');
  await writeFile(decoIcon, 'x');
  await writeFile(decoSprite, 'x');
  cat.removeItem(deco.id);
  check('目录：删装饰/合成表/自定义贴图', !cat.items.some((it) => it.id === deco.id) && cat.recipes.length === recipeBase &&
    !existsSync(decoIcon) && !existsSync(decoSprite));

  const tomatoCrop = cat.snapshot().crops.find((c) => c.key === 'tomato');
  cat.saveCrop({ ...tomatoCrop, seedSprite: 'icon_item_soil', itemSprite: 'icon_item_soil' });
  check('目录：种子/农作物道具继承作物图标', cat.items.find((it) => it.id === 'tomato').icon === 'icon_item_soil' &&
    cat.items.find((it) => it.id === 'seed_tomato').icon === 'icon_item_soil' &&
    live.itemIcons.tomato === 'icon_item_soil', JSON.stringify({
    crop: cat.items.find((it) => it.id === 'tomato').icon,
    seed: cat.items.find((it) => it.id === 'seed_tomato').icon,
  }));

  cat.saveSettings({
    farmCells: 24, maxPlants: 8, cropScale: 1.5, dropScale: 1.6, groundHeight: 8, realMinutesPerDay: 30, dailyEvent: true,
    startWeeds: 10, maxWeeds: 20, weedPerDay: 0.3, weedClearRadius: 0.05,
  });
  check('目录：面板设置覆盖保存', cat.settings.farmCells === 24 && cat.settings.maxPlants === 8 &&
    cat.settings.cropScale === 1.5 && cat.settings.dropScale === 1.6 && cat.settings.groundHeight === 8 &&
    cat.settings.realMinutesPerDay === 30 && cat.settings.dailyEvent === true &&
    cat.settings.startWeeds === 10 && cat.settings.maxWeeds === 20 && cat.settings.weedPerDay === 0.3 &&
    cat.settings.weedClearRadius === 0.05,
    JSON.stringify(cat.settings));
  const cropZoomState = newState(clock, { ...cfg, dryPerDay: 0 }, () => 0.5);
  cropZoomState.cropScale = 1.5;
  check('图层：农作物整体缩放传给 overlay', overlayView(cropZoomState).farm.cropZoom === 1.5);
  cat.saveItem({ id: 'deco_tree', scale: 1.8 });
  cropZoomState.furniture = [{ uid: 1, id: 'deco_tree', x: 0.5 }];
  cropZoomState.groundHeight = 7;
  cropZoomState.dropScale = 1.4;
  check('图层：每个装饰大小传给 overlay', overlayView(cropZoomState).furniture[0].scale === 1.8);
  check('图层：地表高度传给 overlay', overlayView(cropZoomState).groundHeight === 7);
  check('图层：掉落物大小传给 overlay', overlayView(cropZoomState).dropScale === 1.4);

  const decoState = newState(clock, { ...cfg, dryPerDay: 0 }, () => 0.5);
  decoState.inventory = { deco_top: 1, deco_bottom: 1 };
  decoState.weeds = [
    { id: 1, x: 0.5, type: 'weed', level: 1 },
    { id: 2, x: 0.8, type: 'weed', level: 1 },
  ];
  const placeTop = placeDecoration(decoState, { id: 'deco_top', name: '顶层装饰', kind: 'decor', sprite: 'icon_item_soil', layer: 'top' }, 0.5);
  check('装饰：上层放到杂草层并清草', placeTop.layer === 'top' && placeTop.cleared === 1 &&
    decoState.weeds.length === 1 && decoState.furniture[0].layer === 'top');
  const placeBottom = placeDecoration(decoState, { id: 'deco_bottom', name: '底层装饰', kind: 'decor', sprite: 'icon_item_soil', layer: 'bottom' }, 0.5);
  check('装饰：下层在作物后且不清草', placeBottom.layer === 'bottom' && placeBottom.cleared === 0 &&
    decoState.weeds.length === 1 && decoState.furniture[1].layer === 'bottom');
  const decoView = overlayView(decoState).furniture;
  check('装饰：overlay 带上下层', decoView[0].layer === 'top' && decoView[1].layer === 'bottom');
  cat.saveState({ name: '测试心情', kind: 'number', min: -10, max: 10, initial: 0, driftPerDay: 1, unit: '点' });
  const mood = cat.states.find((s) => s.name === '测试心情');
  check('目录：新增数值状态', Boolean(mood) && mood.min === -10 && mood.max === 10 && mood.unit === '点');
  cat.saveRule({ source: mood.id, op: '>=', value: 5, target: 'st_hungry' });
  check('目录：新增条件', cat.rules.some((r) => r.source === mood.id && r.op === '>='));
  cat.removeState('st_hungry');
  check('目录：删状态连带删条件', !cat.states.some((s) => s.id === 'st_hungry') && !cat.rules.some((r) => r.source === 'st_hungry' || r.target === 'st_hungry'));
  check('目录：删状态连带删消耗行为', !cat.consume.some((c) => c.trigger === 'st_hungry'));
  cat.removeState(mood.id);
  cat.removeCrop(key);
  check('目录：删除作物', !CROPS[key]);
  cat.removeWeed(wk);
  check('目录：删除杂草', !live.weeds[wk]);
  await rm(catDir, { recursive: true, force: true });
}

// --- 1c. 自定义状态（漂移 + 条件） -----------------------------------------
{
  const defs = [
    { id: 'satiety', name: '饱食度', kind: 'number', min: 0, max: 100, initial: 100, driftPerDay: -10, unit: '' },
    { id: 'hungry', name: '饥饿', kind: 'flag', initialActive: false },
  ];
  const rules = [{ id: 'r1', source: 'satiety', op: '<', value: 30, target: 'hungry' }];
  const st = newState(clock, { ...cfg, dryPerDay: 0 }, random);
  st.states = {};
  tickStates(st, defs, rules, 0);
  check('状态：初始值', st.states.satiety.value === 100 && st.states.hungry.active === false, JSON.stringify(st.states));
  tickStates(st, defs, rules, 8);
  check('状态：漂移 + 条件触发', st.states.satiety.value === 20 && st.states.hungry.active === true, JSON.stringify(st.states));
  tickStates(st, defs, rules, 10);
  check('状态：低于下限夹住', st.states.satiety.value === 0 && st.states.hungry.active === true, JSON.stringify(st.states));
  check('状态：比较运算符', compareValue(2, '<', 3) && compareValue(3, '>=', 3) && compareValue(3, '!=', 4) && !compareValue(3, '==', 4));
  const sm = summary(st, { ...cfg, stateDefs: defs, stateRules: rules });
  check('状态：summary 带当前值', sm.states.length === 2 && sm.states[0].value === 0 && sm.states[1].active === true, JSON.stringify(sm.states));
  const st2 = newState(clock, { ...cfg, realMinutesPerDay: 60, stateDefs: defs, stateRules: rules }, random);
  st2.lastTickMs = clock;
  advance(st2, clock + 60 * 60 * 1000, { ...cfg, realMinutesPerDay: 60, stateDefs: defs, stateRules: rules }, random);
  check('状态：advance 一天漂移一次', st2.states.satiety.value === 90 && st2.states.hungry.active === false, JSON.stringify(st2.states));
}

// --- 1d. 状态触发消耗（饥饿 → 吃道具 → 饱食度回来） -----------------------
{
  const defs = [
    { id: 'st_satiety', name: '饱食度', kind: 'number', min: 0, max: 100, initial: 100, driftPerDay: -10, unit: '' },
    { id: 'st_hungry', name: '饥饿', kind: 'flag', initialActive: false },
  ];
  const rules = [{ id: 'r1', source: 'st_satiety', op: '<', value: 30, target: 'st_hungry' }];
  const acts = [{
    id: 'c1', trigger: 'st_hungry', items: ['potato', 'tomato'], count: 1,
    effectState: 'st_satiety', effectDelta: 25, cooldownDays: 0.5, auto: true, enabled: true,
  }];
  const st = newState(clock, { ...cfg, dryPerDay: 0 }, random);
  st.states = { st_satiety: { value: 20 }, st_hungry: { active: true } };
  st.inventory = { potato: 2 };
  st.elapsedDays = 10;

  const r1 = consumeActions(st, defs, rules, acts, 10);
  // 道具自己的 effects 优先于消耗行为的 effectDelta：土豆默认 +24 饱食度。
  check('消耗：吃道具并把饱食度加回来（道具效果优先）', r1.length === 1 && st.inventory.potato === 1 &&
    st.states.st_satiety.value === 44 && st.states.st_hungry.active === false,
    JSON.stringify({ inv: st.inventory, states: st.states }));
  const r2 = consumeActions(st, defs, rules, acts, 10.2);
  check('消耗：冷却内不重复吃', r2.length === 0 && st.inventory.potato === 1);
  st.states.st_hungry = { active: true };
  const r3 = consumeActions(st, defs, rules, acts, 10.6);
  check('消耗：冷却过了再吃', r3.length === 1 && !st.inventory.potato);
  st.states.st_hungry = { active: true };
  st.elapsedDays = 12;
  const r4 = consumeActions(st, defs, rules, acts, 12);
  check('消耗：没道具时提示', r4.length === 1 && r4[0].missing === true);

  const st2 = newState(clock, { ...cfg, dryPerDay: 0 }, random);
  st2.states = { st_satiety: { value: 20 }, st_hungry: { active: true } };
  st2.inventory = { potato: 1 };
  st2.elapsedDays = 0;
  const prompt = [{ ...acts[0], id: 'c2', auto: false }];
  const r5 = consumeActions(st2, defs, rules, prompt, 0);
  check('消耗：只提醒模式不动背包', r5.length === 1 && r5[0].promptOnly === true && st2.inventory.potato === 1,
    JSON.stringify(r5));
}

// --- 2. 启动 ---------------------------------------------------------------
await world.start(host);
const raw = await readState();
check('启动后写出 state', Array.isArray(raw.plots) && raw.plots.length === 4, 'plots=' + raw.plots.length);
const view0 = JSON.parse(await readFile(overlayFile, 'utf8'));
check('图层视图带 prefix/frame', view0.plots.every((p) => p.prefix && Number.isInteger(p.frame)));
check('图层视图带 drops/inventory/fx', Array.isArray(view0.drops) && view0.inventory && Array.isArray(view0.fx));
check('开局不重叠', raw.plots.every((a, i) => raw.plots.every((b, j) => i === j ||
  Math.abs(a.x - b.x) >= minGapX(cropOf(a.crop), cropOf(b.crop), cfg) - 1e-9)), raw.plots.map((p) => p.x).join(','));

// --- 3. 不重叠 + 任意数量 --------------------------------------------------
const s1 = await readState();
const occupied = s1.plots[0].x;
const clash = checkSpot(s1, occupied + 0.005, 'tomato', cfg);
check('重叠位置被拒绝', clash.ok === false, clash.reason);
check('拒绝信息里说清和谁叠了', /叠在一起/.test(clash.reason));
const far = pickSpot(s1, 'tomato', cfg, random);
check('随机挑的位置可用', checkSpot(s1, far, 'tomato', cfg).ok === true, String(far));

// 挑一个真的空着的位置站过去
const freeSpot = pickSpot(s1, 'tomato', cfg, random);
const stand0 = await tool('farm_stand')({ at: freeSpot });
check('farm_stand 只给 at 也行', !stand0.failed, stand0.text.split('\n')[0]);
const noAt = await tool('farm_stand')({ plot: 1 });
check('不给 at 被拒绝', noAt.failed === true && noAt.text.includes('at'), noAt.text.split('\n')[0]);

const beforeCount = (await readState()).plots.length;
// 种子：没有种子不能种；买了先进背包，种下扣 1 包
const noSeed = await tool('farm_plant')({ crop: '南瓜' });
check('没有种子种不了', noSeed.failed === true && /种子/.test(noSeed.text), noSeed.text.split('\n')[0]);
const seedBought = await tool('farm_buy')({ id: 'seed_strawberry', count: 1 });
check('买种子进背包', !seedBought.failed && /草莓种子/.test(seedBought.text), seedBought.text.split('\n')[0]);
check('种子在背包里', (await readState()).inventory.seed_strawberry === 1);
const planted = await tool('farm_plant')({ crop: '草莓' });
check('能种新作物', !planted.failed && planted.text.includes('草莓'), planted.text.split('\n')[0]);
check('种下扣 1 包种子', (await readState()).inventory.seed_strawberry === undefined);
check('数量 +1（任意数量，不是固定 4 块）', (await readState()).plots.length === beforeCount + 1);
const s2 = await readState();
const straw = s2.plots.filter((p) => p.crop === 'strawberry').pop();
check('种在脚下的位置', Math.abs(straw.x - freeSpot) < 1e-9, String(straw.x) + ' vs ' + freeSpot);
const onTop = await tool('farm_plant')({ crop: '土豆' });
check('站在同一处再种会被拒绝（会重叠）', onTop.failed === true, onTop.text.split('\n')[0]);

// --- 4. 生长 + 成熟事件 ----------------------------------------------------
const ticks = await tickSeconds(12);
check('tick 跑了', ticks > 2, 'ticks=' + ticks);
const grown = await readState();
check('生长推进了等级', grown.plots.some((p) => p.level > 0), grown.plots.map((p) => p.level).join(','));
check('成熟事件推送了', events.some((e) => e.type === 'farm.ripe'), events.map((e) => e.type).join(','));
const ripeEvent = events.find((e) => e.type === 'farm.ripe');
check('成熟事件说清去哪儿收', /熟了/.test(ripeEvent.text) && /farm_collect/.test(ripeEvent.text), ripeEvent.text);

// --- 5. 收割 → 掉在地上（不进背包） ---------------------------------------
const s3 = await readState();
const ripe = s3.plots.find((p) => isRipe(p));
check('有熟的', Boolean(ripe), s3.plots.map((p) => p.level + '/' + cropOf(p.crop).levels).join(' '));
await tool('farm_stand')({ at: ripe.x, plot: ripe.id });
const bagBefore = Object.values(s3.inventory).reduce((a, b) => a + b, 0);
const harv = await tool('farm_harvest')({ plot: ripe.id });
check('收割成功', !harv.failed, harv.text.split('\n')[0]);
const s4 = await readState();
check('产物掉在地上', s4.drops.length >= 1, 'drops=' + s4.drops.length);
check('收割不直接进背包', Object.values(s4.inventory).reduce((a, b) => a + b, 0) === bagBefore);
check('产量落在游戏表的 min~max 内', s4.drops.every((d) => {
  const c = CROPS[d.crop];
  return d.count >= c.minCount && d.count <= c.maxCount;
}), s4.drops.map((d) => d.crop + '×' + d.count + '（' + CROPS[d.crop].minCount + '~' + CROPS[d.crop].maxCount + '）').join(','));
check('掉落物会往左右弹一段', s4.drops.every((d) => Math.abs(d.x - d.fromX) > 0.005 && Math.abs(d.x - d.fromX) < 0.05),
  s4.drops.map((d) => d.fromX + '→' + d.x).join(','));
check('游戏表里番茄产量 2~4', CROPS.tomato.minCount === 2 && CROPS.tomato.maxCount === 4);
check('土豆固定 2~4、南瓜固定 1', CROPS.potato.minCount === 2 && CROPS.potato.maxCount === 4 && CROPS.pumpkin.minCount === 1);

// --- 6. 捡起来才进背包 -----------------------------------------------------
const away = await tool('farm_stand')({ at: 0.02 });
check('走远去站', !away.failed, away.text.split('\n')[0]);
const badCollect = await tool('farm_collect')({});
check('离得远捡不到', badCollect.failed === true, badCollect.text.split('\n')[0]);
await tool('farm_stand')({ at: s4.drops[0].x });
const col = await tool('farm_collect')({});
check('站过去能捡', !col.failed, col.text.split('\n')[0]);
const s5 = await readState();
check('背包里有了', Object.values(s5.inventory).reduce((a, b) => a + b, 0) > bagBefore, JSON.stringify(s5.inventory));
check('地上清空了', s5.drops.length === 0);
check('捡起来有 collect 特效', s5.fx.some((f) => f.kind === 'collect'));
// 种子价格来自游戏表；WebUI 商店里也要有种子
check('种子价格来自游戏', SEED_BY_ID.seed_tomato?.buy === 120 && SEED_BY_ID.seed_potato?.buy === 30 && SEED_BY_ID.seed_corn?.sell === 11);
check('图层商店包含种子', (await readFile(overlayFile, 'utf8')).includes('seed_tomato'));

// --- 7. 多次收获 -----------------------------------------------------------
const multi = newState(clock, { ...cfg }, random);
multi.plots = [];
multi.drops = [];
multi.inventory.seed_tomato = 1;
const tm = { plots: multi.plots };
const { plant: plantFn } = await import('../src/farm.js');
const tomato = plantFn(multi, { x: 0.5, crop: 'tomato', cfg, random });
tomato.level = CROPS.tomato.levels - 1;
tomato.growth = CROPS.tomato.total;
const { harvest: harvestFn } = await import('../src/farm.js');
const h1 = harvestFn(multi, cfg, tomato.id, random);
check('收第一次：掉出产物', h1.harvested.length === 1);
check('收第一次：退回 repeatLevel 继续长', multi.plots[0].level === CROPS.tomato.repeatLevel, 'level=' + multi.plots[0].level);
check('收第一次：累计 1 次', multi.plots[0].harvests === 1);
multi.plots[0].level = CROPS.tomato.levels - 1;
multi.plots[0].growth = CROPS.tomato.total;
harvestFn(multi, cfg, tomato.id, random);
multi.plots[0].level = CROPS.tomato.levels - 1;
multi.plots[0].growth = CROPS.tomato.total;
harvestFn(multi, cfg, tomato.id, random);
multi.plots[0].level = CROPS.tomato.levels - 1;
multi.plots[0].growth = CROPS.tomato.total;
const last = harvestFn(multi, cfg, tomato.id, random);
check('收满 lifespan（4 次）后拔掉', last.removed.length === 1 && multi.plots.length === 0);
check('收满拔掉会记进田地大事记', multi.fieldLog.some((e) => e.kind === 'harvest' && e.times === 4 && e.id === tomato.id),
  JSON.stringify(multi.fieldLog[multi.fieldLog.length - 1]));
{
  // 桌宠查田时能看见"这棵怎么没的"，不用再猜存档被清
  const st = newState(clock, cfg, random);
  st.plots = [{ id: 7, crop: 'potato', x: 0.4, level: 3, growth: 900, moisture: 0, harvests: 0, drySince: 0, dead: true, ripeNotified: false }];
  const n = removeDeadAt(st, 0.41);
  check('重种会清掉脚下枯株', n === 1 && st.plots.length === 0);
  check('重种清枯株也记账', st.fieldLog.some((e) => e.kind === 'replant' && e.id === 7));
  const sm = summary(st, cfg);
  check('summary 带田地大事记', Array.isArray(sm.fieldLog) && sm.fieldLog.length === 1, JSON.stringify(sm.fieldLog));
  const live = summary(multi, cfg);
  check('summary 不暴露死株（田空但日志在）', live.planted === 0 && live.fieldLog.length > 0);
}

// --- 8. 枯萎 ---------------------------------------------------------------
let pendingTimer2 = null;
const timers2 = {
  setTimeout: (fn) => { pendingTimer2 = fn; return { unref() {} }; },
  clearTimeout: () => { pendingTimer2 = null; },
};
async function tickSeconds2(n) {
  let did = 0;
  for (let i = 0; i < n; i += 1) {
    clock += 1000;
    const t = pendingTimer2;
    if (!t) { await new Promise((r) => setTimeout(r, 30)); continue; }
    pendingTimer2 = null;
    t();
    did += 1;
    const deadline = Date.now() + 2000;
    while (!pendingTimer2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2));
  }
  return did;
}

const dryWorld = new FarmWorld({
  cfg: { ...cfg, dryPerDay: 20, wiltDays: 0.05, pointsPerDay: 1, overlayStatePath: join(dataDir, 'ov2.json') },
  dataDir: join(dataDir, 'dry'),
  botDir: dataDir,
  packageDir,
  now,
  random,
  timers: timers2,
  manageLayers: false,
});
await dryWorld.start(host);
const dryBefore = events.length;
await tickSeconds2(4);
const dryState = JSON.parse(await readFile(dryWorld.stateFile(), 'utf8'));
check('缺水会枯萎', dryState.plots.some((p) => p.dead), dryState.plots.map((p) => p.dead + '/' + p.moisture.toFixed(2)).join(' '));
check('枯萎不单独唤醒模型', !events.slice(dryBefore).some((e) => e.type === 'farm.wilt'));
const deadPlot = dryState.plots.find((p) => p.dead);
const dryTool = (n) => dryWorld.tools().find((t) => t.name === n).handler;
await dryTool('farm_stand')({ at: deadPlot.x });
const deadHarv = await dryTool('farm_harvest')({ plot: deadPlot.id });
check('枯萎的收不了', deadHarv.failed === true && deadHarv.text.includes('枯萎'), deadHarv.text.split('\n')[0]);
const replant = await dryTool('farm_plant')({ crop: '土豆' });
check('原地重种会把枯的拔掉', !replant.failed, replant.text.split('\n')[0]);
const afterReplant = JSON.parse(await readFile(dryWorld.stateFile(), 'utf8'));
check('枯的那棵没了', !afterReplant.plots.some((p) => p.id === deadPlot.id));
await dryWorld.stop();

// --- 9. 浇水（必须走到跟前） ------------------------------------------------
const waterTarget = (await readState()).plots.find((p) => !p.dead);
await tool('farm_stand')({ at: waterTarget.x });
const tooFar = await tool('farm_water')({ plot: ((await readState()).plots.find((p) => !p.dead && Math.abs(p.x - waterTarget.x) > 0.1) ?? {}).id })
  .catch((e) => ({ failed: true, text: String(e) }));
const waterRes = await tool('farm_water')({});
check('浇水成功', !waterRes.failed && waterRes.text.includes('浇'), waterRes.text.split('\n')[0]);
const wState = await readState();
check('浇水特效有记录', wState.fx.some((f) => f.kind === 'water'));
check('浇水回执压成一行（省 token）', !waterRes.text.includes('\n'), waterRes.text);
const againRes = await tool('farm_water')({});
check('已经浇透的不重复浇（省 token / 不重复播特效）', againRes.text.includes('浇透'), againRes.text);

// --- 9b. 一次浇一片：邻近作物一起更新 ---------------------------------------
{
  const plots = [
    { id: 1, x: 0.40, dead: false },
    { id: 2, x: 0.44, dead: false },
    { id: 3, x: 0.60, dead: false },
    { id: 4, x: 0.42, dead: true },
  ];
  const near = waterTargets(plots, 0.42, null, REACH);
  check('一次浇水覆盖邻近作物', near.includes(1) && near.includes(2) && !near.includes(3) && !near.includes(4), JSON.stringify(near));
  const centered = waterTargets(plots, 0.60, 1, REACH);
  check('给 plot 时以那棵为中心覆盖旁边', centered.includes(1) && centered.includes(2) && !centered.includes(3), JSON.stringify(centered));
  check('不存在的 plot 返回 null', waterTargets(plots, 0.4, 99, REACH) === null);

  const st = {
    plots: [
      { id: 1, x: 0.4, crop: 'tomato', moisture: 1.0, dead: false, drySince: null },
      { id: 2, x: 0.44, crop: 'tomato', moisture: 0.2, dead: false, drySince: null },
    ],
    fx: [], nextFxId: 1, minute: 0,
  };
  const skip = water(st, { waterGain: 1.0 }, 1);
  check('已经浇透的会跳过', skip.plots.length === 0 && skip.skipped.length === 1 && skip.skipped[0].id === 1);
  const fill = water(st, { waterGain: 1.0 }, 2);
  check('没浇透的会补满', fill.plots.length === 1 && fill.plots[0].moistureAfter === 1);
}

// --- 10. webUi / invoke ----------------------------------------------------
const ui = world.webUi('zh');
check('webUi badges 有背包', ui.badges.some((b) => b.label === '背包'));
const inv = await world.invoke('field', 'state', []);
check('invoke state 有 bagTotal', typeof inv.bagTotal === 'number', 'bag=' + inv.bagTotal);

// --- 11. 存档 / 重启 -------------------------------------------------------
// ---- 拔枯株 ----
{
  const before = await readState();
  const dead = before.plots.find((p) => p.dead);
  if (dead) {
    await tool('farm_stand')({ at: dead.x });
    const pulled = await tool('farm_pull')({ plot: dead.id });
    const after = await readState();
    check('枯株能被拔掉', !after.plots.some((p) => p.id === dead.id), pulled.text.slice(0, 50));
    check('拔的时候有破坏特效', (after.fx ?? []).some((x) => x.kind === 'pull'));
  } else {
    check('枯株能被拔掉', true, '本轮没有枯株，跳过');
    check('拔的时候有破坏特效', true, '跳过');
  }
  const live = before.plots.find((p) => !p.dead);
  if (live) {
    await tool('farm_stand')({ at: live.x });
    const bad = await tool('farm_pull')({ plot: live.id });
    check('活的不能拔', bad.failed === true, bad.text.slice(0, 40));
  }
}

// ---- 卖东西 / 商店 / 家具 ----
{
  const a = await readState();
  const item = Object.keys(a.inventory).find((k) => CROP_PRICES[k]?.sell > 0);
  const have = a.inventory[item];
  const unit = CROP_PRICES[item].sell;
  const sold = await tool('farm_sell')({ item, count: 1 });
  const b = await readState();
  check('卖东西加金币', b.coins === a.coins + unit, sold.text.slice(0, 60));
  check('卖完背包少一个', (b.inventory[item] ?? 0) === have - 1);

  // 种子也能卖（游戏售价：土豆种子 6）
  const seedSold = await tool('farm_sell')({ item: 'seed_potato', count: 1 });
  check('种子能卖', !seedSold.failed && /土豆种子/.test(seedSold.text) && /6/.test(seedSold.text), seedSold.text.slice(0, 60));

  const shop = await tool('farm_shop')({});
  check('商店列出种子和价格', /seed_tomato/.test(shop.text) && /种子/.test(shop.text) && /金币/.test(shop.text));
  const shopFurn = await tool('farm_shop')({ kind: 'furniture' });
  if (FURNITURE_ENABLED) {
    check('商店也能看家具', /家具/.test(shopFurn.text) && shopFurn.text.length > 80);

    const cheap = FURNITURE.slice().sort((x, y) => x.buy - y.buy)[0];
    const coinsBeforeFurniture = (await readState()).coins;
    const bought = await tool('farm_buy')({ id: cheap.id });
    const c = await readState();
    check('买家具扣钱', c.coins === coinsBeforeFurniture - cheap.buy, bought.text.slice(0, 60));
    check('买家具进背包', c.furniture.length === (b.furniture?.length ?? 0) + 1);

    const uid = c.furniture[c.furniture.length - 1].uid;
    const placed = await tool('farm_place')({ uid, x: 0.42 });
    const d = await readState();
    check('家具能摆到指定位置', d.furniture.find((f) => f.uid === uid).x === 0.42, placed.text);
  } else {
    check('家具已下架：商店不列', /下架/.test(shopFurn.text) && !/plantbasin/.test(shopFurn.text), shopFurn.text.slice(0, 80));
    const buyFurn = await tool('farm_buy')({ id: FURNITURE[0].id });
    check('家具已下架：买不到', buyFurn.failed === true && /下架/.test(buyFurn.text), buyFurn.text.slice(0, 80));
  }
  const broke = await tool('farm_buy')({ id: 'seed_tomato', count: 999 });
  check('钱不够会提示背包可卖的东西', broke.failed === true && /可卖/.test(broke.text), broke.text.slice(0, 80));

  // 一次买多种：一个 items，只扣一次总价
  const coinsBeforeCart = (await readState()).coins;
  const cart = await tool('farm_buy')({ items: [{ id: 'seed_corn', count: 1 }, { id: 'seed_potato', count: 1 }] });
  const afterCart = await readState();
  check('一次买多种种子', !cart.failed && /玉米种子/.test(cart.text) && /土豆种子/.test(cart.text), cart.text.slice(0, 80));
  check('批量购买只扣一次总价', afterCart.coins === coinsBeforeCart - 85, afterCart.coins + ' vs ' + coinsBeforeCart);

  // 种子卖光 → 过一天 → 只推一次"要不要补种子"的询问（不自动买）
  for (const k of Object.keys(afterCart.inventory)) {
    if (k.startsWith('seed_')) await tool('farm_sell')({ item: k });
  }
  const asks0 = events.filter((e) => e.type === 'farm.buy').length;
  await tickSeconds(3);
  const asks = events.filter((e) => e.type === 'farm.buy').length;
  check('种子用完不会自动唤醒询问', asks === asks0, events.filter((e) => e.type === 'farm.buy').slice(-1)[0]?.text?.slice(0, 60) ?? 'none');

  const bad = await tool('farm_buy')({ id: 'no_such_furniture' });
  check('买不存在的东西会失败', bad.failed === true, bad.text.slice(0, 40));
}

const coinsBeforeStop = (await readState()).coins;
await world.stop();
check('stop 之后工具报错', (await tool('farm_status')({})).failed === true);
clock += 60_000;
const world2 = new FarmWorld({ cfg, dataDir, botDir: dataDir, packageDir, now, random, timers, manageLayers: false });
await world2.start(host);
const st4 = JSON.parse(await readFile(world2.stateFile(), 'utf8'));
check('重启沿用存档', st4.coins === coinsBeforeStop, st4.coins + ' vs ' + coinsBeforeStop);
check('重启后不记得站在哪', st4.standingAt === null && st4.current === null);
check('存档带 savedAt', typeof st4.savedAt === 'string');
await world2.stop();

// --- 12. 存档写不进去要报错 ------------------------------------------------
const blocked = join(dataDir, 'blocked-file');
await writeFile(blocked, 'x', 'utf8');
const world3 = new FarmWorld({ cfg: { ...cfg, overlayEnabled: false }, dataDir: blocked, botDir: dataDir, packageDir, now, random, timers, manageLayers: false });
await world3.start(host);
// world3 的存档目录是个文件，读不出来；从 farm_status 里抠一个位置
const st3 = await world3.tools().find((t) => t.name === 'farm_status').handler({});
const m3 = /(\d+)%/.exec(st3.text || '');
const w3x = m3 ? Number(m3[1]) / 100 : 0.5;
await world3.tools().find((t) => t.name === 'farm_stand').handler({ at: w3x });
const broken = await world3.tools().find((t) => t.name === 'farm_water').handler({});
check('存档写不进去时工具报失败', broken.failed === true && broken.text.includes('存档没写下去'), broken.text);
await world3.stop();

// --- 13. v2 老存档迁移 -----------------------------------------------------
const legacyDir = join(dataDir, 'legacy');
await mkdir(join(legacyDir, 'farm'), { recursive: true });
const v2 = {
  v: 2, day: 3, minute: 500, coins: 275, weather: '晴', current: 2, standingAt: 0.58,
  plots: [
    { id: 1, crop: 'corn', points: 120, moisture: 0.4, harvests: 2, x: 0.3 },
    { id: 2, crop: 'tomato', points: 400, moisture: 0.2, harvests: 1, x: 0.7 },
    { id: 3, crop: 'pumpkin', points: 0, moisture: 0.9, harvests: 0, x: 0.5 },
    { id: 4, crop: null, points: 0, moisture: 0, harvests: 0, x: null },
  ],
  lastTickMs: clock,
};
await writeFile(join(legacyDir, 'farm', 'state.json'), JSON.stringify(v2), 'utf8');
const legacyWorld = new FarmWorld({ cfg: { ...cfg, overlayStatePath: join(legacyDir, 'ov.json') }, dataDir: legacyDir, botDir: dataDir, packageDir, now, random, timers, manageLayers: false });
await legacyWorld.start(host);
const migrated = JSON.parse(await readFile(legacyWorld.stateFile(), 'utf8'));
check('v2 存档迁移成 v3', migrated.v === 3 && migrated.coins === 275, 'v=' + migrated.v + ' coins=' + migrated.coins);
check('迁移后位置保留', migrated.plots.some((p) => Math.abs(p.x - 0.3) < 1e-9), migrated.plots.map((p) => p.x).join(','));
check('迁移后有背包/掉落物字段', migrated.inventory && Array.isArray(migrated.drops));
await legacyWorld.stop();

// --- 14. 旧存档里"进度满但等级没升"的玉米，启动时自动修复 -------------------
{
  const stuckDir = join(dataDir, 'stuck');
  await mkdir(join(stuckDir, 'farm'), { recursive: true });
  const st = newState(clock, cfg, random);
  st.plots = [{
    id: 1, crop: 'corn', x: 0.5, level: 4, growth: CROPS.corn.total,
    moisture: 0.8, harvests: 0, drySince: null, dead: false, ripeNotified: false,
  }];
  st.nextPlotId = 2;
  await writeFile(join(stuckDir, 'farm', 'state.json'), JSON.stringify(st), 'utf8');
  const stuckWorld = new FarmWorld({ cfg, dataDir: stuckDir, botDir: dataDir, packageDir, now, random, timers, manageLayers: false });
  await stuckWorld.start(host);
  const fixed = JSON.parse(await readFile(stuckWorld.stateFile(), 'utf8'));
  const cornPlot = fixed.plots[0];
  check('旧存档卡住的玉米启动时升到最高级', cornPlot.level === CROPS.corn.levels - 1, 'level=' + cornPlot.level);
  check('修复后的玉米算熟', isRipe(cornPlot) === true);
  await stuckWorld.stop();
}

await rm(dataDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通过，' + events.length + ' 个事件，' + logs.length + ' 条日志');
if (failed.length) { console.log('失败项：'); failed.forEach((f) => console.log('  - ' + f.name + ' ' + f.detail)); process.exit(1); }
