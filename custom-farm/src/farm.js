/**
 * 自定义农场的纯逻辑层：不碰文件、不碰定时器、不碰事件，全部是「状态进、状态出」的纯函数。
 *
 * 三条硬规则都来自用户：
 *  1) 作物可以种任意多，但**不能重叠**——间距按贴图宽度算（图层是统一缩放，所以像素宽 = 真实占位）。
 *  2) 熟了不发光；收割时产物**掉在地上**，桌宠得走过去捡，捡起来才进背包。
 *  3) 太久不浇水会**枯萎**；生长周期用真实配置数据（crops.js），有的作物能多次收获。
 */
import { CROPS, ROTATION } from './crops.js';
import { live } from './catalog-state.js';
import { CROP_PRICES, FURNITURE, FURNITURE_BY_ID, FURNITURE_ENABLED, SEEDS, SEED_BY_CROP, SEED_BY_ID, sellPriceOf, seedItemOf } from './shop.js';
import { DEFAULT_WEATHERS, normalizeWeathers, weatherFxOf } from './weather.js';

export const STATE_VERSION = 3;

/** 横向位置范围（占屏幕宽度的比例）。 */
export const X_MIN = 0.03;
export const X_MAX = 0.97;

/** 农田基准格数：48 格 = 满宽；最小 12 格。 */
export const FARM_BASE_CELLS = 48;
export const FARM_MIN_CELLS = 12;

/**
 * 可种植范围固定铺满可用底边（X_MIN..X_MAX）；farmCells 只控制整体视觉缩放。
 * 草地本身由图层循环铺满整条底边，不随格数变窄。
 */
export function farmBounds(cfg = DEFAULTS) {
  const cells = Math.min(FARM_BASE_CELLS, Math.max(FARM_MIN_CELLS, Math.round(Number(cfg.farmCells ?? FARM_BASE_CELLS))));
  return {
    min: X_MIN,
    max: X_MAX,
    width: X_MAX - X_MIN,
    center: 0.5,
    cells,
    cropScale: cells / FARM_BASE_CELLS,
  };
}

/** 视觉上“成块农田”的范围：居中，宽度 = 可种宽度 × cropScale；外面是野地，也可种。 */
export function farmPatch(cfg = DEFAULTS) {
  const b = farmBounds(cfg);
  const width = b.width * b.cropScale;
  return { min: 0.5 - width / 2, max: 0.5 + width / 2, width, cropScale: b.cropScale };
}
/** 拾取/收割的"够得着"半径（x 比例）。 */
export const REACH = 0.05;

export const DEFAULTS = {
  /** 安装目录：overlay / overlay-electron / assets 放在这里；空 = <dataDir>/custom-farm */
  installPath: '',
  /** 最多同时种几棵（屏幕上不重叠地放得下的上限） */
  maxPlants: 12,
  /** 屏幕逻辑宽度，用来把"像素宽"换算成 x 间距 */
  screenWidth: 2048,
  /** 图层的统一缩放倍率（所有作物同一个倍率，相对大小才跟贴图一致） */
  zoom: 2,
  /** 作物之间的最小额外像素间隔 */
  spriteGapPx: 4,
  /** 贴图间距倍率：1 = 贴图刚好不重叠；<1 更密，允许轻微重叠（默认 0.8） */
  cropGapScale: 0.8,
  /** 直接指定最小中心距（屏宽百分比）；0 = 用上面的倍率自动算，>0 覆盖 */
  cropGapPct: 2,
  /** 农作物/杂草贴图整体缩放：1 = 原大小；只放大/缩小植物，不影响地面 */
  cropScale: 1.5,
  /** 掉落物/收获物图标大小：1 = 原大 */
  dropScale: 0.6,
  /** 农田整体大小（格）：12~48，48 = 满宽；缩放草地/作物/野草，但可种范围始终满宽 */
  farmCells: 48,
  /** 地表露出的高度（屏幕像素）：越大地面越高，默认只到桌宠鞋底附近。 */
  groundHeight: 5,
  stripHeight: 320,
  /** 心情结算间隔（真实分钟）：每次按当前天气的 mood 影响结算一次 */
  moodIntervalMin: 10,
  startCoins: 120,
  /**
   * 游戏里 1 天给多少生长点：由 archives_tbplantdocument 的「成长天数」反推，
   * 土豆 1440/5、玉米 2304/8、南瓜 2592/9 等全部 = 288。
   */
  pointsPerDay: 288,
  /** 1 个游戏日 = 多少真实分钟（游戏客户端里的"一天多长"不在这几个资源包里，这里定） */
  realMinutesPerDay: 60,
  /**
   * 一次推进最多算几个游戏日。
   * 桌宠关掉、电脑睡眠/休眠、进程被挂起之后，第一次 tick 会把整段真实时间一次性补算——
   * 8 分钟一天时关机 5 小时就是 40 个游戏日：天数一下跳几十，水全干、作物全枯。
   * 默认 1：不在的那段时间最多补一天，天不会跳，田也不会一夜死光。
   */
  maxStepDays: 1,
  tickIntervalMs: 5000,
  /** 每个游戏日蒸发多少水分（0~1 口径）。0.15 ≈ 浇一次能撑 5.7 个游戏日 */
  dryPerDay: 0.15,
  /** 一次浇水补多少水分（1 = 浇满） */
  waterGain: 1.0,
  /** 土完全干透之后多久枯萎（游戏日） */
  wiltDays: 2.2,
  drynessBase: 0.3,
  drynessGain: 1.2,
  sowMoisture: 0.55,
  startMinute: 360,
  minutesPerDay: 1440,
  /** 空 = 自动按扩展位置推（<Pet>\overlay\runtime\state.json）；一般不用填 */
  overlayStatePath: '',
  overlayEnabled: true,
  hideFarm: false,
  weathers: DEFAULT_WEATHERS,
  /** 每天推一条"新的一天"事件（默认关：那是纯 token 消耗） */
  dailyEvent: false,
  /** 每个游戏日在空地长出一丛野草的概率 */
  weedPerDay: 0.55,
  /** 场上最多几丛野草野花 */
  maxWeeds: 46,
  /** 目标数量：开局/启动时补到这个数（铺满整条地表） */
  startWeeds: 42,
  /** 启动时把不够的数量补齐（true = 每次启动都补满） */
  weedFill: true,
  /** 野草每长一级要几个游戏日 */
  weedDaysPerLevel: 0.45,
  /** 播种时踩到多近的野草会被清掉（x 比例） */
  weedClearRadius: 0.03,
};

export const WEATHERS = ['晴', '晴', '多云'];

/**
 * 升级/新开局的种子包。
 * 新开局先发一包，再按老规矩种下开局 4 棵（品种正好是轮作表前 4 个）；
 * 老存档在 migrate 时补发一次（seedsGranted 标记，只发一次）。
 */
export const STARTER_SEEDS = Object.freeze({
  seed_potato: 3,
  seed_carrot: 1,
  seed_tomato: 1,
  seed_strawberry: 1,
});

export function grantStarterSeeds(state) {
  if (!state || state.seedsGranted) return false;
  state.inventory = { ...(state.inventory ?? {}) };
  for (const [id, n] of Object.entries(STARTER_SEEDS)) {
    state.inventory[id] = Number(state.inventory[id] ?? 0) + n;
  }
  state.seedsGranted = true;
  return true;
}

export function cropOf(key) {
  return CROPS[key] ?? CROPS[ROTATION[0]];
}

/**
 * 田地大事记：只记"这棵怎么没的"（收满次数拔掉 / 拔枯株 / 枯死 / 缩放删除 / 重种拔枯），
 * 让桌宠查 status 时能自己解释"田怎么空了"，而不是怀疑存档被清。
 */
export function pushFieldLog(state, entry) {
  if (!Array.isArray(state.fieldLog)) state.fieldLog = [];
  state.fieldLog.push({
    day: Math.round(Number(state.day) || 0),
    minute: Math.round(Number(state.minute) || 0),
    ...entry,
  });
  if (state.fieldLog.length > 40) state.fieldLog.splice(0, state.fieldLog.length - 40);
}

export function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

/** 浇透水（水分 >= 0.6）时生长加速 1.5 倍。 */
export function wetBonus(moisture) {
  return Number(moisture) >= 0.6 ? 1.5 : 1;
}

/** 这个位置附近有没有作物（用来判断哪里算空地）。 */
function occupied(state, x, gap) {
  return (state.plots ?? []).some((p) => Math.abs(Number(p.x) - Number(x)) < gap);
}

