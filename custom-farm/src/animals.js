/**
 * 动物：定义校验、成长/随机动作/产物模拟。纯数据，不碰 World 或文件。
 *
 * 贴图命名约定：`<stage.prefix>_<action>_<frame>`，例如
 *   animal_chicken_chick_walk_0
 * 每只动物默认在 mid 图层（top 与 pet 之间、pet 后方）。
 */

export const ANIMAL_LAYERS = ['top', 'mid', 'bottom'];
export const ANIMAL_ACTIONS = ['idle', 'walk', 'peck'];

const clamp = (n, lo, hi, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
};
const int = (n, lo, hi, fallback) => Math.round(clamp(n, lo, hi, fallback));
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const r4 = (n) => Math.round(Number(n) * 10000) / 10000;

function frames(prefix, action, count = 4) {
  return Array.from({ length: count }, (_, i) => `${prefix}_${action}_${i}`);
}

export function builtinAnimals() {
  return [{
    key: 'chicken',
    name: '鸡',
    layer: 'mid',
    enabled: true,
    actions: [
      { key: 'idle', name: '待机', weight: 48 },
      { key: 'walk', name: '走路', weight: 32 },
      { key: 'peck', name: '啄食', weight: 20 },
    ],
    walk: { chance: 0.35, speed: 0.012, range: 0.16 },
    product: { item: 'egg', name: '鸡蛋', icon: 'icon_item_egg', everyDays: 2, count: 1 },
    prices: { babyBuy: 60, babySell: 30, adultSell: 120 },
    stages: [
      {
        key: 'chick', name: '幼崽', days: 1.5, scale: 0.06, prefix: 'animal_chicken_chick',
        item: 'animal_chicken_chick', product: null,
        sprites: Object.fromEntries(ANIMAL_ACTIONS.map((a) => [a, frames('animal_chicken_chick', a)])),
      },
      {
        key: 'hen', name: '成年', days: 0, scale: 0.075, prefix: 'animal_chicken_hen',
        item: 'animal_chicken_hen', product: { item: 'egg', name: '鸡蛋', icon: 'icon_item_egg', everyDays: 2, count: 1 },
        sprites: Object.fromEntries(ANIMAL_ACTIONS.map((a) => [a, frames('animal_chicken_hen', a)])),
      },
    ],
  }];
}

function cleanSprite(s) {
  const v = typeof s === 'string' ? s.trim() : '';
  return /^[A-Za-z0-9_\-]+$/.test(v) ? v : null;
}

export function normalizeAnimal(src, index = 0) {
  if (!src || typeof src !== 'object') return null;
  const key = String(src.key ?? 'animal_' + (index + 1)).replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 32) || ('animal_' + (index + 1));
  const name = String(src.name ?? key).trim().slice(0, 24) || key;
  const rawLayer = src.layer === 'bg' ? 'bottom' : src.layer;
  const layer = ANIMAL_LAYERS.includes(rawLayer) ? rawLayer : 'mid';
  const actionDefs = (Array.isArray(src.actions) ? src.actions : [])
    .map((a) => ({
      key: String(a?.key ?? '').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 24),
      name: String(a?.name ?? a?.key ?? '').trim().slice(0, 16),
      weight: clamp(a?.weight, 0, 1000, 10),
    }))
    .filter((a) => a.key)
    .slice(0, 8);
  const actions = actionDefs.length ? actionDefs : [
    { key: 'idle', name: '待机', weight: 60 },
    { key: 'walk', name: '走路', weight: 40 },
  ];
  if (!actions.some((a) => a.key === 'walk')) actions.push({ key: 'walk', name: '走路', weight: 10 });
  const productDefaults = {
    item: String(src.product?.item ?? 'egg').trim().slice(0, 40),
    name: String(src.product?.name ?? '鸡蛋').trim().slice(0, 24),
    icon: cleanSprite(src.product?.icon) ?? 'icon_item_egg',
    everyDays: clamp(src.product?.everyDays, 0.01, 1000, 2),
    count: int(src.product?.count, 1, 99, 1),
  };
  const stageDefs = (Array.isArray(src.stages) ? src.stages : [])
    .map((s, i) => {
      const prefix = String(s?.prefix ?? key + '_' + (s?.key ?? i)).replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 48);
      const sprites = {};
      for (const a of actions) {
        const list = Array.isArray(s?.sprites?.[a.key]) ? s.sprites[a.key] : [];
        const cleaned = list.map(cleanSprite).filter(Boolean).slice(0, 8);
        sprites[a.key] = cleaned.length ? cleaned : frames(prefix, a.key);
      }
      let product = null;
      if (s?.product === true) product = { ...productDefaults };
      else if (s?.product && typeof s.product === 'object') {
        product = {
          item: String(s.product.item ?? productDefaults.item).trim().slice(0, 40),
          name: String(s.product.name ?? productDefaults.name).trim().slice(0, 24),
          icon: cleanSprite(s.product.icon) ?? productDefaults.icon,
          everyDays: clamp(s.product.everyDays, 0.01, 1000, productDefaults.everyDays),
          count: int(s.product.count, 1, 99, productDefaults.count),
        };
      }
      return {
        key: String(s?.key ?? 'stage_' + i).replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 24) || ('stage_' + i),
        name: String(s?.name ?? ('阶段 ' + (i + 1))).trim().slice(0, 16),
        days: clamp(s?.days, 0, 10000, 1),
        scale: clamp(s?.scale, 0.01, 4, 0.2),
        prefix,
        item: String(s?.item ?? '').trim().slice(0, 40),
        product,
        sprites,
      };
    })
    .slice(0, 8);
  if (!stageDefs.length) return null;
  const last = stageDefs.length - 1;
  for (let i = 0; i < stageDefs.length; i++) if (i === last) stageDefs[i].days = 0;
  const prices = {
    babyBuy: int(src.prices?.babyBuy, 0, 1000000, 0),
    babySell: int(src.prices?.babySell, 0, 1000000, 0),
    adultSell: int(src.prices?.adultSell, 0, 1000000, 0),
  };
  return {
    key,
    name,
    layer,
    enabled: src.enabled !== false,
    actions,
    walk: {
      chance: clamp(src.walk?.chance, 0, 1, 0.35),
      speed: clamp(src.walk?.speed, 0.0001, 1, 0.012),
      range: clamp(src.walk?.range, 0.01, 0.5, 0.16),
    },
    product: productDefaults,
    prices,
    stages: stageDefs,
  };
}

