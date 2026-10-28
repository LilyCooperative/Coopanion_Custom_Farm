/**
 * 天气对植株/装饰的视觉参数。
 * crop* / decor* 分开设置；兼容旧字段 sway/swayAmp（同时作为两者的回退值）。
 * squash: 0~0.6，压扁/拉长幅度（“朋友的酒”效果）。
 */
export const DEFAULT_WEATHERS = [
  { id: 'calm', name: '无风', builtin: true, deletable: false, duration: 300, weight: 30, cropSway: 'both', cropAmp: 4, decorSway: 'none', decorAmp: 1, squash: 0, mood: 2, speed: 1 },
  { id: 'breeze', name: '微风', builtin: true, deletable: true, duration: 250, weight: 40, cropSway: 'left', cropAmp: 5, decorSway: 'none', decorAmp: 3, squash: 0, mood: 1, speed: 1.2 },
  { id: 'gale', name: '大风', builtin: true, deletable: true, duration: 100, weight: 20, cropSway: 'right', cropAmp: 13, decorSway: 'none', decorAmp: 9, squash: 0, mood: -6, speed: 2.4 },
  { id: 'egg', name: '彩蛋', builtin: true, deletable: true, duration: 300, weight: 10, cropSway: 'none', cropAmp: 0, decorSway: 'none', decorAmp: 0, squash: 0.45, mood: 4, speed: 3 },
];

const clamp = (n, lo, hi, fallback) => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
};
const modeOf = (v, fallback = 'both') => (['both', 'left', 'right', 'none'].includes(v) ? v : fallback);

export function normalizeWeathers(input) {
  const src = Array.isArray(input) ? input : [];
  const out = [];
  for (const row of src) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32) || ('weather_' + out.length);
    const name = String(row.name ?? '').trim().slice(0, 12) || '天气';
    out.push({
      id,
      name,
      builtin: Boolean(row.builtin),
      deletable: row.deletable !== false,
      duration: Math.round(clamp(row.duration, 1, 3600, 20)),
      weight: Math.round(clamp(row.weight, 0, 100, 10)),
      cropSway: modeOf(row.cropSway, modeOf(row.sway)),
      cropAmp: clamp(row.cropAmp ?? row.swayAmp, 0, 40, 4),
      decorSway: modeOf(row.decorSway, modeOf(row.sway)),
      decorAmp: clamp(row.decorAmp ?? row.swayAmp, 0, 40, 3),
      squash: clamp(row.squash, 0, 0.6, 0),
      mood: clamp(row.mood ?? { calm: 2, breeze: 1, gale: -6, egg: 4 }[id], -100, 100, 0),
      speed: clamp(row.speed, 0.2, 4, 1),
    });
  }
  if (!out.some((w) => w.id === 'calm')) out.unshift({ ...DEFAULT_WEATHERS[0] });
  if (!out.some((w) => w.id !== 'calm')) out.push(...DEFAULT_WEATHERS.slice(1).map((w) => ({ ...w })));
  for (const w of out) {
    if (w.id === 'calm') { w.name = '无风'; w.deletable = false; }
  }
  return out;
}

export function weatherFxOf(w) {
  return {
    id: w?.id ?? 'calm',
    name: w?.name ?? '无风',
    mode: w?.cropSway ?? w?.sway ?? 'both',
    swayAmp: Number(w?.cropAmp ?? w?.swayAmp ?? 2.5),
    cropMode: w?.cropSway ?? w?.sway ?? 'both',
    cropAmp: Number(w?.cropAmp ?? w?.swayAmp ?? 2.5),
    decorMode: w?.decorSway ?? w?.sway ?? 'both',
    decorAmp: Number(w?.decorAmp ?? w?.swayAmp ?? 1.5),
    squash: Number(w?.squash ?? 0),
    mood: Number(w?.mood ?? 0),
    speed: Number(w?.speed ?? 1),
  };
}

export function pickWeather(list, random) {
  const rows = normalizeWeathers(list);
  const total = rows.reduce((n, w) => n + Math.max(0, w.weight), 0);
  if (total <= 0) return rows[0];
  let r = random() * total;
  for (const w of rows) {
    r -= Math.max(0, w.weight);
    if (r <= 0) return w;
  }
  return rows[rows.length - 1];
}

export function weatherById(list, id) {
  return normalizeWeathers(list).find((w) => w.id === id) ?? null;
}