/** 目录还没加载时（纯函数测试）用的野草兜底定义。 */
const FALLBACK_WEED = {
  key: 'weed', name: '野草', stages: 4, days: [0.45, 0.45, 0.45], thresholds: [0.45, 0.9, 1.35],
  weight: 1, prefix: 'sprite_resource_weeds', frames: 4, sprites: [], item: null, itemName: '', value: 0, itemSprite: null, enabled: true,
};

/** 现存杂草的类型定义；老存档的 kind:'flower' 落到伊甸花。 */
export function weedTypeOf(weed) {
  const byType = weed?.type ? live.weeds?.[weed.type] : null;
  if (byType) return byType;
  if (weed?.kind === 'flower' && live.weeds?.eden_flower) return live.weeds.eden_flower;
  return live.weeds?.weed ?? live.weedTypes?.[0] ?? FALLBACK_WEED;
}

/** 杂草年龄（游戏日）-> 阶段。 */
export function weedLevelOf(type, age) {
  if (!type) return 0;
  const a = Math.max(0, Number(age) || 0);
  let lv = 0;
  for (let i = 0; i < (type.thresholds?.length ?? 0); i += 1) {
    if (a >= type.thresholds[i]) lv = i + 1; else break;
  }
  return Math.min(type.stages - 1, lv);
}

function pickWeedType(random) {
  const types = live.weedTypes ?? [];
  const total = types.reduce((a, t) => a + Number(t.weight || 0), 0);
  if (!types.length || total <= 0) return FALLBACK_WEED;
  let roll = random() * total;
  for (const t of types) {
    roll -= Number(t.weight || 0);
    if (roll <= 0) return t;
  }
  return types[types.length - 1];
}

/** 每个游戏日：空地有小概率冒出一丛野草；已有的野草慢慢长大。 */
export function growWeeds(state, cfg, gameDays, random) {
  const spawned = [];
  const grew = [];
  const max = Number(cfg.maxWeeds ?? DEFAULTS.maxWeeds);
  const b = farmBounds(cfg);
  let left = gameDays;
  while (left > 0 && (state.weeds ?? []).length < max) {
    const step = Math.min(left, 1);
    if (random() < Number(cfg.weedPerDay ?? DEFAULTS.weedPerDay) * step) {
      const type = pickWeedType(random);
      let x = 0;
      let ok = false;
      for (let i = 0; i < 8 && type; i += 1) {
        x = b.min + random() * (b.max - b.min);
        if (!occupied(state, x, 0.06) && !(state.weeds ?? []).some((w) => Math.abs(w.x - x) < 0.05)) { ok = true; break; }
      }
      if (ok && type) {
        const w = { id: state.nextWeedId++, x: round2(x), kind: 'weed', type: type.key, level: 0, age: 0 };
        state.weeds.push(w);
        spawned.push(w);
      }
    }
    left -= step;
  }
  for (const w of state.weeds ?? []) {
    const type = weedTypeOf(w);
    const before = Number(w.level ?? 0);
    w.age = Number(w.age ?? 0) + gameDays;
    const lvl = weedLevelOf(type, w.age);
    if (lvl !== before) { w.level = lvl; grew.push(w); }
  }
  return { spawned, grew };
}

/** 开局撒几丛野草（只在存档里一丛都没有时用）。 */
/**
 * 把野草野花铺到整条地表：按目标数量切成等宽的槽，每个槽里随机抖动一点。
 * 已经有的先留着，只补够数量（weedFill）。
 */
export function seedWeeds(state, cfg, random) {
  // 老存档可能没有这些字段（版本号没变时不会走 migrate）
  if (!Array.isArray(state.weeds)) state.weeds = [];
  if (!Number.isFinite(state.nextWeedId)) state.nextWeedId = 1;
  let want = Math.max(0, Number(cfg.startWeeds ?? 0));
  const fill = Boolean(cfg.weedFill);
  if (want <= 0) return [];
  if (!fill && state.weeds.length > 0) return [];

  const made = [];
  const b = farmBounds(cfg);
  const slotW = (b.max - b.min) / want;
  for (let i = 0; i < want; i += 1) {
    if (state.weeds.length >= want) break;
    const base = b.min + slotW * (i + 0.5);
    const jitter = (random() - 0.5) * slotW * 0.8;
    const x = round2(Math.min(b.max, Math.max(b.min, base + jitter)));
    // 已经有东西挨着这个槽就跳过（作物/已有野草）
    if (occupied(state, x, 0.034)) continue;
    if (state.weeds.some((w) => Math.abs(w.x - x) < 0.012)) continue;
    const type = pickWeedType(random);
    if (!type) continue;
    const lvl = Math.min(type.stages - 1, Math.floor(random() * type.stages));
    const baseAge = lvl === 0 ? 0 : (type.thresholds[lvl - 1] ?? 0);
    const span = lvl >= type.stages - 1 ? 0 : (type.days[lvl] ?? 0.45);
    const age = round2(baseAge + random() * span * 0.95);
    const w = { id: state.nextWeedId++, x, kind: 'weed', type: type.key, level: lvl, age };
    state.weeds.push(w);
    made.push(w);
  }
  return made;
}


/**
 * 农田整体大小（格）变化：以屏幕中心为中线，草地/作物/野草贴图一起缩放。
 * - 所有作物/野草位置按同一比例围绕 0.5 缩放（桌宠按新 x 找）；
 * - 缩放后 x 落到可种范围外的作物删除并退 1 包种子；
 * - 缩小时新露出的边缘野地补杂草（可种）。
 */
export function applyFarmSize(state, cfg = DEFAULTS, random = Math.random) {
  const oldCells = Math.min(FARM_BASE_CELLS, Math.max(FARM_MIN_CELLS, Math.round(Number(state.farmCells ?? FARM_BASE_CELLS))));
  const newCells = Math.min(FARM_BASE_CELLS, Math.max(FARM_MIN_CELLS, Math.round(Number(cfg.farmCells ?? FARM_BASE_CELLS))));
  const oldScale = oldCells / FARM_BASE_CELLS;
  const newScale = newCells / FARM_BASE_CELLS;
  const ratio = newScale / oldScale;
  const out = {
    changed: oldCells !== newCells,
    oldCells,
    newCells,
    cropScale: newScale,
    removed: [],
    refunded: 0,
    weedsRemoved: 0,
    weedsAdded: 0,
  };
  if (!out.changed) return out;
  if (!Array.isArray(state.plots)) state.plots = [];
  if (!Array.isArray(state.weeds)) state.weeds = [];
  if (!Number.isFinite(state.nextWeedId)) state.nextWeedId = 1;
  const map = (x) => 0.5 + (Number(x) - 0.5) * ratio;
  const onFarm = (x) => x >= X_MIN - 1e-9 && x <= X_MAX + 1e-9;

  const kept = [];
  for (const p of state.plots) {
    const nx = map(p.x);
    if (!onFarm(nx)) {
      out.removed.push(p.id);
      pushFieldLog(state, { kind: 'resize', id: p.id, crop: p.crop, x: p.x });
      if (p.crop) {
        const seedId = seedItemOf(p.crop);
        state.inventory = state.inventory ?? {};
        state.inventory[seedId] = Number(state.inventory[seedId] ?? 0) + 1;
        out.refunded += 1;
      }
      if (state.current === p.id) state.current = null;
      continue;
    }
    p.x = round2(nx);
    kept.push(p);
  }
  state.plots = kept;

  const beforeWeeds = state.weeds.length;
  const weeds = [];
  for (const w of state.weeds) {
    const nx = map(w.x);
    if (!onFarm(nx)) continue;
    w.x = round2(nx);
    weeds.push(w);
  }
  state.weeds = weeds;
  out.weedsRemoved = beforeWeeds - state.weeds.length;

  // 缩小时，新露出的两侧野地补草（这些地方也能种）
  if (ratio < 1 - 1e-9) {
    const contentW = (X_MAX - X_MIN) * newScale;
    const leftEnd = 0.5 - contentW / 2;
    const rightStart = 0.5 + contentW / 2;
    const slots = [[X_MIN, leftEnd], [rightStart, X_MAX]].filter(([a, b]) => b > a + 1e-9);
    const want = Math.max(0, Math.round(Number(cfg.startWeeds ?? 42) * (X_MAX - X_MIN) * (oldScale - newScale)));
    const maxWeeds = Number(cfg.maxWeeds ?? 46);
    let left = Math.min(want, Math.max(0, maxWeeds - state.weeds.length));
    let guard = left * 12 + 20;
    while (left > 0 && slots.length > 0 && guard > 0) {
      guard -= 1;
      const slot = slots[Math.floor(random() * slots.length)];
      const x = round2(slot[0] + random() * (slot[1] - slot[0]));
      if (occupied(state, x, 0.06)) continue;
      if (state.weeds.some((w) => Math.abs(Number(w.x) - x) < 0.03)) continue;
      const type = pickWeedType(random);
      if (!type) break;
      const lvl = Math.min(type.stages - 1, Math.floor(random() * type.stages));
      const baseAge = lvl === 0 ? 0 : (type.thresholds[lvl - 1] ?? 0);
      const span = lvl >= type.stages - 1 ? 0 : (type.days[lvl] ?? 0.45);
      state.weeds.push({
        id: state.nextWeedId++,
        x,
        kind: 'weed',
        type: type.key,
        level: lvl,
        age: round2(baseAge + random() * span * 0.95),
      });
      left -= 1;
      out.weedsAdded += 1;
    }
  }

  if (Array.isArray(state.drops)) {
    const drops = [];
    for (const d of state.drops) {
      const nx = map(d.x);
      if (!onFarm(nx)) continue;
      d.x = round2(nx);
      drops.push(d);
    }
    state.drops = drops;
  }

  if (Number.isFinite(Number(state.standingAt))) {
    const nx = map(state.standingAt);
    state.standingAt = round2(Math.min(X_MAX, Math.max(X_MIN, nx)));
  }

  state.farmCells = newCells;
  state.lastMessage = '农田 ' + oldCells + ' → ' + newCells + ' 格（整体缩放）' +
    (out.removed.length ? '，移除了 ' + out.removed.length + ' 棵（退 ' + out.refunded + ' 包种子）' : '') +
    (out.weedsRemoved ? '，清掉 ' + out.weedsRemoved + ' 丛界外野草' : '') +
    (out.weedsAdded ? '，新野地补了 ' + out.weedsAdded + ' 丛野草' : '') + '。';
  return out;
}