export function normalizeAnimalState(list) {
  return (Array.isArray(list) ? list : [])
    .filter((a) => a && typeof a === 'object' && a.id)
    .map((a) => ({
      id: String(a.id).slice(0, 64),
      species: String(a.species ?? ''),
      stage: Math.max(0, Math.round(Number(a.stage) || 0)),
      ageDays: Math.max(0, Number(a.ageDays) || 0),
      x: clamp(a.x, 0, 1, 0.5),
      anchor: clamp(a.anchor, 0, 1, 0.5),
      range: clamp(a.range, 0.01, 0.5, 0.16),
      dir: Number(a.dir) < 0 ? -1 : 1,
      action: ANIMAL_ACTIONS.includes(a.action) ? a.action : 'idle',
      actionUntil: Math.max(0, Number(a.actionUntil) || 0),
      actionStartedAt: Math.max(0, Number(a.actionStartedAt) || 0),
      targetX: Number.isFinite(Number(a.targetX)) ? clamp(a.targetX, 0, 1, 0.5) : null,
      nextProductAt: Math.max(0, Number(a.nextProductAt) || 0),
    }));
}

export function animalStage(species, stageIndex) {
  return species?.stages?.[Math.min(species.stages.length - 1, Math.max(0, stageIndex))] ?? null;
}

export function animalSprite(species, stageIndex, action, frame = 0) {
  const st = animalStage(species, stageIndex);
  const list = st?.sprites?.[action] ?? st?.sprites?.idle ?? [];
  return list.length ? list[Math.min(list.length - 1, Math.max(0, Math.round(frame)))] : null;
}

export function animalActionWeights(species) {
  const rows = (species?.actions ?? []).filter((a) => a.weight > 0);
  const total = rows.reduce((n, a) => n + a.weight, 0) || 1;
  return rows.map((a) => ({ ...a, p: a.weight / total }));
}

function pickWeighted(rows, random) {
  let r = random();
  for (const row of rows) {
    r -= row.p;
    if (r <= 0) return row;
  }
  return rows[rows.length - 1];
}

export function startAnimalAction(animal, species, now, random, forceWalk = false) {
  const stage = animalStage(species, animal.stage);
  const actions = (species.actions ?? []).filter((a) => stage?.sprites?.[a.key]?.length);
  const walk = actions.find((a) => a.key === 'walk');
  if ((forceWalk || random() < Number(species.walk?.chance ?? 0.35)) && walk) {
    animal.action = 'walk';
    animal.actionStartedAt = now;
    animal.actionUntil = now + 2500;
    const lo = Math.max(0, animal.anchor - animal.range);
    const hi = Math.min(1, animal.anchor + animal.range);
    animal.targetX = clamp(animal.x + (random() * 2 - 1) * animal.range, lo, hi);
    animal.dir = animal.targetX >= animal.x ? 1 : -1;
    return;
  }
  const weighted = animalActionWeights(species).filter((a) => a.key !== 'walk' && actions.some((x) => x.key === a.key));
  const picked = pickWeighted(weighted.length ? weighted : [{ key: 'idle', p: 1 }], random);
  animal.action = picked.key;
  animal.targetX = null;
  animal.dir = random() < 0.5 ? -1 : 1;
  animal.actionStartedAt = now;
  animal.actionUntil = now + 1400 + Math.round(random() * 1800);
}

