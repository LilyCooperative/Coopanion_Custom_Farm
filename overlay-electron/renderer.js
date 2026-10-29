let fs = null;
let path = null;
try {
  fs = require('node:fs');
  path = require('node:path');
} catch { /* WebView2 里没有 Node，状态由宿主注入 */ }

const q = new URLSearchParams(location.search);
const LAYER = q.get('layer') || 'all';
const hostMode = Boolean(window.__farmHost);
const statePath = q.get('state') || '';
const assetsDir = q.get('assets') || '';
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const images = new Map();
const Z = 2;

let state = null;
let lastMtime = 0;
let firstState = true;
const seenFx = new Set();
const particles = [];
const splashes = [];
const collectFx = [];
const dropAnims = new Map();

function assetUrl(name) {
  if (!name) return '';
  const file = name.replace(/\.png$/i, '') + '.png';
  if (window.__farmAssetsBase) return window.__farmAssetsBase + encodeURIComponent(file);
  if (!path) return '';
  const p = path.join(assetsDir, file);
  return encodeURI('file:///' + p.replace(/\\/g, '/').replace(/^\/+/, ''));
}

function image(name) {
  if (!name) return null;
  if (images.has(name)) return images.get(name);
  const img = new Image();
  img.src = assetUrl(name);
  images.set(name, img);
  return img;
}

function ready(img) { return img && img.complete && img.naturalWidth > 0; }

function applyState(next) {
  try {
    state = typeof next === 'string' ? JSON.parse(next) : next;
    processFx();
  } catch { /* 忽略坏帧 */ }
}
window.__farmApplyState = applyState;