export function moistureFactor(moisture, cfg = DEFAULTS) {
  return cfg.drynessBase + cfg.drynessGain * clamp01(moisture);
}

/** 每级需要攒多少生长点（四舍五入；最后一级以 total 为准，见 levelOf）。 */
export function levelSpan(crop) {
  return Math.max(1, Math.round(Number(crop.total) / Math.max(1, Number(crop.levels) - 1)));
}

/**
 * 生长点 -> 等级（0 .. levels-1）。
 *
 * 新目录（catalog）会给每种作物编译出 thresholds（每个阶段的累计生长点）；有 thresholds 就按它走。
 * 没有 thresholds 的（单元测试里直接 newState 的内置作物）退回旧的四舍五入 span 算法，
 * 保留老存档的等级不变；同时用 total 兜底，避免玉米 5×461 > 2304 永远到不了最高级。
 */
export function levelOf(crop, growth) {
  const g = Math.max(0, Number(growth));
  const total = Number(crop.total);
  if (Array.isArray(crop.thresholds) && crop.thresholds.length) {
    if (Number.isFinite(total) && total > 0 && g >= total) return crop.levels - 1;
    let lv = 0;
    for (let i = 0; i < crop.thresholds.length; i += 1) {
      if (g >= crop.thresholds[i]) lv = i + 1; else break;
    }
    return Math.max(0, Math.min(crop.levels - 1, lv));
  }
  if (Number.isFinite(total) && total > 0 && g >= total) return crop.levels - 1;
  const span = levelSpan(crop);
  const lv = Math.floor(g / span);
  return Math.max(0, Math.min(crop.levels - 1, lv));
}

/** 到某个等级所需的累计生长点；最后一级正好是 total（不会超过总生长点）。 */
export function growthForLevel(crop, level) {
  const lv = Math.max(0, Math.min(crop.levels - 1, Number(level)));
  if (Array.isArray(crop.thresholds) && crop.thresholds.length) {
    if (lv >= crop.levels - 1) return Number(crop.total);
    return lv <= 0 ? 0 : Number(crop.thresholds[lv - 1]);
  }
  if (lv >= crop.levels - 1) return Number(crop.total);
  return Math.round(levelSpan(crop) * lv);
}

export function isRipe(plot) {
  const crop = cropOf(plot.crop);
  return !plot.dead && plot.level >= crop.levels - 1;
}

/** 贴图占位宽度（像素）：统一缩放后就是屏幕上的真实宽度。 */
export function spriteWidth(crop) {
  return Number(crop.spriteW ?? 24);
}

/** 两棵作物之间的最小 x 间距，按贴图宽度换算（跟随农田整体缩放）。 */
export function minGapX(aCrop, bCrop, cfg = DEFAULTS) {
  const cs = farmBounds(cfg).cropScale;
  const direct = Number(cfg.cropGapPct ?? 0);
  if (Number.isFinite(direct) && direct > 0) return (direct / 100) * cs;
  const scale = Number(cfg.cropGapScale ?? DEFAULTS.cropGapScale);
  const px = ((spriteWidth(aCrop) + spriteWidth(bCrop)) / 2) * cfg.zoom * scale + cfg.spriteGapPx;
  return (px / cfg.screenWidth) * cs;
}

/** 这个 x 位置能不能种；不能的话给一句能照着改的话。 */
export function checkSpot(state, x, cropKey, cfg = DEFAULTS, ignoreId = null) {
  const v = Number(x);
  const b = farmBounds(cfg);
  if (!Number.isFinite(v)) return { ok: false, reason: 'x 要是 0~1 之间的数字（0 最左，1 最右）。' };
  if (v < b.min || v > b.max) {
    return { ok: false, reason: 'x 只能落在农田内（' + Math.round(b.min * 100) + '%~' + Math.round(b.max * 100) + '%）。' };
  }
  if (state.plots.length >= cfg.maxPlants) {
    return { ok: false, reason: '已经种满 ' + cfg.maxPlants + ' 棵了，先收掉几棵再种。' };
  }
  const crop = cropOf(cropKey);
  for (const p of state.plots) {
    if (p.id === ignoreId) continue;
    const gap = minGapX(crop, cropOf(p.crop), cfg);
    if (Math.abs(Number(p.x) - v) < gap) {
      return {
        ok: false,
        reason: Math.round(v * 100) + '% 会和 ' + p.id + ' 号地（' + cropOf(p.crop).name + '，在 ' +
          Math.round(Number(p.x) * 100) + '%）叠在一起；这两棵至少要隔 ' + Math.round(gap * 100) + '% 的屏幕宽。',
      };
    }
  }
  return { ok: true };
}

/** 随机挑一个不重叠的位置（试 40 次，挑离得最开的那个）。 */
export function pickSpot(state, cropKey, cfg = DEFAULTS, random = Math.random) {
  const b = farmBounds(cfg);
  let best = null;
  let bestGap = -1;
  for (let i = 0; i < 40; i += 1) {
    const x = round2(b.min + (b.max - b.min) * random());
    const verdict = checkSpot(state, x, cropKey, cfg);
    if (verdict.ok) return x;
    const nearest = state.plots.reduce((m, p) => Math.min(m, Math.abs(Number(p.x) - x)), 1);
    if (nearest > bestGap) { bestGap = nearest; best = x; }
  }
  return best ?? round2((b.min + b.max) / 2);
}

function newPlot(id, cropKey, x, cfg) {
  return {
    id,
    crop: cropKey,
    x: round2(x),
    level: 0,
    growth: 0,
    moisture: cfg.sowMoisture,
    harvests: 0,
    drySince: null,
    dead: false,
    ripeNotified: false,
  };
}

export function newState(nowMs = Date.now(), cfg = DEFAULTS, random = Math.random) {
  const state = {
    v: STATE_VERSION,
    day: 1,
    minute: cfg.startMinute,
    coins: cfg.startCoins,
    weather: '无风',
    weatherId: 'calm',
    weatherUntil: 0,
    weatherFx: weatherFxOf(DEFAULT_WEATHERS[0]),
    plots: [],
    drops: [],
    inventory: {},
    fx: [],
    current: null,
    standingAt: null,
    nextPlotId: 1,
    nextDropId: 1,
    nextFxId: 1,
    rotationIndex: 0,
    elapsedDays: 0,
    furniture: [],
    weeds: [],
    nextWeedId: 1,
    nextFurnitureId: 1,
    pendingPlace: null,
    lastMessage: '',
    fieldLog: [],
    states: {},
    stateActions: {},
    lastTickMs: nowMs,
    seedsGranted: false,
    farmCells: Number(cfg.farmCells ?? FARM_BASE_CELLS),
    screenWidth: Number(cfg.screenWidth ?? 2048),
  };
  // 新开局先发一包种子，再种下开局 4 棵（它们会消耗掉其中 4 包）
  grantStarterSeeds(state);
  for (let i = 0; i < 4 && ROTATION.length > 0; i += 1) {
    const key = ROTATION[i % ROTATION.length];
    try { plant(state, { crop: key, cfg, random }); } catch { break; }
  }
  return state;
}