/**
 * 推进一只动物。返回本 tick 产生的掉落物（不直接改写 state.drops，World 负责）。
 * gameDays 是本次 tick 推进的游戏日；now 是真实毫秒。
 */
export function advanceAnimal(animal, species, now, gameDays, random, dtSec = null) {
  const out = [];
  if (!species) return out;
  const last = Math.max(1, species.stages.length - 1);
  animal.stage = Math.min(last, Math.max(0, Number(animal.stage) || 0));
  animal.ageDays = Math.max(0, Number(animal.ageDays) || 0) + Math.max(0, gameDays);
  while (animal.stage < last && animal.ageDays >= Number(species.stages[animal.stage]?.days ?? 0)) {
    animal.ageDays -= Number(species.stages[animal.stage]?.days ?? 0);
    animal.stage += 1;
    animal.nextProductAt = 0;
    animal.action = 'idle';
    animal.actionUntil = 0;
    animal.targetX = null;
  }

  const stage = animalStage(species, animal.stage);
  const walkSpeed = Number(species.walk?.speed ?? 0.012);
  if (animal.action === 'walk' && Number.isFinite(animal.targetX)) {
    const dx = animal.targetX - animal.x;
    const step = walkSpeed * Math.max(0, Math.min(5, Number.isFinite(Number(dtSec)) ? Number(dtSec) : (gameDays * 86400 / 60)));
    if (Math.abs(dx) <= Math.max(0.0005, step)) {
      animal.x = animal.targetX;
      animal.targetX = null;
      animal.action = 'idle';
      animal.actionStartedAt = now;
      animal.actionUntil = now + 1200 + random() * 1800;
    } else {
      animal.dir = dx > 0 ? 1 : -1;
      animal.x = clamp(animal.x + animal.dir * step, 0, 1, animal.x);
    }
  } else if (now >= Number(animal.actionUntil || 0)) {
    startAnimalAction(animal, species, now, random, false);
  }
  animal.x = clamp(animal.x, Math.max(0, animal.anchor - animal.range), Math.min(1, animal.anchor + animal.range), animal.x);

  if (stage?.product && stage.product.item) {
    const every = Number(stage.product.everyDays) || 2;
    if (!(animal.nextProductAt > 0)) animal.nextProductAt = (Number(animal.ageDays) || 0) + every;
    // 用实例年龄做时钟，避免把离线时间一次性补成一堆产物。
    if (animal.ageDays >= animal.nextProductAt) {
      animal.nextProductAt = animal.ageDays + every;
      out.push({
        item: stage.product.item,
        count: Math.max(1, Number(stage.product.count) || 1),
        x: animal.x,
        animal: animal.id,
      });
    }
  }
  return out;
}

export function animalSlotPrice(species, stageIndex) {
  const stage = animalStage(species, stageIndex);
  const last = Math.max(0, (species?.stages?.length ?? 1) - 1);
  if (stageIndex >= last) return Number(species?.prices?.adultSell) || 0;
  return Number(species?.prices?.babySell) || 0;
}

export function animalItemOf(species, stageIndex) {
  return animalStage(species, stageIndex)?.item || species?.stages?.[0]?.item || '';
}

export function animalView(species, animal) {
  const stage = animalStage(species, animal.stage);
  const actionFrames = stage?.sprites?.[animal.action] ?? stage?.sprites?.idle ?? [];
  return {
    id: animal.id,
    species: species.key,
    speciesName: species.name,
    stage: animal.stage,
    stageName: stage?.name ?? '',
    action: animal.action,
    x: r2(animal.x),
    targetX: animal.targetX === null ? null : r2(animal.targetX),
    dir: animal.dir,
    layer: species.layer,
    scale: stage?.scale ?? 0.2,
    speed: Number(species.walk?.speed ?? 0.012),
    actionMs: 220,
    startedAt: animal.actionStartedAt || 0,
    frames: [...actionFrames],
    frame: Math.max(0, Math.floor((Date.now() - (animal.actionStartedAt || 0)) / 220)),
    sprite: animalSprite(species, animal.stage, animal.action, Math.floor((Date.now() - (animal.actionStartedAt || 0)) / 220)),
  };
}