function loadState() {
  if (hostMode) return;
  try {
    const st = fs.statSync(statePath);
    if (st.mtimeMs === lastMtime) return;
    lastMtime = st.mtimeMs;
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    processFx();
  } catch { state = null; }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function groundY() {
  return window.innerHeight - Math.max(2, Number(state?.groundHeight) || 10);
}

function cropInfo(p) {
  const img = image(p.sprite || ((p.prefix || '') + '_' + (p.frame ?? p.level ?? 0)));
  const s = Z * (Number(state?.farm?.cropScale) || 1);
  return { img, w: ready(img) ? img.naturalWidth * s : 0, h: ready(img) ? img.naturalHeight * s : 0 };
}

function spawnParticles(x, y, count, spread) {
  for (let i = 0; i < count; i += 1) {
    const name = 'crop_shiny_' + String(1 + Math.floor(Math.random() * 60)).padStart(2, '0');
    particles.push({
      name, x, y,
      vx: (Math.random() * 2 - 1) * 1.2 * spread,
      vy: -(0.9 + Math.random() * 1.7) * spread,
      born: performance.now(),
      life: 460 + Math.random() * 300,
      size: 12 + Math.random() * 8,
    });
  }
}

function addSplash(x, y, frames, per, w, h) {
  if (!frames.length) return;
  splashes.push({ x, y, frames, per, w, h, born: performance.now() });
}

function startWater(x, plotId) {
  const st = state || {};
  const wf = st.waterFx || {};
  const pour = (wf.pour || ['water_pour_1', 'water_pour_2', 'water_pour_3', 'water_pour_4']).filter(Boolean);
  const burst = (wf.burst || ['water_burst_1', 'water_burst_2', 'water_burst_3', 'water_burst_4', 'water_burst_5', 'water_burst_6']).filter(Boolean);
  const p = (st.plots || []).find((row) => Number(row.id) === Number(plotId));
  const ci = p ? cropInfo(p) : { w: 0, h: 0 };
  const gx = x * window.innerWidth;
  const g = groundY();
  if (pour.length) {
    const img = image(pour[0]);
    const dW = (img.naturalWidth || 16) * Z;
    const dH = (img.naturalHeight || 16) * Z;
    const rise = ci.h > 8 ? ci.h : 34 * Z;
    addSplash(gx, g - rise - dH + 6, pour, Math.max(10, Number(wf.pourMs) || 70), dW, dH);
  }
  if (burst.length) {
    const img = image(burst[0]);
    addSplash(gx, g - (img.naturalHeight || 16) * Z + 2, burst, Math.max(10, Number(wf.burstMs) || 80), (img.naturalWidth || 16) * Z, (img.naturalHeight || 16) * Z);
  }
}

function processFx() {
  const list = Array.isArray(state?.fx) ? state.fx : [];
  if (firstState) {
    for (const f of list) seenFx.add(Number(f.id));
    firstState = false;
    return;
  }
  for (const f of list) {
    const id = Number(f.id);
    if (!Number.isFinite(id) || seenFx.has(id)) continue;
    seenFx.add(id);
    const x = Number(f.x) || 0;
    const g = groundY();
    if (f.kind === 'collect') {
      const icon = state.itemIcons?.[f.item] || ('icon_item_' + f.item);
      collectFx.push({ icon, x, toX: Number(f.toX ?? f.x) || x, born: performance.now(), ms: 700 });
    } else if (f.kind === 'water') {
      startWater(x, f.plot);
    } else if (f.kind === 'harvest') {
      spawnParticles(x, g - window.innerHeight * 0.42, 10, 1.2);
      spawnParticles(x, g - window.innerHeight * 0.10, 4, 0.8);
    } else if (f.kind === 'plant') {
      spawnParticles(x, g - 4, 6, 0.7);
    } else if (f.kind === 'weedBreak' || f.kind === 'pull') {
      addSplash(x * window.innerWidth, g - 26 * Z, ['smoke_ps_02_0', 'smoke_ps_02_1', 'smoke_ps_02_2', 'smoke_ps_02_3', 'smoke_ps_02_4', 'smoke_ps_02_5'], 70, 26 * Z, 26 * Z);
    }
  }
  if (seenFx.size > 80) {
    const keep = [...seenFx].slice(-50);
    seenFx.clear();
    keep.forEach((id) => seenFx.add(id));
  }
}

function drawFrames(e, now) {
  const age = now - e.born;
  const idx = Math.floor(age / e.per);
  if (idx >= e.frames.length) return false;
  const img = image(e.frames[idx]);
  if (ready(img)) ctx.drawImage(img, e.x - e.w / 2, e.y, e.w, e.h);
  return true;
}

function draw(now) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  ctx.clearRect(0, 0, W, H);
  if (!state) return;
  const g = groundY();
  const cs = Number(state.farm?.cropScale) || 1;
  const isTop = LAYER === 'top';
  const showTop = LAYER === 'top' || LAYER === 'all';

  const groundName = state.ground?.tile;
  const gt = image(groundName);
  if (!isTop && ready(gt)) {
    const tw = gt.naturalWidth * Z * cs;
    const th = gt.naturalHeight * Z * cs;
    for (let x = 0; x < W; x += tw) ctx.drawImage(gt, x, g, tw, th);
  }

  const wf = state.weatherFx || { mode: 'both', swayAmp: 3.2, squash: 0, speed: 1 };
  const drawSprite = (img, x, bottom, scale = 1, phase = 0, kind = 'crop') => {
    if (!ready(img)) return;
    const w = img.naturalWidth * Z * cs * scale;
    const h = img.naturalHeight * Z * cs * scale;
    const wave = Math.sin((now / 1000) * 2.1 * (Number(wf.speed) || 1) + phase);
    const mode = kind === 'decor' ? (wf.decorMode || wf.mode) : (wf.cropMode || wf.mode);
    const amp = Number(kind === 'decor' ? (wf.decorAmp ?? wf.swayAmp) : (wf.cropAmp ?? wf.swayAmp)) || 0;
    let angle = 0;
    if (mode === 'left') angle = -Math.abs(wave) * amp;
    else if (mode === 'right') angle = Math.abs(wave) * amp;
    else if (mode === 'none') angle = 0;
    else angle = wave * amp;
    const squash = wf.id === 'egg' ? (Number(wf.squash) || 0) : 0;
    const sq = squash * Math.sin((now / 1000) * 2.1 * (Number(wf.speed) || 1));
    ctx.save();
    ctx.translate(x * W, bottom);
    ctx.rotate(angle * Math.PI / 180);
    ctx.scale(1 - 0.45 * sq, 1 + sq);
    ctx.drawImage(img, -w / 2, -h + 2, w, h);
    ctx.restore();
  };

  const furniture = Array.isArray(state.furniture) ? state.furniture : [];
  if (!isTop) for (const f of furniture) if (f.layer !== 'top') drawSprite(image(f.sprite), Number(f.x), g, Number(f.scale) || 1, Number(f.x) * 19, 'decor');

  const weeds = Array.isArray(state.weeds) ? state.weeds : [];
  if (!isTop) for (const w of weeds) if (w.layer !== 'top') drawSprite(image(w.sprite), Number(w.x), g, 1, Number(w.x) * 13, 'crop');

  if (!isTop) for (const p of state.plots || []) {
    if (LAYER !== 'all' && p.layer === 'top') continue;
    const ci = cropInfo(p);
    if (ready(ci.img)) drawSprite(ci.img, Number(p.x), g, 1, Number(p.id) * 1.7, 'crop');
  }

  if (showTop) for (const f of furniture) if (f.layer === 'top') drawSprite(image(f.sprite), Number(f.x), g, Number(f.scale) || 1, Number(f.x) * 19, 'decor');
  if (showTop) for (const w of weeds) if (w.layer === 'top') drawSprite(image(w.sprite), Number(w.x), g, 1, Number(w.x) * 13, 'crop');
  if (isTop) for (const p of state.plots || []) {
    if (p.layer !== 'top') continue;
    const ci = cropInfo(p);
    if (ready(ci.img)) drawSprite(ci.img, Number(p.x), g, 1, Number(p.id) * 1.7, 'crop');
  }

  if (!isTop) for (const p of state.plots || []) {
    if (p.dead || Number(p.water) < 0.9) continue;
    const ci = cropInfo(p);
    if (!ci.h) continue;
    const stage = ci.h >= 28 * Z ? 4 : ci.h >= 20 * Z ? 3 : ci.h >= 12 * Z ? 2 : 1;
    const frame = String(Math.floor(now / 80) % 21).padStart(2, '0');
    const drip = image('water_drip' + stage + '_' + frame);
    if (!ready(drip)) continue;
    const dw = drip.naturalWidth * Z;
    const dh = drip.naturalHeight * Z;
    const off = ((Number(p.id) % 3) - 1) * ci.w * 0.18;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(drip, Number(p.x) * W + off - dw / 2, g - ci.h + 2, dw, dh);
    ctx.globalAlpha = 1;
  }

  if (!isTop) {
  const drops = Array.isArray(state.drops) ? state.drops : [];
  const dropIds = new Set();
  for (const d of drops) {
    const id = Number(d.id);
    dropIds.add(id);
    let a = dropAnims.get(id);
    if (!a) {
      a = { born: now, fromX: Number(d.fromX ?? d.x) || Number(d.x) || 0 };
      dropAnims.set(id, a);
    }
    const icon = image(state.itemIcons?.[d.item] || state.itemIcons?.[d.crop] || ('icon_item_' + d.crop));
    if (!ready(icon)) continue;
    const size = 32 * Z * (Number(state.dropScale) || 1);
    const age = (now - a.born) / 1000;
    let x = Number(d.x) * W;
    let y = g - size - 2;
    if (age < 0.5) {
      const t = age / 0.5;
      x = a.fromX * W + (x - a.fromX * W) * t;
      y = (g - size - 32) + 32 * t - 34 * Math.sin(Math.PI * t);
    } else {
      y += Math.sin((age - 0.5) * 4.2) * 1.5 - 2;
    }
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, g + 1, size * 0.28, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(icon, x - size / 2, y, size, size);
  }
  for (const id of [...dropAnims.keys()]) if (!dropIds.has(id)) dropAnims.delete(id);

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    const age = (now - p.born) / 1000;
    if (age * 1000 >= p.life) { particles.splice(i, 1); continue; }
    const img = image(p.name);
    if (!ready(img)) continue;
    const px = p.x * W + p.vx * 130 * age;
    const py = p.y + p.vy * 130 * age + 320 * age * age;
    ctx.globalAlpha = Math.max(0, 1 - (age * 1000) / p.life);
    ctx.drawImage(img, px - p.size / 2, py - p.size / 2, p.size, p.size);
    ctx.globalAlpha = 1;
  }

  for (let i = splashes.length - 1; i >= 0; i -= 1) {
    if (!drawFrames(splashes[i], now)) splashes.splice(i, 1);
  }

  for (let i = collectFx.length - 1; i >= 0; i -= 1) {
    const e = collectFx[i];
    const t = (now - e.born) / e.ms;
    if (t >= 1) { collectFx.splice(i, 1); continue; }
    const img = image(e.icon);
    if (!ready(img)) continue;
    const size = 32 * Z * (Number(state.dropScale) || 1) * (1 - 0.55 * t);
    const x = e.x * W + (e.toX * W - e.x * W) * t;
    const y = g - size - 2 - 0.32 * H * Math.sin(Math.PI * t);
    ctx.globalAlpha = 1 - 0.15 * t;
    ctx.drawImage(img, x - size / 2, y, size, size);
    ctx.globalAlpha = 1;
  }
  }
}

function loop(now) {
  draw(now);
  requestAnimationFrame(loop);
}

setInterval(loadState, 100);
window.addEventListener('resize', resize);
resize();
loadState();
requestAnimationFrame(loop);