/** 播种：crop 不填就按轮作表挑一个，x 不填就随机挑空位。 */
export function plant(state, { x, crop, cfg = DEFAULTS, random = Math.random } = {}) {
  const key = crop && CROPS[crop] ? crop : ROTATION[state.rotationIndex % ROTATION.length];
  if (!crop || !CROPS[crop]) state.rotationIndex += 1;
  const spot = (x === undefined || x === null || x === '') ? pickSpot(state, key, cfg, random) : Number(x);
  const verdict = checkSpot(state, spot, key, cfg);
  if (!verdict.ok) throw new Error(verdict.reason);
  // 种子：种一棵消耗 1 包；种子买来先进背包（inventory[seed_id]）
  const seed = SEED_BY_CROP[key];
  const seedId = seed?.id ?? seedItemOf(key);
  const have = Number(state.inventory?.[seedId] ?? 0);
  if (have < 1) {
    const alt = SEEDS.filter((s) => s.crop !== key).slice().sort((a, b) => a.buy - b.buy)[0];
    throw new Error(
      '没有' + (CROPS[key]?.name ?? key) + '种子（' + seedId + (seed ? '，' + seed.buy + ' 金币/包' : '') + '）。' +
      '自己补 1~2 包：' + (alt ? '或者先种' + alt.name.replace(/种子$/, '') + '（' + alt.buy + ' 金币/包）；' : '') +
      '买的话 farm_buy {id:"' + seedId + '", count:1}。',
    );
  }
  // 播种会把脚下这丛野草铲掉（图层放破坏特效）
  const broken = [];
  const radius = Number(cfg.weedClearRadius ?? DEFAULTS.weedClearRadius);
  state.weeds = (state.weeds ?? []).filter((w) => {
    if (Math.abs(Number(w.x) - Number(spot)) < radius) { broken.push(w); return false; }
    return true;
  });
  if (broken.length) pushFx(state, { kind: 'weedBreak', x: broken[0].x, level: broken[0].level });
  const plot = newPlot(state.nextPlotId++, key, spot, cfg);
  state.plots.push(plot);
  state.inventory[seedId] = have - 1;
  if (state.inventory[seedId] <= 0) delete state.inventory[seedId];
  pushFx(state, { kind: 'plant', x: spot, plot: plot.id });
  return plot;
}

/**
 * 播种前把脚下枯掉的植株清掉（默认行为：桌宠不用为一棵枯株单独 farm_pull）。
 * 只动 REACH 范围内、确实枯了的；返回清掉几棵，并记进田地大事记。
 */
export function removeDeadAt(state, x) {
  const here = Number(x);
  if (!Number.isFinite(here) || !Array.isArray(state.plots)) return 0;
  const gone = state.plots.filter((p) => p.dead && Math.abs(Number(p.x) - here) <= REACH);
  if (gone.length === 0) return 0;
  state.plots = state.plots.filter((p) => !gone.includes(p));
  for (const p of gone) pushFieldLog(state, { kind: 'replant', id: p.id, crop: p.crop, x: p.x });
  return gone.length;
}

export function clockText(minute) {
  const m = ((Math.floor(minute) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/**
 * 推进一段时间。直接改传入的 state，返回这期间发生了什么。
 * @returns {{becameRipe:number[], becameDry:number[], newDay:boolean, wilted:number[], cappedDays:number}}
 */
/** 比较运算，只给自定义状态的条件用。 */
export const STATE_OPS = ['<', '<=', '>', '>=', '==', '!='];

export function compareValue(left, op, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  switch (op) {
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}

/**
 * 自定义状态：数值状态按 driftPerDay 漂移，开关状态由条件规则决定。
 * 定义（defs/rules）来自 custom.json，当前值存在存档的 state.states 里。
 * @returns 变化列表（{id, from, to}）；没有定义时清空。
 */
export function tickStates(state, defs = [], rules = [], gameDays = 0) {
  const list = Array.isArray(defs) ? defs : [];
  if (!list.length) {
    if (state.states) state.states = {};
    return [];
  }
  if (!state.states || typeof state.states !== 'object') state.states = {};
  const byId = new Map(list.map((d) => [d.id, d]));
  for (const id of Object.keys(state.states)) if (!byId.has(id)) delete state.states[id];

  const changes = [];
  const days = Math.max(0, Number(gameDays) || 0);
  for (const def of list) {
    const cur = state.states[def.id] ?? {};
    if (def.kind === 'flag') {
      const from = Boolean(cur.active ?? def.initialActive);
      state.states[def.id] = { active: from };
      continue;
    }
    const min = Number(def.min ?? 0);
    const max = Number(def.max ?? 100);
    let value = Number(cur.value);
    if (!Number.isFinite(value)) value = Number(def.initial ?? max);
    const drift = Number(def.driftPerDay ?? 0);
    if (days > 0 && Number.isFinite(drift) && drift !== 0) value += drift * days;
    value = Math.min(max, Math.max(min, value));
    const from = Number(cur.value);
    state.states[def.id] = { value: round2(value) };
    if (!Number.isFinite(from) || round2(from) !== round2(value)) {
      changes.push({ id: def.id, from: Number.isFinite(from) ? round2(from) : null, to: round2(value) });
    }
  }

  const ruleList = Array.isArray(rules) ? rules : [];
  const targets = new Set(ruleList.map((r) => r.target));
  for (const target of targets) {
    const def = byId.get(target);
    if (!def || def.kind !== 'flag') continue;
    const from = Boolean(state.states[target]?.active ?? def.initialActive);
    const active = ruleList.some((r) => r.target === target && compareValue(state.states[r.source]?.value, r.op, r.value));
    state.states[target] = { active };
    if (from !== active) changes.push({ id: target, from, to: active });
  }
  return changes;
}

/**
 * 消耗行为：触发状态生效（开关 active / 数值 > 0）且冷却到了，就从 items 里按顺序拿 count 个，
 * 再把 effectDelta 加到 effectState（通常用来把饱食度吃回来）。
 * auto=false 时只返回一条“该吃了”的提示，不动背包。
 * 返回本次发生的事，World 负责推事件和保存。
 */
export function consumeActions(state, defs = [], rules = [], actions = [], elapsedDays = state.elapsedDays, onlyTriggers = null) {
  const out = [];
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) return out;
  const defList = Array.isArray(defs) ? defs : [];
  const byId = new Map(defList.map((d) => [d.id, d]));
  if (!state.inventory || typeof state.inventory !== 'object') state.inventory = {};
  if (!state.stateActions || typeof state.stateActions !== 'object') state.stateActions = {};
  const now = Number(elapsedDays) || 0;
  let touched = false;

  for (const action of list) {
    if (!action || action.enabled === false) continue;
    const trigger = byId.get(action.trigger);
    if (!trigger) continue;
    const cur = state.states?.[action.trigger] ?? {};
    const active = trigger.kind === 'flag' ? Boolean(cur.active) : Number(cur.value) > 0;
    if (!active) continue;
    if (onlyTriggers && !onlyTriggers.has(action.trigger)) continue;
    const last = Number(state.stateActions[action.id]?.lastAt);
    if (Number.isFinite(last) && now - last < Number(action.cooldownDays ?? 0.5)) continue;

    const items = (Array.isArray(action.items) ? action.items : []).filter((id) => (
      Number(state.inventory[id] ?? 0) > 0 && live.items?.[id]?.consumable !== false
    ));
    if (!items.length) {
      state.stateActions[action.id] = { lastAt: now };
      touched = true;
      out.push({ action, triggerName: trigger.name, missing: true });
      continue;
    }

    const item = items[0];
    const want = Math.max(1, Math.min(99, Math.round(Number(action.count ?? 1))));
    if (action.auto === false) {
      state.stateActions[action.id] = { lastAt: now };
      touched = true;
      out.push({
        action, triggerName: trigger.name, promptOnly: true, item,
        itemName: live.names?.[item] ?? item, count: want,
      });
      continue;
    }

    const have = Number(state.inventory[item] ?? 0);
    const take = Math.min(have, want);
    state.inventory[item] = have - take;
    if (state.inventory[item] <= 0) delete state.inventory[item];
    // 道具自己的效果优先；没配才退回消耗行为上的 effectState/effectDelta
    const itemDef = live.items?.[item];
    const effectSpec = Array.isArray(itemDef?.effects) && itemDef.effects.length
      ? itemDef.effects
      : (action.effectState ? [{ state: action.effectState, delta: action.effectDelta }] : []);
    const effects = [];
    for (const spec of effectSpec) {
      const ed = byId.get(spec.state);
      if (!ed || ed.kind !== 'number') continue;
      const before = Number(state.states?.[ed.id]?.value ?? ed.initial);
      const after = Math.min(Number(ed.max), Math.max(Number(ed.min), before + Number(spec.delta ?? 0) * take));
      state.states[ed.id] = { value: round2(after) };
      effects.push({ id: ed.id, name: ed.name, delta: round2(after - before), value: round2(after), max: ed.max });
    }
    state.stateActions[action.id] = { lastAt: now };
    touched = true;
    out.push({
      action, triggerName: trigger.name, item, itemName: live.names?.[item] ?? item,
      count: take, effects, effect: effects[0] ?? null, auto: true,
    });
  }
  if (touched) tickStates(state, defList, rules, 0);
  return out;
}

export function advance(state, nowMs, cfg = DEFAULTS, random = Math.random) {
  const out = { becameRipe: [], becameDry: [], newDay: false, wilted: [], cappedDays: 0 };
  const last = Number.isFinite(state.lastTickMs) ? state.lastTickMs : nowMs;
  const dtMs = Math.max(0, nowMs - last);
  state.lastTickMs = nowMs;
  if (dtMs <= 0) return out;

  // 1 个游戏日 = realMinutesPerDay 真实分钟 -> 1 真实秒 = 1440/(realMinutesPerDay*60) 游戏分钟
  const gameMinutesPerSecond = 1440 / (cfg.realMinutesPerDay * 60);
  const rawGameMinutes = (dtMs / 1000) * gameMinutesPerSecond;
  if (rawGameMinutes <= 0) return out;
  // 关机/睡眠后不把整段时间一次补完：最多推进 maxStepDays 个游戏日。
  const stepCap = Math.max(0.01, Number(cfg.maxStepDays ?? DEFAULTS.maxStepDays)) * 1440;
  const gameMinutes = Math.min(rawGameMinutes, stepCap);
  out.cappedDays = Math.round(((rawGameMinutes - gameMinutes) / 1440) * 100) / 100;
  const gameDays = gameMinutes / 1440;
  // 时钟 state.minute 每天会回绕，算"过了多久"必须用单调累计的天数
  state.elapsedDays = (Number.isFinite(state.elapsedDays) ? state.elapsedDays : 0) + gameDays;

  // 空地上长野草（每天一个小概率），已有的慢慢长大
  if (gameDays > 0) growWeeds(state, cfg, gameDays, random);

  let minute = state.minute + gameMinutes;
  const startMinute = Number(cfg.startMinute ?? DEFAULTS.startMinute);
  const minutesPerDay = Math.max(1, Number(cfg.minutesPerDay ?? DEFAULTS.minutesPerDay));
  while (minute >= startMinute + minutesPerDay) {
    minute -= minutesPerDay;
    state.day += 1;
    out.newDay = true;
    state.weather = WEATHERS[Math.floor(random() * WEATHERS.length)];
  }
  state.minute = minute;

  for (const plot of state.plots) {
    if (plot.dead) continue;
    const crop = cropOf(plot.crop);

    // 水分
    plot.moisture = clamp01(plot.moisture - cfg.dryPerDay * gameDays);
    if (plot.moisture < 0.15 && !plot.dryNotified) { plot.dryNotified = true; out.becameDry.push(plot.id); }
    if (plot.moisture >= 0.3) plot.dryNotified = false;
    if (plot.moisture <= 0.001) {
      if (plot.drySince === null) plot.drySince = state.elapsedDays;
      else if (state.elapsedDays - plot.drySince >= cfg.wiltDays) {
        plot.dead = true;
        out.wilted.push(plot.id);
        pushFieldLog(state, { kind: 'wilt', id: plot.id, crop: plot.crop, x: plot.x });
        continue;
      }
    } else {
      plot.drySince = null;
    }

    // 生长
    if (plot.level >= crop.levels - 1) continue;
    const before = plot.level;
    plot.growth = Math.min(crop.total, plot.growth + cfg.pointsPerDay * gameDays * moistureFactor(plot.moisture, cfg) * wetBonus(plot.moisture));
    plot.level = levelOf(crop, plot.growth);
    if (plot.level === crop.levels - 1 && before < crop.levels - 1 && !plot.ripeNotified) {
      plot.ripeNotified = true;
      out.becameRipe.push(plot.id);
    }
  }
  if (Array.isArray(cfg.stateDefs) && cfg.stateDefs.length) {
    out.stateChanges = tickStates(state, cfg.stateDefs, cfg.stateRules, gameDays);
  }
  return out;
}

/** 浇一棵或全部（不填 plotId 就全浇）。 */
/** 把枯掉的作物拔掉（桌宠要走到跟前）。返回被拔掉的那棵。 */
export function pull(state, cfg, plotId) {
  const id = Number(plotId);
  const plot = (state.plots ?? []).find((p) => Number(p.id) === id);
  if (!plot) throw new Error(id + ' 号地没有作物。');
  if (!plot.dead) throw new Error(id + ' 号地的' + cropOf(plot.crop).name + '还活着，不能拔。');
  state.plots = state.plots.filter((p) => Number(p.id) !== id);
  pushFx(state, { kind: 'pull', x: plot.x, plot: id });
  pushFieldLog(state, { kind: 'pull', id, crop: plot.crop, x: plot.x });
  return { id, crop: cropOf(plot.crop).name, x: plot.x };
}

/**
 * 一次浇水覆盖哪几棵：以"浇水的那一点"为中心，REACH 半径内的活作物全浇。
 *  - 不给 plot：中心 = 你站的位置 at
 *  - 给 plot：中心 = 那棵的位置（你已经站在它跟前了），旁边的也一起浇
 * 返回 id 列表；plot 给了但不存在时返回 null。
 */
export function waterTargets(plots, at, plotId = null, reach = REACH) {
  const alive = (plots ?? []).filter((p) => !p.dead);
  let center = Number(at);
  if (plotId !== null && plotId !== undefined) {
    const target = alive.find((p) => Number(p.id) === Number(plotId));
    if (!target) return null;
    center = Number(target.x);
  }
  if (!Number.isFinite(center)) return [];
  return alive.filter((p) => Math.abs(Number(p.x) - center) <= reach).map((p) => Number(p.id));
}

/** 浇一棵或全部（不填 plotId 就全浇）；已经浇透的会跳过，不重复播特效。 */
export function water(state, cfg = DEFAULTS, plotId = null) {
  const result = { plots: [], fx: [], skipped: [] };
  for (const plot of state.plots) {
    if (plotId !== null && plot.id !== Number(plotId)) continue;
    if (plot.dead) continue;
    const before = plot.moisture;
    if (Number(before) >= 0.999) {
      result.skipped.push({ id: plot.id, crop: cropOf(plot.crop).name, moisture: Number(before) });
      continue;
    }
    plot.moisture = clamp01(plot.moisture + cfg.waterGain);
    plot.drySince = null;
    result.plots.push({ id: plot.id, crop: cropOf(plot.crop).name, moistureBefore: before, moistureAfter: plot.moisture });
    result.fx.push(pushFx(state, { kind: 'water', x: plot.x, plot: plot.id }));
  }
  return result;
}

function pushFx(state, fx) {
  const item = { id: state.nextFxId++, atMinute: state.minute, ...fx };
  state.fx.push(item);
  if (state.fx.length > 12) state.fx.splice(0, state.fx.length - 12);
  return item;
}

/**
 * 收割：产物先掉在地上（drops），不进背包——桌宠得走过去 collect。
 * 多次收获的作物收完退回 repeatLevel；次数用完就拔掉。
 */
export function harvest(state, cfg = DEFAULTS, plotId = null, random = Math.random) {
  const result = { harvested: [], removed: [], drops: [] };
  const targets = [];
  if (plotId !== null) {
    const one = state.plots.find((p) => p.id === Number(plotId));
    if (one) targets.push(one);
  } else {
    targets.push(...state.plots.filter((p) => isRipe(p)));
  }
  for (const plot of targets) {
    if (plot.dead) continue;
    if (!isRipe(plot)) continue;
    const crop = cropOf(plot.crop);
    plot.harvests += 1;
    // 产量范围来自游戏表 crop_outputs（番茄/草莓 2~4、玉米 2、南瓜 1 等）
    const lo = Number(crop.minCount ?? 1);
    const hi = Math.max(lo, Number(crop.maxCount ?? lo));
    const count = lo + Math.floor(random() * (hi - lo + 1));
    // 收获时产物往左右随机弹一小段
    const dirSign = random() < 0.5 ? -1 : 1;
    const dist = 0.012 + random() * 0.028;
    const b = farmBounds(cfg);
    const landX = round2(Math.min(b.max, Math.max(b.min, Number(plot.x) + dirSign * dist)));
    const drop = {
      id: state.nextDropId++,
      plot: plot.id,
      crop: crop.key,
      item: crop.items[0] ?? crop.key,
      fromX: Number(plot.x),
      x: landX,
      count,
      name: crop.name,
      sprite: crop.itemSprite ?? 'icon_item_soil',
    };
    state.drops.push(drop);
    result.drops.push(drop);
    result.harvested.push({ id: plot.id, crop: crop.name, item: drop.item, x: landX, fromX: Number(plot.x), count, sprite: drop.sprite });
    pushFx(state, { kind: 'harvest', x: plot.x, plot: plot.id });

    if (plot.harvests >= crop.lifespan) {
      result.removed.push(plot.id);
      pushFieldLog(state, { kind: 'harvest', id: plot.id, crop: plot.crop, x: plot.x, times: plot.harvests });
    } else {
      plot.level = Math.min(crop.levels - 1, crop.repeatLevel);
      plot.growth = growthForLevel(crop, plot.level);
      plot.ripeNotified = false;
    }
  }
  if (result.removed.length) {
    state.plots = state.plots.filter((p) => !result.removed.includes(p.id));
    if (result.removed.includes(state.current)) state.current = null;
  }
  return result;
}

/**
 * 收一丛长成的杂草（只有配了收获物和价值的杂草才收得动）。
 * 产物同样掉在地上，要用 collect 捡。返回被收掉的杂草和掉落物。
 */
export function harvestWeed(state, cfg = DEFAULTS, weedId = null, random = Math.random) {
  const weed = (state.weeds ?? []).find((w) => Number(w.id) === Number(weedId));
  if (!weed) throw new Error(weedId + ' 号没有杂草。');
  const type = weedTypeOf(weed);
  if (!type) throw new Error('这丛杂草没有可用的类型。');
  const lv = Number(weed.level ?? 0);
  if (lv < type.stages - 1) {
    throw new Error(type.name + ' 还没长成（' + (lv + 1) + '/' + type.stages + ' 阶段），等它长到最高阶段再收。');
  }
  if (!type.item || Number(type.value) <= 0) {
    throw new Error(type.name + ' 没有可收的产物；走过去 farm_plant 会把它铲掉。');
  }
  const dirSign = random() < 0.5 ? -1 : 1;
  const dist = 0.012 + random() * 0.028;
  const b = farmBounds(cfg);
  const landX = round2(Math.min(b.max, Math.max(b.min, Number(weed.x) + dirSign * dist)));
  const drop = {
    id: state.nextDropId++,
    plot: null,
    crop: type.key,
    item: type.item,
    fromX: Number(weed.x),
    x: landX,
    count: 1,
    name: type.itemName || type.name,
    sprite: type.itemSprite ?? null,
  };
  state.weeds = state.weeds.filter((w) => w !== weed);
  state.drops.push(drop);
  pushFx(state, { kind: 'harvest', x: weed.x, plot: weed.id });
  pushFieldLog(state, { kind: 'weedHarvest', id: weed.id, crop: type.key, x: weed.x });
  return { weed: { id: weed.id, name: type.name, x: Number(weed.x) }, drop };
}

/** 把够得着的掉落物收进背包。 */
export function collect(state, cfg = DEFAULTS, at = null) {
  const here = Number.isFinite(Number(at)) ? Number(at) : Number(state.standingAt);
  if (!Number.isFinite(here)) throw new Error('不知道你在哪：先走到掉落物旁边，farm_stand 时把 at 报上来。');
  const taken = [];
  const stay = [];
  for (const drop of state.drops) {
    if (Math.abs(Number(drop.x) - here) <= REACH) taken.push(drop);
    else stay.push(drop);
  }
  if (taken.length === 0) {
    const list = state.drops.map((d) => Math.round(Number(d.x) * 100) + '%（' + cropOf(d.crop).name + '）').join('、');
    throw new Error('你站的地方（' + Math.round(here * 100) + '%）附近没有掉落物。' +
      (list ? '地上还有：' + list + '。' : '地上什么都没有。'));
  }
  for (const drop of taken) {
    state.inventory[drop.item] = (state.inventory[drop.item] ?? 0) + drop.count;
    pushFx(state, { kind: 'collect', x: drop.x, toX: here, item: drop.item, count: drop.count });
  }
  state.drops = stay;
  return { collected: taken, at: here };
}

/** 站到某个位置；plotId 可选（给了就顺便校验离那块地够近）。 */
export function stand(state, plotId, at, cfg = DEFAULTS) {
  const here = Number(at);
  if (!Number.isFinite(here) || here < -0.02 || here > 1.02) {
    throw new Error('at 要是 0~1 之间的位置（pet_move_to 回来的百分比 / 100）。');
  }
  if (plotId !== null && plotId !== undefined && plotId !== '') {
    const plot = state.plots.find((p) => p.id === Number(plotId));
    if (!plot) throw new Error('没有 ' + plotId + ' 号地了（可能已经收掉或者枯萎拔掉了）。');
    if (Math.abs(here - Number(plot.x)) > Math.max(REACH, minGapX(cropOf(plot.crop), cropOf(plot.crop), cfg))) {
      throw new Error('你说你在 ' + Math.round(here * 100) + '%，但 ' + plot.id + ' 号地在 ' +
        Math.round(Number(plot.x) * 100) + '%。先 pet_move_to { x: ' + Number(plot.x).toFixed(2) + ' } 走过去再回来。');
    }
    state.current = plot.id;
  }
  state.standingAt = round2(here);
  return state;
}

/** 找不到"脚下这棵"时的兜底：离 at 最近且在够得着范围内的。 */
export function nearestPlot(state, at = null) {
  const here = Number.isFinite(Number(at)) ? Number(at) : Number(state.standingAt);
  if (!Number.isFinite(here)) return null;
  let best = null;
  let bestD = Infinity;
  for (const p of state.plots) {
    const d = Math.abs(Number(p.x) - here);
    if (d <= REACH + 0.01 && d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** 给渲染层的薄视图。 */
export function overlayView(state) {
  const inventory = { ...state.inventory };
  const total = Object.values(inventory).reduce((a, b) => a + b, 0);
  const fb = farmBounds({ ...DEFAULTS, farmCells: state.farmCells });
  const groundTile = live.ground?.tile ?? null;
  return {
    day: state.day,
    clock: clockText(state.minute),
    coins: Math.round(state.coins),
    weather: state.weather,
    weatherFx: state.weatherFx ?? weatherFxOf(normalizeWeathers(DEFAULT_WEATHERS)[0]),
    current: state.current ?? null,
    currentAt: Number.isFinite(state.standingAt) ? Number(state.standingAt) : null,
    farm: { min: fb.min, max: fb.max, cells: fb.cells, cropScale: fb.cropScale, cropZoom: Number(state.cropScale) || 1 },
    ground: { tile: groundTile },
    waterFx: live.status ? {
      pour: [...(live.status.fx?.pour ?? [])],
      burst: [...(live.status.fx?.burst ?? [])],
      pourMs: Number(live.status.fx?.pourMs ?? 70),
      burstMs: Number(live.status.fx?.burstMs ?? 80),
    } : null,
    wither: live.status?.wither ?? null,
    inventory: { total, items: inventory },
    prices: Object.fromEntries(Object.values(live.items ?? {}).filter((it) => it.sell > 0).map((it) => [it.id, it.sell])),
    itemIcons: { ...live.itemIcons },
    itemKinds: Object.fromEntries(Object.values(live.items ?? {}).map((it) => [it.id, it.kind])),
    itemSprites: Object.fromEntries(Object.values(live.items ?? {}).filter((it) => it.sprite).map((it) => [it.id, it.sprite])),
    names: { ...live.names },
    lastMessage: state.lastMessage ?? '',
    groundHeight: Number(state.groundHeight) || 5,
    stripHeight: Number(state.stripHeight) || 320,
    dropScale: Number(state.dropScale) || 0.6,
    furniture: (state.furniture ?? [])
      .filter((f) => f.x !== null && f.x !== undefined)
      .map((f) => ({
        uid: f.uid, id: f.id, x: Number(f.x),
        layer: live.items?.[f.id]?.layer ?? f.layer ?? 'bottom',
        sprite: f.sprite ?? live.items?.[f.id]?.sprite ?? FURNITURE_BY_ID[f.id]?.sprite ?? '',
        scale: Number(live.items?.[f.id]?.scale ?? f.scale ?? 1) || 1,
      })),
    weeds: (state.weeds ?? []).map((w) => {
      const type = weedTypeOf(w);
      return {
        id: w.id,
        x: Number(w.x),
        level: Number(w.level ?? 0),
        kind: 'weed',
        type: type?.key ?? w.type ?? 'weed',
        name: type?.name ?? '野草',
        stages: type?.stages ?? 4,
        sprite: type ? type.spriteNames?.[Math.min(Number(w.level ?? 0), type.stages - 1)] ?? null : null,
        item: type?.item ?? null,
        itemName: type?.itemName ?? '',
        ready: Boolean(type?.item && Number(w.level ?? 0) >= type.stages - 1),
        layer: type?.layer === 'bottom' ? 'bottom' : 'top',
      };
    }),
    pendingPlace: state.pendingPlace ?? null,
    owned: (state.furniture ?? []).map((x) => ({
      uid: x.uid, id: x.id, name: live.items?.[x.id]?.name ?? FURNITURE_BY_ID[x.id]?.name ?? x.id,
      x: x.x === null || x.x === undefined ? null : Number(x.x),
    })),
    shop: Object.values(live.items ?? {})
      .filter((it) => it.buy > 0)
      .map((it) => ({ id: it.id, name: it.name, buy: it.buy, sell: it.sell, kind: it.kind })),
    drops: state.drops.map((d) => ({
      id: d.id,
      item: d.item,
      crop: d.crop,
      x: Number(d.x),
      fromX: Number.isFinite(d.fromX) ? Number(d.fromX) : Number(d.x),
      count: d.count,
      sprite: d.sprite ?? live.itemIcons?.[d.item] ?? cropOf(d.crop)?.itemSprite ?? 'icon_item_soil',
    })),
    fx: state.fx.slice(-8).map((f) => ({ ...f })),
    plots: state.plots.map((p) => {
      const crop = cropOf(p.crop);
      const frame = Math.min(crop.frames - 1, p.level);
      return {
        id: p.id,
        crop: crop.key,
        name: crop.name,
        prefix: crop.prefix,
        frame,
        sprite: crop.spriteNames?.[Math.min(p.level, crop.stages - 1)] ?? null,
        level: p.level,
        levels: crop.levels,
        stages: crop.stages,
        x: Number(p.x),
        water: round2(clamp01(p.moisture)),
        swing: Boolean(cropOf(p.crop)?.swing),
        ready: isRipe(p),
        dead: Boolean(p.dead),
        progress: Math.round((p.growth / crop.total) * 100),
      };
    }),
  };
}

/** 给工具看的摘要。 */
export function summary(state, cfg = DEFAULTS) {
  const total = Object.values(state.inventory).reduce((a, b) => a + b, 0);
  const weedList = (state.weeds ?? []).map((w) => {
    const t = weedTypeOf(w);
    const lv = Number(w.level ?? 0);
    return {
      id: w.id,
      type: t?.key ?? w.type ?? 'weed',
      name: t?.name ?? '野草',
      x: round2(Number(w.x)),
      xPct: Math.round(Number(w.x) * 100),
      level: lv,
      stages: t?.stages ?? 4,
      ready: Boolean(t?.item && lv >= t.stages - 1),
      item: t?.item ?? null,
      itemName: t?.itemName ?? '',
    };
  });
  const ripeWeeds = weedList.filter((w) => w.ready);
  return {
    day: state.day,
    clock: clockText(state.minute),
    weather: state.weather,
    weatherFx: state.weatherFx ?? weatherFxOf(normalizeWeathers(DEFAULT_WEATHERS)[0]),
    coins: Math.round(state.coins),
    current: state.current ?? null,
    standingAt: Number.isFinite(state.standingAt) ? Number(state.standingAt) : null,
    realMinutesPerDay: Number(cfg.realMinutesPerDay),
    bagTotal: total,
    bag: { ...state.inventory },
    drops: state.drops.length,
    planted: state.plots.length,
    max: cfg.maxPlants,
    ripe: state.plots.filter((p) => isRipe(p)).length,
    dead: state.plots.filter((p) => p.dead).length,
    weeds: weedList.length,
    weedRipe: ripeWeeds.length,
    weedList: ripeWeeds,
    states: (Array.isArray(cfg.stateDefs) ? cfg.stateDefs : []).map((d) => {
      const value = state.states?.[d.id] ?? {};
      const flag = d.kind === 'flag';
      return {
        id: d.id,
        name: d.name,
        kind: d.kind,
        unit: d.unit ?? '',
        min: Number(d.min ?? 0),
        max: Number(d.max ?? 100),
        value: flag ? null : round2(Number(value.value ?? d.initial)),
        active: flag ? Boolean(value.active ?? d.initialActive) : null,
      };
    }),
    plots: state.plots
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((p) => {
        const crop = cropOf(p.crop);
        const left = Math.max(0, crop.total - p.growth);
        const rate = cfg.pointsPerDay * moistureFactor(p.moisture, cfg) * wetBonus(p.moisture);
        return {
          id: p.id,
          crop: crop.name,
          key: crop.key,
          x: round2(Number(p.x)),
          xPct: Math.round(Number(p.x) * 100),
          level: p.level,
          levelName: (p.level + 1) + '/' + crop.levels,
          progress: Math.round((p.growth / crop.total) * 100),
          moisture: Math.round(clamp01(p.moisture) * 100),
          dry: p.drySince !== null,
          dead: Boolean(p.dead),
          ready: isRipe(p),
          harvests: p.harvests,
          lifespan: crop.lifespan,
          harvestsLeft: Math.max(0, Number(crop.lifespan) - Number(p.harvests)),
          canHarvestAgain: p.harvests + 1 < crop.lifespan || crop.lifespan > 1,
          daysToRipe: rate > 0 ? Math.round((left / rate) * 10) / 10 : 0,
          realMinutesToRipe: rate > 0 ? Math.round((left / rate) * cfg.realMinutesPerDay) : 0,
        };
      }),
    /** 最近"这棵怎么没的"（收满/拔枯/枯死/缩放删除/重种），最多 6 条。 */
    fieldLog: (state.fieldLog ?? []).slice(-6).map((e) => ({ ...e })),
    dropList: state.drops
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((d) => ({ id: d.id, item: d.name ?? live.names[d.item] ?? cropOf(d.crop).name, xPct: Math.round(Number(d.x) * 100) })),
  };
}

/** 桌宠可能用中文名或 key 指作物。 */
/**
 * 卖背包里的东西（产物、种子、消耗品……）。count 省略或 <=0 = 全卖。
 * 出售价来自「道具自定义」；没有 sell（0）的道具不能卖。
 */
export function sell(state, cfg, item, count) {
  const key = String(item ?? '').trim();
  const have = Number(state.inventory[key] ?? 0);
  if (!key || have <= 0) throw new Error('背包里没有 ' + (key || '这个东西') + '。');
  const def = live.items?.[key];
  const name = def?.name ?? SEED_BY_ID[key]?.name ?? CROP_PRICES[key]?.name ?? key;
  const price = sellPriceOf(key);
  if (price <= 0) throw new Error(name + ' 没有设置出售价值，不能卖。');
  const n = Number(count) > 0 ? Math.min(have, Math.floor(Number(count))) : have;
  state.inventory[key] = have - n;
  if (state.inventory[key] <= 0) delete state.inventory[key];
  const coins = price * n;
  state.coins = Number(state.coins ?? 0) + coins;
  return { item: key, name, count: n, unit: price, coins, left: state.inventory[key] ?? 0 };
}

/**
 * 买东西：只卖「道具自定义」里 buy>0 的道具；种子/消耗品/装饰都进背包。
 * count 对背包道具是一次买几个。
 */
export function buy(state, id, count = 1) {
  const raw = String(id ?? '').trim();
  const def = live.items?.[raw] ?? Object.values(live.items ?? {}).find((it) => it.name === raw);
  if (!def) {
    const spec = FURNITURE_BY_ID[raw];
    if (spec && !FURNITURE_ENABLED) throw new Error('家具暂时下架了（先不卖，摆放方案还没定）。');
    throw new Error('商店里没有 ' + (id ?? '这件东西') + '。');
  }
  if (!(def.buy > 0)) throw new Error(def.name + ' 没有设置购买价值，商店不卖。');
  const n = Math.max(1, Math.min(99, Math.floor(Number(count) || 1)));
  const price = def.buy * n;
  const coins = Number(state.coins ?? 0);
  if (coins < price) {
    throw new Error('钱不够：' + n + ' 个' + def.name + '要 ' + price + '，现在只有 ' + Math.floor(coins) + '。');
  }
  state.coins = coins - price;
  state.inventory = state.inventory ?? {};
  state.inventory[def.id] = Number(state.inventory[def.id] ?? 0) + n;
  return { item: def, count: n, price, left: state.inventory[def.id] };
}

/**
 * 一次买多件：先算总价，钱不够就一件都不买；够就扣一次钱、一次落盘。
 * items: [{ id, count? }]。返回逐项明细，供工具回执压成一行。
 */
export function buyMany(state, items = []) {
  const planned = [];
  for (const raw of items) {
    const id = String(raw?.id ?? '').trim();
    const def = live.items?.[id] ?? Object.values(live.items ?? {}).find((it) => it.name === id);
    if (!def) {
      const spec = FURNITURE_BY_ID[id];
      if (spec && !FURNITURE_ENABLED) throw new Error('家具暂时下架了（先不卖）。');
      throw new Error('商店里没有 ' + (id || '这件东西') + '。');
    }
    if (!(def.buy > 0)) throw new Error(def.name + ' 没有设置购买价值，商店不卖。');
    const n = Math.max(1, Math.min(99, Math.floor(Number(raw?.count) || 1)));
    planned.push({ def, count: n, price: def.buy * n });
  }
  const total = planned.reduce((a, x) => a + x.price, 0);
  const coins = Number(state.coins ?? 0);
  if (coins < total) {
    throw new Error('钱不够：这次共 ' + total + '，现在只有 ' + Math.floor(coins) + '。');
  }
  state.coins = coins - total;
  const bought = [];
  for (const p of planned) {
    state.inventory = state.inventory ?? {};
    state.inventory[p.def.id] = Number(state.inventory[p.def.id] ?? 0) + p.count;
    bought.push({
      id: p.def.id, name: p.def.name, count: p.count, left: state.inventory[p.def.id],
      price: p.price, kind: p.def.kind,
    });
  }
  return { items: bought, seeds: bought.filter((x) => x.kind === 'seed'), furniture: [], total, coins: state.coins };
}

/** 把一件已买的家具摆到 x（或收回来）。 */
export function placeFurniture(state, uid, x) {
  const item = state.furniture.find((f) => Number(f.uid) === Number(uid));
  if (!item) throw new Error('没有这件家具（uid ' + uid + '）。');
  if (x === null || x === undefined) {
    item.x = null;
    return { item, placed: false };
  }
  const nx = round2(Math.min(X_MAX, Math.max(X_MIN, Number(x))));
  item.x = nx;
  return { item, placed: true, x: nx };
}

/**
 * 把背包里的装饰道具放到 x（桌宠或人点一下都走这里）：
 * 消耗 1 个道具，清掉落点附近的杂草，记进 state.furniture（overlay 按 sprite 画）。
 */
export function placeDecoration(state, item, x) {
  const nx = round2(Math.min(X_MAX, Math.max(X_MIN, Number(x))));
  state.inventory = state.inventory ?? {};
  const have = Number(state.inventory[item.id] ?? 0);
  if (have <= 0) throw new Error('背包里没有' + item.name + '。');
  state.inventory[item.id] = have - 1;
  if (state.inventory[item.id] <= 0) delete state.inventory[item.id];
  const layer = item.layer === 'top' ? 'top' : 'bottom';
  let cleared = 0;
  // 上层装饰和杂草同一图层：放下去会把落点杂草清掉；下层在作物后面，不动杂草。
  if (layer === 'top') {
    const before = (state.weeds ?? []).length;
    state.weeds = (state.weeds ?? []).filter((w) => Math.abs(Number(w.x) - nx) > 0.035);
    cleared = before - state.weeds.length;
  }
  state.furniture = state.furniture ?? [];
  const placed = {
    uid: state.nextFurnitureId++,
    id: item.id,
    x: nx,
    layer,
    sprite: item.sprite ?? item.icon ?? 'icon_item_soil',
  };
  state.furniture.push(placed);
  return { placed, cleared, x: nx, name: item.name, layer };
}

export function cropFromText(text) {
  if (!text) return null;
  let s = String(text).trim();
  // 也接受 "seed_tomato" / "番茄种子"（种/卖时桌宠可能这么说）
  if (s.startsWith('seed_')) s = s.slice(5);
  else if (s.endsWith('种子')) s = s.slice(0, -2);
  if (CROPS[s]) return s;
  for (const [key, crop] of Object.entries(CROPS)) {
    if (crop.name === s) return key;
  }
  return null;
}

/** 老存档的杂草只有 kind/level，补上 type 并按类型阶段收敛。 */
export function normalizeWeeds(state) {
  if (!Array.isArray(state?.weeds)) return state;
  for (const w of state.weeds) {
    if (!w.type) w.type = w.kind === 'flower' ? 'eden_flower' : 'weed';
    w.kind = 'weed';
    const type = weedTypeOf(w);
    if (type) w.level = Math.min(Number(w.level ?? 0), type.stages - 1);
  }
  return state;
}

/** v1/v2 存档 -> v3：老存档只有 points/x，这里换算成 level/growth，位置和收割次数都留着。 */
export function migrate(state, cfg = DEFAULTS, random = Math.random) {
  if (!state || typeof state !== 'object') return null;
  if (state.v === STATE_VERSION) {
    // 老存档升级到"种子"版本时补发一包，只发一次（seedsGranted）
    grantStarterSeeds(state);
    if (!Number.isFinite(state.screenWidth)) state.screenWidth = Number(cfg.screenWidth ?? 2048);
    if (!Number.isFinite(state.farmCells)) state.farmCells = FARM_BASE_CELLS;
    if (!Array.isArray(state.fieldLog)) state.fieldLog = [];
    if (!state.states || typeof state.states !== 'object') state.states = {};
    if (!state.stateActions || typeof state.stateActions !== 'object') state.stateActions = {};
    normalizeWeeds(state);
    return state;
  }
  if (state.v !== 1 && state.v !== 2) return null;
  const next = {
    v: STATE_VERSION,
    day: state.day ?? 1,
    minute: state.minute ?? cfg.startMinute,
    coins: state.coins ?? cfg.startCoins,
    weather: state.weather ?? '晴',
    plots: [],
    drops: [],
    inventory: {},
    fx: [],
    current: null,
    standingAt: null,
    nextPlotId: 1,
    nextDropId: 1,
    nextFxId: 1,
    rotationIndex: 0,
    elapsedDays: Number.isFinite(state.elapsedDays) ? state.elapsedDays : 0,
    furniture: Array.isArray(state.furniture) ? state.furniture : [],
    weeds: Array.isArray(state.weeds) ? state.weeds : [],
    nextWeedId: Number.isFinite(state.nextWeedId) ? state.nextWeedId : (state.weeds?.length ?? 0) + 1,
    pendingPlace: state.pendingPlace ?? null,
    lastMessage: typeof state.lastMessage === 'string' ? state.lastMessage : '',
    fieldLog: [],
    states: {},
    stateActions: {},
    nextFurnitureId: Number.isFinite(state.nextFurnitureId) ? state.nextFurnitureId : (state.furniture?.length ?? 0) + 1,
    lastTickMs: state.lastTickMs ?? Date.now(),
    seedsGranted: false,
    farmCells: FARM_BASE_CELLS,
    screenWidth: Number(cfg.screenWidth ?? 2048),
  };
  for (const old of state.plots ?? []) {
    if (!old.crop) continue;
    const key = cropFromText(old.crop) ?? 'tomato';
    const crop = CROPS[key];
    const ratio = Number.isFinite(old.points) ? clamp01(old.points / 400) : 0;
    const growth = Math.round(ratio * crop.total);
    next.plots.push({
      id: next.nextPlotId++,
      crop: key,
      x: round2(Number.isFinite(old.x) ? Number(old.x) : X_MIN + 0.1 * next.plots.length),
      level: levelOf(crop, growth),
      growth,
      moisture: clamp01(old.moisture),
      harvests: old.harvests ?? 0,
      drySince: null,
      dead: false,
      ripeNotified: levelOf(crop, growth) >= crop.levels - 1,
    });
  }
  grantStarterSeeds(next);
  return next;
}
