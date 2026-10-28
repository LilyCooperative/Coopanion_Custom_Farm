/**
 * 「农场自定义」面板（浏览器端，无构建步骤的纯 ESM）。
 *
 * 三块：农场地面 / 农作物 / 杂草，用横线隔开。所有读写都走 ctx.invoke，
 * 贴图预览走 ctx.invokeBinary('sprite')，加贴图走 ctx.pickPath 选本机 PNG。
 */

// 设置页的「配置」是宿主固定文案；农场页加载后显示成「游戏配置」。
function renameFarmConfigTab() {
  try {
    const hash = String(location.hash || '');
    if (!hash.includes('world%3Afarm') && !hash.includes('world:farm')) return;
    for (const btn of document.querySelectorAll('button')) {
      if ((btn.textContent || '').trim() === '配置') btn.textContent = '游戏配置';
    }
    for (const el of document.querySelectorAll('.sheet-title, h2, h3')) {
      const text = (el.textContent || '').trim();
      if (text.replace(/\s+/g, '') === '配置config' || text === '配置') el.textContent = '游戏配置';
    }
  } catch { /* 不是浏览器环境就算了 */ }
}
if (typeof document !== 'undefined') {
  const start = () => {
    renameFarmConfigTab();
    injectFarmConfigActions();
    new MutationObserver(() => { renameFarmConfigTab(); injectFarmConfigActions(); }).observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('hashchange', () => { renameFarmConfigTab(); injectFarmConfigActions(); });
    setInterval(() => { renameFarmConfigTab(); injectFarmConfigActions(); }, 1000);
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

/** 调 World 的 manage 面板：备份 / 重置。 */
async function farmManageCall(method) {
  const res = await fetch('/api/webui/providers/' + encodeURIComponent('world:farm') + '/panels/manage/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: [] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

/** 往宿主的「游戏配置」页里塞「存档与重置」按钮。 */
function injectFarmConfigActions() {
  try {
    const hash = String(location.hash || '');
    if (!hash.includes('world%3Afarm') && !hash.includes('world:farm')) return;
    const view = document.querySelector('.configview');
    if (!view || view.querySelector('[data-farm-manage]')) return;

    const section = document.createElement('div');
    section.className = 'tsection';
    section.dataset.farmManage = '1';
    section.textContent = '存档与重置';

    const desc = document.createElement('div');
    desc.className = 'tsecdesc';
    desc.textContent = '备份会复制 state.json 和 custom.json 到 data/farm/backups；重置会先备份，再清空存档和全部自定义设置，World 随后重启。';

    const row = document.createElement('div');
    row.className = 'trow';
    const label = document.createElement('span');
    label.className = 'tlabel';
    label.textContent = '操作';
    const field = document.createElement('div');
    field.className = 'tfield';
    field.style.display = 'flex';
    field.style.gap = '8px';
    field.style.flexWrap = 'wrap';
    const status = document.createElement('span');
    status.className = 'tdesc';
    status.setAttribute('role', 'status');

    const button = (text, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn sm' + (primary ? ' primary' : '');
      b.textContent = text;
      return b;
    };
    const backup = button('备份存档', true);
    const reset = button('重置一切', false);

    backup.addEventListener('click', async () => {
      backup.disabled = true;
      status.textContent = '正在备份…';
      try {
        const r = await farmManageCall('backup');
        status.textContent = r.text || '已备份';
      } catch (err) {
        status.textContent = '备份失败：' + ((err && err.message) || err);
      } finally { backup.disabled = false; }
    });

    reset.addEventListener('click', async () => {
      if (!window.confirm('确定重置一切？会清空存档和全部自定义设置（会先自动备份）。')) return;
      reset.disabled = true;
      status.textContent = '正在重置…';
      try {
        const r = await farmManageCall('reset');
        status.textContent = r.text || '已重置，World 正在重启…';
        setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 3000);
      } catch (err) {
        status.textContent = '重置失败：' + ((err && err.message) || err);
        reset.disabled = false;
      }
    });

    field.append(backup, reset, status);
    row.append(label, field);
    view.append(section, desc, row);
  } catch { /* 不是宿主的配置页就算了 */ }
}

const TEXT = {
  zh: {
    title: '农场',
    groundDesc: '点一张换农场地面；也可以加自己的 PNG。地面按选中的这一张横向周期重复；改完下次图层刷新生效。',
    farmSize: '农田大小（格）',
    groundHeight: '地表高度（像素）',
    stripHeight: '屏幕纵向覆盖高度（像素）',
    farmSettingsHint: '农田大小会缩放草地、作物、野草和草地厚度；地表高度控制地面露出多少（默认 10，约到桌宠鞋底）；屏幕纵向覆盖高度控制图层窗口高度，作物/装饰太大被削顶时调大（默认 320）。地面贴图按选中长条自动重复铺满。',
    saveFarm: '保存农场设置',
    maxPlants: '最多同时种几棵',
    cropGapScale: '作物间距（倍率）',
    cropGapPct: '作物最小间距（% 屏宽）',
    cropScale: '农作物 / 杂草大小（倍率）',
    dropScale: '掉落物大小（倍率）',
    saveCropSettings: '保存农作物设置',
    startWeeds: '开局/启动补到几丛野草',
    maxWeeds: '野草上限',
    weedPerDay: '每游戏日长出新野草的概率',
    weedClearRadius: '播种铲草半径（屏宽）',
    saveWeedSettings: '保存杂草设置',
    weedSettingsHint: '上限 / 出现概率 / 铲草半径影响之后的操作；改完点保存。',
    ecologyTitle: '生态',
    ecologyDesc: '时间、离线补算和浇水；改完点保存，下一次刷新/图层刷新生效。',
    ecologyTime: '时间与生长',
    ecologyWater: '浇水',
    timePerDay: '一个游戏日 = 真实分钟',
    maxStepDays: '离线最多补几天（安全上限）',
    tickMs: '刷新间隔（ms，不影响生长）',
    dailyEvent: '每天推「新的一天」事件',
    saveEcology: '保存生态设置',
    addGround: '添加自定义贴图',
    builtin: '内置',
    custom: '自定义',
    selected: '使用中',
    remove: '删除',
    cropsTitle: '农作物',
    cropsDesc: '增删作物、改阶段数与每阶段天数、各阶段/种子/产物贴图。价格、是否可吃、吃掉后的状态效果去「道具自定义」页设置。点标题展开一张卡。',
    templateTitle: '设置模板',
    templateDesc: '把当前所有设置（custom.json）和所有自定义贴图打包成 ZIP；换电脑 / 备份 / 分享用。',
    templateNote: '导入会覆盖当前全部设置和贴图，但不会清空田地、背包和存档。若新模板删掉了存档里正在种的作物，田里会按新设置重新解释；导入前建议先导出一份备份。',
    exportTpl: '导出模板 ZIP',
    importTpl: '导入模板 ZIP',
    confirmImport: '导入设置模板？',
    importWarn: '会覆盖当前所有作物/杂草/地面/状态/道具/合成表和自定义贴图，且不会自动回滚。建议先导出备份。',
    exportedTpl: '模板已开始下载',
    importedTpl: '模板已导入',
    pickTpl: '选设置模板 ZIP',
    zipOnly: '模板要选 .zip 文件。',
    addCrop: '添加作物',
    weedsTitle: '杂草',
    weedsDesc: '增删杂草、阶段数与每阶段天数、出现权重；配了收获物就能走过去收。点标题展开一张卡。',
    weedLayer: '图层',
    weedLayerTop: '上（和作物/桌宠同前台层）',
    weedLayerBottom: '下（背景层，作物后方）',
    addWeed: '添加杂草',
    name: '名字',
    stages: '阶段数',
    stageDays: '每阶段生长天数',
    stageN: (a, b) => '阶段 ' + a + ' → ' + b,
    daysTotal: (d) => '合计 ' + d + ' 天成熟',
    value: '收获物价值',
    seedPrice: '种子价（买）',
    seed: '种子贴图',
    item: '收获物贴图',
    stageSprite: '阶段贴图',
    pick: '换图',
    save: '保存',
    reset: '恢复默认',
    del: '删除',
    weight: '出现权重',
    weightHint: (p) => '占全部杂草 ' + p + '%',
    harvestable: '可收割（有收获物）',
    itemName: '收获物名字',
    noItem: '没有收获物',
    pickTitle: '选一张 PNG 贴图',
    onlyPng: '只支持 PNG（overlay 只认 .png）。',
    saved: '已保存',
    deleted: '已删除',
    added: '已添加',
    confirmDel: (n) => '删除「' + n + '」？',
    confirmBody: '如果田里还种着/长着它，会先被拒绝。',
    addOk: '已添加，填好参数后点保存。',
    err: '操作失败',
    emptyCrops: '还没有作物。',
    emptyWeeds: '还没有杂草。',
    totalDays: '成熟',
    mode: '自定义',
    statusTitle: '浇水特效 / 枯萎贴图',
    statusDesc: '浇水特效动画和枯萎贴图；浇水数值在「生态」里。改完点保存，图层下一次刷新生效。',
    waterEvap: '每游戏日蒸发',
    waterGain: '一次浇水补水',
    wiltDays: '干透后枯萎（游戏日）',
    saveWater: '保存浇水',
    waterFx: '浇水特效',
    pourFrames: '植株上方落水（逐帧）',
    burstFrames: '地面水花（逐帧）',
    addFrame: '添加帧',
    frameMs: '帧间隔 ms',
    wither: '枯萎作物贴图',
    pickWither: '换图',
    resetWither: '用默认',
    saveStatus: '保存状态设置',
    resetFx: '恢复默认特效',
    none: '（无）',
  },
  en: {
    title: 'Farm',
    groundDesc: 'Pick a ground tile, or add your own PNG. The chosen tile repeats horizontally; applies on the next layer refresh.',
    farmSize: 'Farm size (cells)',
    groundHeight: 'Ground height (px)',
    stripHeight: 'Vertical coverage height (px)',
    farmSettingsHint: 'Farm size scales the grass, crops, weeds and grass thickness; ground height controls how much ground is visible (default 4, about the pet shoe sole). The selected strip repeats automatically.',
    saveFarm: 'Save farm settings',
    maxPlants: 'Max plants',
    cropGapScale: 'Crop spacing (scale)',
    cropGapPct: 'Min crop spacing (% screen)',
    cropScale: 'Plant size (crops & weeds)',
    dropScale: 'Drop size (scale)',
    saveCropSettings: 'Save crop settings',
    startWeeds: 'Starting weeds',
    maxWeeds: 'Max weeds',
    weedPerDay: 'Weed spawn chance per day',
    weedClearRadius: 'Weed clear radius (screen)',
    saveWeedSettings: 'Save weed settings',
    weedSettingsHint: 'Max / spawn chance / clear radius affect subsequent actions; save to apply.',
    ecologyTitle: 'Ecology',
    ecologyDesc: 'Time, offline catch-up and watering; applies on the next refresh.',
    ecologyTime: 'Time & growth',
    ecologyWater: 'Watering',
    timePerDay: 'Real minutes per game day',
    maxStepDays: 'Max offline days (safety cap)',
    tickMs: 'Refresh interval (ms, does not affect growth)',
    dailyEvent: 'Push a "new day" event daily',
    saveEcology: 'Save ecology settings',
    addGround: 'Add custom tile',
    builtin: 'built-in',
    custom: 'custom',
    selected: 'in use',
    remove: 'Remove',
    cropsTitle: 'Crops',
    cropsDesc: 'Add/remove crops, stage count, days per stage and sprites. Prices, edible flag and consume effects live on the Items page.',
    templateTitle: 'Settings template',
    templateDesc: 'Bundle all settings (custom.json) and every custom sprite into a ZIP for backup / moving / sharing.',
    templateNote: 'Import replaces all settings and sprites, but does not clear the field, bag or save. If the template removes a crop still planted in the save, the field will reinterpret it; export a backup first.',
    exportTpl: 'Export template ZIP',
    importTpl: 'Import template ZIP',
    confirmImport: 'Import settings template?',
    importWarn: 'This replaces all crops/weeds/ground/states/items/recipes and custom sprites, with no automatic rollback. Export a backup first.',
    exportedTpl: 'Template download started',
    importedTpl: 'Template imported',
    pickTpl: 'Pick a template ZIP',
    zipOnly: 'The template must be a .zip file.',
    addCrop: 'Add crop',
    weedsTitle: 'Weeds',
    weedsDesc: 'Add/remove weeds, stages, days per stage, spawn weight; with a produce item they can be harvested.',
    weedLayer: 'Layer',
    weedLayerTop: 'Top (foreground with crops/pet)',
    weedLayerBottom: 'Bottom (background, behind crops)',
    addWeed: 'Add weed',
    name: 'Name',
    stages: 'Stages',
    stageDays: 'Days per stage',
    stageN: (a, b) => 'Stage ' + a + ' → ' + b,
    daysTotal: (d) => d + ' days to mature',
    value: 'Produce value',
    seedPrice: 'Seed price',
    seed: 'Seed sprite',
    item: 'Produce sprite',
    stageSprite: 'Stage sprites',
    pick: 'Change',
    save: 'Save',
    reset: 'Reset',
    del: 'Delete',
    weight: 'Spawn weight',
    weightHint: (p) => p + '% of all weeds',
    harvestable: 'Harvestable (has produce)',
    itemName: 'Produce name',
    noItem: 'No produce',
    pickTitle: 'Pick a PNG sprite',
    onlyPng: 'PNG only (the overlay loads .png).',
    saved: 'Saved',
    deleted: 'Deleted',
    added: 'Added',
    confirmDel: (n) => 'Delete "' + n + '"?',
    confirmBody: 'Refused if the field still has it planted/growing.',
    addOk: 'Added — fill in the details and press Save.',
    err: 'Failed',
    emptyCrops: 'No crops yet.',
    emptyWeeds: 'No weeds yet.',
    totalDays: 'to mature',
    mode: 'custom',
    statusTitle: 'Water FX / wither',
    statusDesc: 'Water animation and wither sprite; the watering numbers live in Ecology. Applies on the next layer refresh.',
    waterEvap: 'Moisture lost / day',
    waterGain: 'Moisture per watering',
    wiltDays: 'Days dry before wilting',
    saveWater: 'Save watering',
    waterFx: 'Watering effect',
    pourFrames: 'Pour frames (over the plant)',
    burstFrames: 'Burst frames (on the ground)',
    addFrame: 'Add frame',
    frameMs: 'Frame ms',
    wither: 'Withered crop sprite',
    pickWither: 'Change',
    resetWither: 'Default',
    saveStatus: 'Save status',
    resetFx: 'Reset effect',
    none: '(none)',
  },
};

const isZh = (lang) => String(lang || '').toLowerCase().startsWith('zh');

function panel(ctx) {
  const { ui } = ctx;
  const T = isZh(ctx.language) ? TEXT.zh : TEXT.en;
  const root = ui.h('div', 'cf-root');
  ctx.root.appendChild(root);

  const urls = new Map();
  const revoke = { dispose() { for (const u of urls.values()) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } } urls.clear(); } };
  ctx.own(revoke);
  let snapshot = null;

  const toastError = (err) => ui.toast((err && err.message) || String(err), 'bad');

  async function call(method, args = [], opts = {}) {
    try {
      const data = await ctx.invoke(method, args);
      if (method !== 'state' && !opts.keep) {
        if (data && data.catalog) snapshot = data.catalog;
        else if (data && data.crops && data.ground) snapshot = data;
        render();
      }
      if (opts.toast) ui.toast(opts.toast);
      return data;
    } catch (err) {
      toastError(err);
      return null;
    }
  }

  function spriteUrl(name) {
    if (!name) return Promise.resolve(null);
    if (!urls.has(name)) {
      urls.set(name, ctx.invokeBinary('sprite', [name])
        .then((blob) => URL.createObjectURL(blob))
        .catch(() => null));
    }
    return urls.get(name);
  }

  function thumb(name, size = 40) {
    const box = ui.h('div', 'cf-thumb');
    box.style.width = size + 'px';
    box.style.height = size + 'px';
    if (!name) { box.classList.add('cf-missing'); box.textContent = '?'; return box; }
    const img = ui.h('img');
    img.alt = '';
    img.draggable = false;
    void spriteUrl(name).then((url) => { if (url) img.src = url; else { box.classList.add('cf-missing'); box.textContent = '?'; } });
    box.appendChild(img);
    return box;
  }

  function pickPng(title) {
    if (typeof ctx.pickPath !== 'function') { ui.toast(T.onlyPng, 'bad'); return Promise.resolve(null); }
    return ctx.pickPath({ kind: 'file', title: title || T.pickTitle, extensions: ['.png'] }).catch((err) => { toastError(err); return null; });
  }

  async function importSprite(kind, key, slot, draft, field, rerender) {
    const path = await pickPng(T.pickTitle);
    if (!path) return;
    if (!/\.png$/i.test(path)) { ui.toast(T.onlyPng, 'bad'); return; }
    const data = await call('importSprite', [kind, key, slot, path], { keep: true });
    if (!data || !data.sprite) return;
    if (slot === 'seed') draft.seedSprite = data.sprite;
    else if (slot === 'item') draft.itemSprite = data.sprite;
    else draft.sprites[Number(slot)] = data.sprite;
    if (field) field();
    ui.toast(T.saved);
  }

  // ---------------------------------------------------------------- 设置模板
  async function exportTemplate() {
    try {
      const blob = await ctx.invokeBinary('exportTemplate');
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const name = 'custom-farm-template-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
        '-' + p(d.getHours()) + p(d.getMinutes()) + '.zip';
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      ui.toast(T.exportedTpl);
    } catch (err) {
      toastError(err);
    }
  }

  async function importTemplate() {
    if (typeof ctx.pickPath !== 'function') { ui.toast(T.onlyPng, 'bad'); return; }
    const path = await ctx.pickPath({ kind: 'file', title: T.pickTpl, extensions: ['.zip'] }).catch((err) => {
      toastError(err);
      return null;
    });
    if (!path) return;
    if (!/\.zip$/i.test(path)) { ui.toast(T.zipOnly, 'bad'); return; }
    if (!(await ui.confirm({ title: T.confirmImport, body: T.importWarn, danger: true }))) return;
    settingsDraft = null;
    statusDraft = null;
    await call('importTemplate', [path], T.importedTpl);
  }

  function templateSection() {
    const sheet = ui.sheet({ title: T.templateTitle, desc: T.templateDesc });
    const bar = ui.rowbar();
    bar.append(
      ui.button(T.exportTpl, { variant: 'primary', onClick: () => void exportTemplate() }),
      ui.button(T.importTpl, { variant: 'primary', onClick: () => void importTemplate() }),
    );
    sheet.body.append(bar, ui.h('p', 'cf-note', T.templateNote));
    return sheet.el;
  }

  // ---------------------------------------------------------------- 地面
  function groundSection() {
    const sheet = ui.sheet({ title: T.title, desc: T.groundDesc });
    const grid = ui.h('div', 'cf-grid');
    const g = snapshot.ground;

    const tile = (entry, custom) => {
      // div 不是 button：里面还要放「删除」按钮，button 套 button 在 Chromium 里会被拆开
      const card = ui.h('div', 'cf-tile' + (g.selected === entry.id ? ' sel' : ''));
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.title = entry.name;
      card.append(
        thumb(entry.sprite, 56),
        ui.h('span', 'cf-tile-name', entry.name + (custom ? ' · ' + T.custom : '')),
      );
      if (g.selected === entry.id) card.append(ui.h('span', 'cf-tile-tag', T.selected));
      card.addEventListener('click', () => { void call('selectGround', [entry.id], { toast: T.saved }); }, { signal: ctx.signal });
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); card.click(); }
      }, { signal: ctx.signal });
      if (custom) {
        const del = ui.h('button', 'cf-x', '×');
        del.type = 'button';
        del.title = T.remove;
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          void (async () => {
            if (!(await ui.confirm({ title: T.confirmDel(entry.name), body: T.confirmBody, danger: true }))) return;
            await call('removeGround', [entry.id], { toast: T.deleted });
          })();
        }, { signal: ctx.signal });
        card.append(del);
      }
      return card;
    };

    for (const entry of g.builtin) grid.append(tile(entry, false));
    for (const entry of g.custom) grid.append(tile(entry, true));
    if (!g.builtin.length && !g.custom.length) grid.append(ui.placeholder(T.emptyCrops));

    const bar = ui.rowbar();
    const add = ui.button(T.addGround, {
      size: 'sm',
      variant: 'primary',
      onClick: () => void (async () => {
        const path = await pickPng(T.pickTitle);
        if (!path) return;
        if (!/\.png$/i.test(path)) { ui.toast(T.onlyPng, 'bad'); return; }
        const name = path.split(/[\\/]/).pop().replace(/\.png$/i, '').slice(0, 24);
        await call('addGround', [path, name], { toast: T.added });
      })(),
    });
    bar.append(add);
    const d = getSettings();
    const setRow = ui.h('div', 'cf-row');
    setRow.append(
      ui.field(T.farmSize, numberInput(d.farmCells, (v) => { d.farmCells = v; }, '1', '12')),
      ui.field(T.groundHeight, numberInput(d.groundHeight, (v) => { d.groundHeight = v; }, '1', '2')),
      ui.field(T.stripHeight, numberInput(d.stripHeight, (v) => { d.stripHeight = v; }, '10', '120')),
    );
    const saveBar = ui.rowbar();
    saveBar.append(ui.button(T.saveFarm, {
      variant: 'primary',
      onClick: () => void saveSettings(['farmCells', 'groundHeight', 'stripHeight'], T.saved),
    }));
    sheet.body.append(
      setRow,
      saveBar,
      ui.h('p', 'cf-note', T.farmSettingsHint),
      grid,
      bar,
    );
    return sheet.el;
  }

  // ---------------------------------------------------------------- 作物
  function stageCountSelect(value, onChange) {
    const sel = ui.select({ value: String(value), options: ['2', '3', '4', '5', '6', '7', '8'] });
    sel.addEventListener('change', () => onChange(Number(sel.value)), { signal: ctx.signal });
    return sel;
  }

  function numberInput(value, onChange, step = '1', min = '0') {
    const input = ui.input({ type: 'number', value: value === null || value === undefined ? '' : String(value) });
    input.step = step;
    input.min = min;
    input.addEventListener('input', () => { const n = Number(input.value); if (Number.isFinite(n)) onChange(n); }, { signal: ctx.signal });
    return input;
  }

  function textInput(value, onChange, placeholder = '') {
    const input = ui.input({ value: value ?? '', placeholder });
    input.maxLength = 24;
    input.addEventListener('input', () => onChange(input.value), { signal: ctx.signal });
    return input;
  }

  function resizeDays(draft) {
    const n = Math.max(1, draft.stages - 1);
    const next = [];
    for (let i = 0; i < n; i += 1) next.push(draft.days[i] ?? (draft.days[draft.days.length - 1] ?? 1));
    draft.days = next;
  }
  function resizeSprites(draft) {
    const next = [];
    for (let i = 0; i < draft.stages; i += 1) next.push(draft.sprites[i] ?? null);
    draft.sprites = next;
  }

  function cropCard(c) {
    const draft = {
      key: c.key,
      builtin: c.builtin,
      name: c.name,
      stages: c.stages,
      days: [...c.days],
      value: c.value,
      seedPrice: c.seedPrice,
      sprites: [...c.sprites],
      seedSprite: c.seedSprite,
      itemSprite: c.itemSprite,
      preview: [...c.preview],
      previewSeed: c.previewSeed,
      previewItem: c.previewItem,
    };
    const details = ui.h('details', 'cf-card');
    if (!c.builtin) details.open = false;
    const summary = ui.h('summary', 'cf-head');
    const title = ui.h('strong', 'cf-name', c.name);
    summary.append(
      title,
      ui.pill(c.builtin ? T.builtin : T.custom, c.builtin ? 'plain' : 'on'),
      ui.chip(c.stages + ' 阶段', 'plain'),
      ui.chip(T.daysTotal(c.totalDays), 'plain'),
    );
    const body = ui.h('div', 'cf-body');
    details.append(summary, body);

    const row1 = ui.h('div', 'cf-row');
    row1.append(
      ui.field(T.name, textInput(draft.name, (v) => { draft.name = v; title.textContent = v || c.key; })),
      ui.field(T.stages, stageCountSelect(draft.stages, (v) => {
        draft.stages = v;
        resizeDays(draft);
        resizeSprites(draft);
        paintStages();
      })),
    );

    const stagesBox = ui.h('div', 'cf-stages');
    function paintStages() {
      stagesBox.replaceChildren();
      for (let i = 0; i < draft.stages - 1; i += 1) {
        const cell = ui.h('div', 'cf-stage');
        cell.append(
          ui.h('span', 'cf-note', T.stageN(i + 1, i + 2)),
          numberInput(draft.days[i], (v) => { draft.days[i] = v; }, '0.05', '0.05'),
        );
        stagesBox.append(cell);
      }
    }
    paintStages();

    const spriteBox = ui.h('div', 'cf-sprites');
    function paintSprites() {
      spriteBox.replaceChildren();
      for (let i = 0; i < draft.stages; i += 1) {
        const cell = ui.h('div', 'cf-sprite');
        const imgName = draft.sprites[i] || draft.preview[i];
        cell.append(
          ui.h('span', 'cf-note', '阶段 ' + (i + 1)),
          thumb(imgName, 36),
          ui.button(T.pick, { size: 'sm', onClick: () => void importSprite('crop', draft.key, i, draft, () => { draft.preview[i] = draft.sprites[i]; paintSprites(); }) }),
        );
        spriteBox.append(cell);
      }
      const seed = ui.h('div', 'cf-sprite');
      seed.append(
        ui.h('span', 'cf-note', T.seed),
        thumb(draft.seedSprite || draft.previewSeed, 36),
        ui.button(T.pick, { size: 'sm', onClick: () => void importSprite('crop', draft.key, 'seed', draft, () => { draft.previewSeed = draft.seedSprite; paintSprites(); }) }),
      );
      const item = ui.h('div', 'cf-sprite');
      item.append(
        ui.h('span', 'cf-note', T.item),
        thumb(draft.itemSprite || draft.previewItem, 36),
        ui.button(T.pick, { size: 'sm', onClick: () => void importSprite('crop', draft.key, 'item', draft, () => { draft.previewItem = draft.itemSprite; paintSprites(); }) }),
      );
      spriteBox.append(seed, item);
    }
    paintSprites();

    const actions = ui.actions();
    const save = ui.button(T.save, {
      variant: 'primary',
      onClick: () => void (async () => {
        const off = ui.disable(save);
        await call('saveCrop', [{
          key: draft.key,
          name: draft.name,
          stages: draft.stages,
          days: draft.days,
          value: draft.value,
          seedPrice: draft.seedPrice,
          sprites: draft.sprites,
          seedSprite: draft.seedSprite,
          itemSprite: draft.itemSprite,
        }], { toast: T.saved });
        off.dispose();
      })(),
    });
    actions.append(save);
    if (c.builtin) {
      actions.append(ui.button(T.reset, {
        size: 'sm',
        onClick: () => void (async () => { await call('resetCrop', [c.key], { toast: T.saved }); })(),
      }));
    }
    actions.append(ui.button(T.del, {
      size: 'sm',
      variant: 'danger',
      onClick: () => void (async () => {
        if (!(await ui.confirm({ title: T.confirmDel(c.name), body: T.confirmBody, danger: true }))) return;
        await call('removeCrop', [c.key], { toast: T.deleted });
      })(),
    }));

    body.append(row1, ui.h('div', 'cf-sub', T.stageDays), stagesBox, ui.h('hr', 'cf-hr2'), ui.h('div', 'cf-sub', T.stageSprite), spriteBox, actions);
    return details;
  }

  function cropsSection() {
    const sheet = ui.sheet({ title: T.cropsTitle, desc: T.cropsDesc });
    const d = getSettings();
    const setRow = ui.h('div', 'cf-row');
    setRow.append(
      ui.field(T.maxPlants, numberInput(d.maxPlants, (v) => { d.maxPlants = v; }, '1', '1')),
      ui.field(T.cropGapScale, numberInput(d.cropGapScale, (v) => { d.cropGapScale = v; }, '0.05', '0.5')),
      ui.field(T.cropGapPct, numberInput(d.cropGapPct, (v) => { d.cropGapPct = v; }, '0.1', '0')),
      ui.field(T.cropScale, numberInput(d.cropScale, (v) => { d.cropScale = v; }, '0.05', '0.3')),
      ui.field(T.dropScale, numberInput(d.dropScale, (v) => { d.dropScale = v; }, '0.05', '0.3')),
    );
    const saveBar = ui.rowbar();
    saveBar.append(ui.button(T.saveCropSettings, {
      variant: 'primary',
      onClick: () => void saveSettings(['maxPlants', 'cropGapScale', 'cropGapPct', 'cropScale', 'dropScale'], T.saved),
    }));
    const list = ui.h('div', 'cf-list');
    if (!snapshot.crops.length) list.append(ui.placeholder(T.emptyCrops));
    for (const c of snapshot.crops) list.append(cropCard(c));
    const bar = ui.rowbar();
    bar.append(ui.button(T.addCrop, {
      size: 'sm',
      variant: 'primary',
      onClick: () => void (async () => { await call('saveCrop', [{}], { toast: T.addOk }); })(),
    }));
    sheet.body.append(setRow, saveBar, ui.h('hr', 'cf-hr2'), list, bar);
    return sheet.el;
  }

  // ---------------------------------------------------------------- 杂草
  function weedCard(w, totalWeight) {
    const draft = {
      key: w.key,
      builtin: w.builtin,
      name: w.name,
      stages: w.stages,
      days: [...w.days],
      weight: w.weight,
      sprites: [...w.sprites],
      itemName: w.itemName,
      value: w.value,
      itemSprite: w.itemSprite,
      preview: [...w.preview],
      previewItem: w.previewItem,
      layer: w.layer === 'bottom' ? 'bottom' : 'top',
    };
    const details = ui.h('details', 'cf-card');
    const summary = ui.h('summary', 'cf-head');
    const title = ui.h('strong', 'cf-name', w.name);
    const share = totalWeight > 0 ? Math.round((w.weight / totalWeight) * 100) : 0;
    summary.append(
      title,
      ui.pill(w.builtin ? T.builtin : T.custom, w.builtin ? 'plain' : 'on'),
      ui.chip(w.stages + ' 阶段', 'plain'),
      ui.chip(T.daysTotal(w.totalDays), 'plain'),
      ui.chip(T.weightHint(share), 'plain'),
      ui.chip(w.layer === 'bottom' ? T.weedLayerBottom : T.weedLayerTop, w.layer === 'bottom' ? 'plain' : 'on'),
    );
    const body = ui.h('div', 'cf-body');
    details.append(summary, body);

    const layerSel = ui.select({
      value: draft.layer,
      options: [
        { value: 'top', label: T.weedLayerTop },
        { value: 'bottom', label: T.weedLayerBottom },
      ],
    });
    layerSel.addEventListener('change', () => { draft.layer = layerSel.value; }, { signal: ctx.signal });

    const row1 = ui.h('div', 'cf-row');
    row1.append(
      ui.field(T.name, textInput(draft.name, (v) => { draft.name = v; title.textContent = v || w.key; })),
      ui.field(T.stages, stageCountSelect(draft.stages, (v) => {
        draft.stages = v;
        resizeDays(draft);
        resizeSprites(draft);
        paintStages();
      })),
      ui.field(T.weight, numberInput(draft.weight, (v) => { draft.weight = v; }, '1', '0')),
      ui.field(T.weedLayer, layerSel),
    );

    const harvestRow = ui.h('div', 'cf-row');
    const itemOn = ui.checkbox(T.harvestable, { checked: draft.value > 0 || Boolean(draft.itemName) });
    const itemName = textInput(draft.itemName, (v) => { draft.itemName = v; }, T.itemName);
    itemName.disabled = !itemOn.checked;
    const itemValue = numberInput(draft.value, (v) => { draft.value = v; });
    itemValue.disabled = !itemOn.checked;
    itemOn.el.addEventListener('change', () => {
      itemName.disabled = !itemOn.checked;
      itemValue.disabled = !itemOn.checked;
      if (!itemOn.checked) { draft.itemName = ''; draft.value = 0; itemName.value = ''; itemValue.value = '0'; }
    }, { signal: ctx.signal });
    harvestRow.append(itemOn.el, ui.field(T.itemName, itemName), ui.field(T.value, itemValue));

    const stagesBox = ui.h('div', 'cf-stages');
    function paintStages() {
      stagesBox.replaceChildren();
      for (let i = 0; i < draft.stages - 1; i += 1) {
        const cell = ui.h('div', 'cf-stage');
        cell.append(
          ui.h('span', 'cf-note', T.stageN(i + 1, i + 2)),
          numberInput(draft.days[i], (v) => { draft.days[i] = v; }, '0.05', '0.05'),
        );
        stagesBox.append(cell);
      }
    }
    paintStages();

    const spriteBox = ui.h('div', 'cf-sprites');
    function paintSprites() {
      spriteBox.replaceChildren();
      for (let i = 0; i < draft.stages; i += 1) {
        const cell = ui.h('div', 'cf-sprite');
        cell.append(
          ui.h('span', 'cf-note', '阶段 ' + (i + 1)),
          thumb(draft.sprites[i] || draft.preview[i], 36),
          ui.button(T.pick, { size: 'sm', onClick: () => void importSprite('weed', draft.key, i, draft, () => { draft.preview[i] = draft.sprites[i]; paintSprites(); }) }),
        );
        spriteBox.append(cell);
      }
      const item = ui.h('div', 'cf-sprite');
      item.append(
        ui.h('span', 'cf-note', T.item),
        thumb(draft.itemSprite || draft.previewItem, 36),
        ui.button(T.pick, { size: 'sm', onClick: () => void importSprite('weed', draft.key, 'item', draft, () => { draft.previewItem = draft.itemSprite; paintSprites(); }) }),
      );
      spriteBox.append(item);
    }
    paintSprites();

    const actions = ui.actions();
    const save = ui.button(T.save, {
      variant: 'primary',
      onClick: () => void (async () => {
        const off = ui.disable(save);
        await call('saveWeed', [{
          key: draft.key,
          name: draft.name,
          stages: draft.stages,
          days: draft.days,
          weight: draft.weight,
          sprites: draft.sprites,
          itemName: draft.itemName,
          value: draft.value,
          itemSprite: draft.itemSprite,
          layer: draft.layer,
        }], { toast: T.saved });
        off.dispose();
      })(),
    });
    actions.append(save);
    if (w.builtin) {
      actions.append(ui.button(T.reset, { size: 'sm', onClick: () => void (async () => { await call('resetWeed', [w.key], { toast: T.saved }); })() }));
    }
    actions.append(ui.button(T.del, {
      size: 'sm',
      variant: 'danger',
      onClick: () => void (async () => {
        if (!(await ui.confirm({ title: T.confirmDel(w.name), body: T.confirmBody, danger: true }))) return;
        await call('removeWeed', [w.key], { toast: T.deleted });
      })(),
    }));

    body.append(row1, harvestRow, ui.h('div', 'cf-sub', T.stageDays), stagesBox, ui.h('hr', 'cf-hr2'), ui.h('div', 'cf-sub', T.stageSprite), spriteBox, actions);
    return details;
  }

  function weedsSection() {
    const sheet = ui.sheet({ title: T.weedsTitle, desc: T.weedsDesc });
    const d = getSettings();
    const setRow = ui.h('div', 'cf-row');
    setRow.append(
      ui.field(T.startWeeds, numberInput(d.startWeeds, (v) => { d.startWeeds = v; }, '1', '0')),
      ui.field(T.maxWeeds, numberInput(d.maxWeeds, (v) => { d.maxWeeds = v; }, '1', '0')),
      ui.field(T.weedPerDay, numberInput(d.weedPerDay, (v) => { d.weedPerDay = v; }, '0.05', '0')),
      ui.field(T.weedClearRadius, numberInput(d.weedClearRadius, (v) => { d.weedClearRadius = v; }, '0.005', '0')),
    );
    const saveBar = ui.rowbar();
    saveBar.append(ui.button(T.saveWeedSettings, {
      variant: 'primary',
      onClick: () => void saveSettings(['startWeeds', 'maxWeeds', 'weedPerDay', 'weedClearRadius'], T.saved),
    }));
    const list = ui.h('div', 'cf-list');
    const total = snapshot.weeds.reduce((a, w) => a + Number(w.weight || 0), 0);
    if (!snapshot.weeds.length) list.append(ui.placeholder(T.emptyWeeds));
    for (const w of snapshot.weeds) list.append(weedCard(w, total));
    const bar = ui.rowbar();
    bar.append(ui.button(T.addWeed, {
      size: 'sm',
      variant: 'primary',
      onClick: () => void (async () => { await call('saveWeed', [{}], { toast: T.addOk }); })(),
    }));
    sheet.body.append(setRow, saveBar, ui.h('p', 'cf-note', T.weedSettingsHint), ui.h('hr', 'cf-hr2'), list, bar);
    return sheet.el;
  }

  // ---------------------------------------------------------------- 农作物状态
  let statusDraft = null;
  let settingsDraft = null;
  let paintStatus = () => {};

  function cloneSettings(s) {
    const src = s ?? {};
    return {
      farmCells: Number(src.farmCells ?? 48),
      groundHeight: Number(src.groundHeight ?? 5),
      stripHeight: Number(src.stripHeight ?? 320),
      moodIntervalMin: Number(src.moodIntervalMin ?? 10),
      maxPlants: Number(src.maxPlants ?? 12),
      cropGapScale: Number(src.cropGapScale ?? 0.8),
      cropGapPct: Number(src.cropGapPct ?? 2),
      cropScale: Number(src.cropScale ?? 1.5),
      dropScale: Number(src.dropScale ?? 0.6),
      startWeeds: Number(src.startWeeds ?? 42),
      maxWeeds: Number(src.maxWeeds ?? 46),
      weedPerDay: Number(src.weedPerDay ?? 0.55),
      weedClearRadius: Number(src.weedClearRadius ?? 0.03),
      realMinutesPerDay: Number(src.realMinutesPerDay ?? 60),
      maxStepDays: Number(src.maxStepDays ?? 1),
      tickIntervalMs: Number(src.tickIntervalMs ?? 5000),
      dailyEvent: Boolean(src.dailyEvent),
      water: {
        dryPerDay: Number(src.water?.dryPerDay ?? 0.15),
        waterGain: Number(src.water?.waterGain ?? 1),
        wiltDays: Number(src.water?.wiltDays ?? 2.2),
      },
    };
  }

  function getSettings() {
    if (!settingsDraft) settingsDraft = cloneSettings(snapshot.settings);
    return settingsDraft;
  }

  async function saveSettings(keys, toast) {
    const d = getSettings();
    const payload = {};
    for (const key of keys) {
      if (key === 'water') payload.water = { ...d.water };
      else payload[key] = d[key];
    }
    settingsDraft = null;
    statusDraft = null;
    await call('saveSettings', [payload], { toast });
  }

  function cloneStatus(s) {
    return {
      water: {
        dryPerDay: Number(s.water.dryPerDay),
        waterGain: Number(s.water.waterGain),
        wiltDays: Number(s.water.wiltDays),
      },
      fx: {
        pour: [...s.fx.pour],
        burst: [...s.fx.burst],
        pourMs: Number(s.fx.pourMs),
        burstMs: Number(s.fx.burstMs),
      },
      wither: s.wither ?? null,
    };
  }

  function frameStrip(kind, title, draft) {
    const box = ui.h('div', 'cf-fxblock');
    box.append(ui.h('div', 'cf-sub', title));
    const list = ui.h('div', 'cf-frames');
    const frames = draft.fx[kind];
    frames.forEach((name, idx) => {
      const cell = ui.h('div', 'cf-frame');
      const del = ui.h('button', 'cf-x', '×');
      del.type = 'button';
      del.title = T.remove;
      del.addEventListener('click', () => { frames.splice(idx, 1); paintStatus(); }, { signal: ctx.signal });
      cell.append(thumb(name, 40), ui.h('span', 'cf-note', '#' + (idx + 1)), del);
      list.append(cell);
    });
    if (!frames.length) list.append(ui.h('span', 'cf-note', T.none));
    const add = ui.button(T.addFrame, {
      size: 'sm',
      onClick: () => void (async () => {
        const path = await pickPng(T.pickTitle);
        if (!path) return;
        if (!/\.png$/i.test(path)) { ui.toast(T.onlyPng, 'bad'); return; }
        const r = await call('importSprite', ['fx', kind, frames.length, path], { keep: true });
        if (r && r.sprite) { frames.push(r.sprite); paintStatus(); ui.toast(T.saved); }
      })(),
    });
    const bar = ui.h('div', 'cf-row');
    const ms = numberInput(draft.fx[kind + 'Ms'], (v) => { draft.fx[kind + 'Ms'] = v; }, '5', '10');
    bar.append(ui.field(T.frameMs, ms), add);
    box.append(list, bar);
    return box;
  }

  // ---------------------------------------------------------------- 生态
  function ecologySection() {
    const sheet = ui.sheet({ title: T.ecologyTitle, desc: T.ecologyDesc });
    const d = getSettings();
    const timeRow = ui.h('div', 'cf-row');
    timeRow.append(
      ui.field(T.timePerDay, numberInput(d.realMinutesPerDay, (v) => { d.realMinutesPerDay = v; }, '0.5', '0.5')),
      ui.field(T.maxStepDays, numberInput(d.maxStepDays, (v) => { d.maxStepDays = v; }, '0.1', '0.01')),
      ui.field(T.tickMs, numberInput(d.tickIntervalMs, (v) => { d.tickIntervalMs = v; }, '100', '1000')),
    );
    const daily = ui.checkbox(T.dailyEvent, {
      checked: Boolean(d.dailyEvent),
      onChange: (v) => { d.dailyEvent = v; },
    }).el;
    const waterRow = ui.h('div', 'cf-row');
    waterRow.append(
      ui.field(T.waterEvap, numberInput(d.water.dryPerDay, (v) => { d.water.dryPerDay = v; }, '0.01', '0')),
      ui.field(T.waterGain, numberInput(d.water.waterGain, (v) => { d.water.waterGain = v; }, '0.05', '0')),
      ui.field(T.wiltDays, numberInput(d.water.wiltDays, (v) => { d.water.wiltDays = v; }, '0.1', '0.01')),
    );
    const saveBar = ui.rowbar();
    saveBar.append(ui.button(T.saveEcology, {
      variant: 'primary',
      onClick: () => void saveSettings(['realMinutesPerDay', 'maxStepDays', 'tickIntervalMs', 'dailyEvent', 'water'], T.saved),
    }));
    sheet.body.append(
      ui.h('strong', 'cf-note', T.ecologyTime),
      timeRow,
      daily,
      ui.h('hr', 'cf-hr2'),
      ui.h('strong', 'cf-note', T.ecologyWater),
      waterRow,
      saveBar,
    );
    return sheet.el;
  }

  function statusSection() {
    if (!statusDraft) statusDraft = cloneStatus(snapshot.status);
    const sheet = ui.sheet({ title: T.statusTitle, desc: T.statusDesc });
    const host = ui.h('div', 'cf-status');

    async function saveStatus() {
      const payload = cloneStatus(statusDraft);
      statusDraft = null;
      await call('saveStatus', [payload], { toast: T.saved });
    }
    async function resetFx() {
      statusDraft = null;
      await call('resetFx', [], { toast: T.saved });
    }

    paintStatus = () => {
      const d = statusDraft;
      host.replaceChildren();

      const witherCell = ui.h('div', 'cf-sprite');
      witherCell.append(
        thumb(d.wither || 'sprite_crop_wither_universal', 48),
        ui.h('span', 'cf-note', d.wither ? T.custom : T.builtin),
      );
      const witherPick = ui.button(T.pickWither, {
        size: 'sm',
        onClick: () => void (async () => {
          const path = await pickPng(T.pickTitle);
          if (!path) return;
          if (!/\.png$/i.test(path)) { ui.toast(T.onlyPng, 'bad'); return; }
          const r = await call('importSprite', ['wither', 'wither', 0, path], { keep: true });
          if (r && r.sprite) { d.wither = r.sprite; paintStatus(); ui.toast(T.saved); }
        })(),
      });
      const witherReset = ui.button(T.resetWither, { size: 'sm', onClick: () => { d.wither = null; paintStatus(); } });
      const witherRow = ui.h('div', 'cf-row');
      witherRow.append(ui.field(T.wither, witherCell), witherPick, witherReset);

      const actions = ui.actions();
      actions.append(
        ui.button(T.saveStatus, { variant: 'primary', onClick: () => void saveStatus() }),
        ui.button(T.resetFx, { size: 'sm', onClick: () => void resetFx() }),
      );

      host.append(
        frameStrip('pour', T.pourFrames, d),
        frameStrip('burst', T.burstFrames, d),
        ui.h('hr', 'cf-hr2'),
        witherRow,
        actions,
      );
    };
    paintStatus();
    sheet.body.append(host);
    return sheet.el;
  }

  // ---------------------------------------------------------------- 渲染
  function render() {
    if (!snapshot) return;
    const scroll = root.scrollTop;
    root.replaceChildren();
    root.append(templateSection());
    root.append(ui.h('hr', 'cf-hr'));
    root.append(groundSection());
    root.append(ui.h('hr', 'cf-hr'));
    root.append(cropsSection());
    root.append(ui.h('hr', 'cf-hr'));
    root.append(weedsSection());
    root.append(ui.h('hr', 'cf-hr'));
    root.append(statusSection());
    root.scrollTop = scroll;
  }

  (async () => {
    try {
      const data = await ctx.invoke('state');
      snapshot = data && data.catalog ? data.catalog : data;
      render();
    } catch (err) {
      toastError(err);
    }
  })();
}



// ============================================================================
// 「状态自定义」面板：数值/开关状态 + 条件规则（例：饱食度 < 30 → 饥饿）
// ============================================================================
const ST = {
  zh: {
    states: '状态',
    statesDesc: '数值状态会按「每游戏日变化」自动增减；开关状态可以由下面的条件规则点亮。点标题展开一张卡。',
    rules: '条件',
    rulesDesc: '当数值状态满足不等式时，让目标开关状态生效。可以多条规则指向同一个开关（满足任意一条即生效）。点标题展开。',
    addNumber: '添加数值状态',
    addFlag: '添加开关状态',
    addRule: '添加条件',
    addExample: '补齐示例：饱食度 / 饥饿 / 食物效果',
    exampleDone: '示例已补齐',
    name: '名字',
    kind: '类型',
    number: '数值',
    flag: '开关',
    min: '最小值',
    max: '最大值',
    initial: '初始值',
    drift: '每游戏日变化',
    unit: '单位',
    initialActive: '初始生效',
    current: '当前',
    set: '设为',
    apply: '应用',
    turnOn: '设为生效',
    turnOff: '设为未生效',
    on: '生效',
    off: '未生效',
    save: '保存',
    del: '删除',
    saveRule: '保存条件',
    when: '当',
    then: '→ 让',
    active: '生效',
    source: '数值状态',
    target: '目标开关',
    op: '比较',
    value: '阈值',
    noStates: '还没有状态。可以点「添加示例」先看看。',
    noRules: '还没有条件。',
    needFlag: '先添加一个开关状态（比如「饥饿」），条件才有目标。',
    needNumber: '先添加一个数值状态（比如「饱食度」），条件才有来源。',
    confirmDel: (n) => '删除「' + n + '」？引用它的条件也会一起删掉。',
    saved: '已保存',
    deleted: '已删除',
    err: '操作失败',
    builtin: '示例',
    consumeTitle: '消耗行为',
    consumeDesc: '触发状态生效（开关生效 / 数值 > 0）且冷却到了，就自动吃掉（或提醒桌宠吃掉）选中的道具；吃掉后可以改另一个数值状态，比如把饱食度加回来。',
    addConsume: '添加消耗行为',
    trigger: '触发状态',
    consumeItems: '可消耗道具',
    count: '一次消耗',
    effect: '吃掉后改变',
    effectDelta: '变化量',
    cooldown: '冷却（游戏日）',
    auto: '自动消耗（关掉＝只提醒桌宠）',
    saveConsume: '保存消耗行为',
    noConsume: '还没有消耗行为。',
    noEffect: '不改状态',
    needItems: '至少勾选一种道具。',
    needStates: '先添加一个状态。',
    needFood: '背包里还没有可吃的道具，先种点东西。',
    consumeThen: '生效 → 吃',
    promptOnly: '只提醒',
    autoTag: '自动',
    noneFood: '（没选道具）',
  },
  en: {
    states: 'States',
    statesDesc: 'Number states change by "per game day"; flag states can be turned on by the rules below. Click a title to expand.',
    rules: 'Rules',
    rulesDesc: 'When a number state satisfies the comparison, the target flag becomes active. Several rules may target the same flag (any one is enough). Click a title to expand.',
    addNumber: 'Add number state',
    addFlag: 'Add flag state',
    addRule: 'Add rule',
    addExample: 'Fill in example: satiety / hunger / food effects',
    exampleDone: 'Example filled in',
    name: 'Name',
    kind: 'Kind',
    number: 'Number',
    flag: 'Flag',
    min: 'Min',
    max: 'Max',
    initial: 'Initial',
    drift: 'Change / game day',
    unit: 'Unit',
    initialActive: 'Active initially',
    current: 'Current',
    set: 'Set',
    apply: 'Apply',
    turnOn: 'Turn on',
    turnOff: 'Turn off',
    on: 'Active',
    off: 'Inactive',
    save: 'Save',
    del: 'Delete',
    saveRule: 'Save rule',
    when: 'When',
    then: '→ turn on',
    active: 'active',
    source: 'Number state',
    target: 'Target flag',
    op: 'Compare',
    value: 'Threshold',
    noStates: 'No states yet. Try "Add example".',
    noRules: 'No rules yet.',
    needFlag: 'Add a flag state first (e.g. "Hunger") so a rule has a target.',
    needNumber: 'Add a number state first (e.g. "Satiety") so a rule has a source.',
    confirmDel: (n) => 'Delete "' + n + '"? Rules using it are removed too.',
    saved: 'Saved',
    deleted: 'Deleted',
    err: 'Failed',
    builtin: 'example',
    consumeTitle: 'Consume actions',
    consumeDesc: 'When the trigger state is active (flag on / number > 0) and the cooldown has passed, eat (or ask the pet to eat) one of the chosen items; eating can change another number state, e.g. add satiety back.',
    addConsume: 'Add consume action',
    trigger: 'Trigger state',
    consumeItems: 'Items to consume',
    count: 'Amount',
    effect: 'Change after eating',
    effectDelta: 'Delta',
    cooldown: 'Cooldown (game days)',
    auto: 'Auto consume (off = just remind the pet)',
    saveConsume: 'Save consume action',
    noConsume: 'No consume actions yet.',
    noEffect: 'No state change',
    needItems: 'Pick at least one item.',
    needStates: 'Add a state first.',
    needFood: 'Nothing edible in the bag yet — grow something.',
    consumeThen: 'active → eat',
    promptOnly: 'remind only',
    autoTag: 'auto',
    noneFood: '(no items)',
  },
};

function statusPanel(ctx) {
  const { ui } = ctx;
  const T = isZh(ctx.language) ? ST.zh : ST.en;
  const root = ui.h('div', 'cf-root');
  ctx.root.appendChild(root);
  let snap = null;

  async function call(method, args = [], toast) {
    try {
      const data = await ctx.invoke(method, args);
      snap = data;
      render();
      if (toast) ui.toast(toast);
      return data;
    } catch (err) {
      ui.toast((err && err.message) || String(err), 'bad');
      return null;
    }
  }

  function num(value, onChange, step = '1') {
    const input = ui.input({ type: 'number', value: value === null || value === undefined ? '' : String(value) });
    input.step = step;
    input.addEventListener('input', () => { const n = Number(input.value); if (Number.isFinite(n)) onChange(n); }, { signal: ctx.signal });
    return input;
  }

  function text(value, onChange, placeholder = '') {
    const input = ui.input({ value: value ?? '', placeholder });
    input.maxLength = 24;
    input.addEventListener('input', () => onChange(input.value), { signal: ctx.signal });
    return input;
  }

  function select(options, value, onChange) {
    const el = ui.select({ value: String(value), options });
    el.addEventListener('change', () => onChange(el.value), { signal: ctx.signal });
    return el;
  }

  function stateCard(d) {
    const draft = {
      id: d.id,
      name: d.name,
      kind: d.kind,
      min: d.min,
      max: d.max,
      initial: d.initial,
      driftPerDay: d.driftPerDay,
      unit: d.unit,
      initialActive: d.initialActive,
      value: d.value,
      active: d.active,
    };
    const details = ui.h('details', 'cf-card');
    const head = ui.h('summary', 'cf-head');
    const nameEl = ui.h('strong', 'cf-name', d.name);
    const currentText = () => (d.kind === 'flag' ? (d.active ? T.on : T.off) : String(d.value ?? '') + (d.unit ? ' ' + d.unit : ''));
    const currentChip = ui.chip(T.current + ' ' + currentText(), d.kind === 'flag' ? (d.active ? 'warn' : 'plain') : 'plain');
    head.append(nameEl, ui.pill(d.kind === 'flag' ? T.flag : T.number, 'plain'), currentChip);
    const body = ui.h('div', 'cf-body');

    const fields = ui.h('div', 'cf-row');
    const paintFields = () => {
      fields.replaceChildren();
      fields.append(ui.field(T.name, text(draft.name, (v) => { draft.name = v; nameEl.textContent = v || d.id; })));
      fields.append(ui.field(T.kind, select([
        { value: 'number', label: T.number },
        { value: 'flag', label: T.flag },
      ], draft.kind, (v) => { draft.kind = v; paintFields(); })));
      if (draft.kind === 'flag') {
        const cb = ui.checkbox(T.initialActive, { checked: Boolean(draft.initialActive), onChange: (v) => { draft.initialActive = v; } });
        fields.append(cb.el);
      } else {
        fields.append(
          ui.field(T.min, num(draft.min, (v) => { draft.min = v; }, '0.1')),
          ui.field(T.max, num(draft.max, (v) => { draft.max = v; }, '0.1')),
          ui.field(T.initial, num(draft.initial, (v) => { draft.initial = v; }, '0.1')),
          ui.field(T.drift, num(draft.driftPerDay, (v) => { draft.driftPerDay = v; }, '0.1')),
          ui.field(T.unit, text(draft.unit, (v) => { draft.unit = v; })),
        );
      }
    };
    paintFields();

    const liveRow = ui.h('div', 'cf-row');
    if (d.kind === 'flag') {
      liveRow.append(ui.h('span', 'cf-note', T.current + '：' + (d.active ? T.on : T.off)));
      liveRow.append(ui.button(d.active ? T.turnOff : T.turnOn, {
        size: 'sm',
        onClick: () => void call('setValue', [d.id, !d.active], T.saved),
      }));
    } else {
      const input = num(d.value, () => {}, '0.1');
      liveRow.append(ui.h('span', 'cf-note', T.current + '：' + d.value + (d.unit ? ' ' + d.unit : '') + ' / ' + d.max));
      const apply = ui.button(T.apply, { size: 'sm', onClick: () => void call('setValue', [d.id, Number(input.value)], T.saved) });
      const wrap = ui.h('div', 'cf-row');
      wrap.append(ui.field(T.set, input), apply);
      liveRow.append(wrap);
    }

    const actions = ui.actions();
    const save = ui.button(T.save, {
      variant: 'primary',
      onClick: () => void (async () => {
        const off = ui.disable(save);
        await call('saveState', [draft], T.saved);
        off.dispose();
      })(),
    });
    actions.append(save, ui.button(T.del, {
      size: 'sm',
      variant: 'danger',
      onClick: () => void (async () => {
        if (!(await ui.confirm({ title: T.confirmDel(d.name), body: '', danger: true }))) return;
        await call('removeState', [d.id], T.deleted);
      })(),
    }));

    body.append(fields, ui.h('hr', 'cf-hr2'), liveRow, actions);
    details.append(head, body);
    return details;
  }

  function ruleCard(r) {
    const numeric = snap.states.filter((s) => s.kind === 'number');
    const flags = snap.states.filter((s) => s.kind === 'flag');
    const draft = { id: r.id, source: r.source, op: r.op, value: r.value, target: r.target };
    const details = ui.h('details', 'cf-card');
    const head = ui.h('summary', 'cf-head');
    head.append(
      ui.h('strong', 'cf-name', T.when + ' ' + r.sourceName + ' ' + r.op + ' ' + r.value + ' ' + T.then + ' ' + r.targetName),
      ui.pill(r.current ? T.on : T.off, r.current ? 'warn' : 'plain'),
    );
    const body = ui.h('div', 'cf-body');
    const row = ui.h('div', 'cf-row');
    row.append(
      ui.field(T.source, select(numeric.map((s) => ({ value: s.id, label: s.name })), draft.source, (v) => { draft.source = v; })),
      ui.field(T.op, select(['<', '<=', '>', '>=', '==', '!='], draft.op, (v) => { draft.op = v; })),
      ui.field(T.value, num(draft.value, (v) => { draft.value = v; }, '0.1')),
      ui.field(T.target, select(flags.map((s) => ({ value: s.id, label: s.name })), draft.target, (v) => { draft.target = v; })),
    );
    const actions = ui.actions();
    actions.append(
      ui.button(T.saveRule, { variant: 'primary', onClick: () => void call('saveRule', [draft], T.saved) }),
      ui.button(T.del, {
        size: 'sm',
        variant: 'danger',
        onClick: () => void (async () => {
          if (!(await ui.confirm({ title: T.confirmDel(T.when + ' ' + r.sourceName + ' ' + r.op + ' ' + r.value), body: '', danger: true }))) return;
          await call('removeRule', [r.id], T.deleted);
        })(),
      }),
    );
    body.append(row, actions);
    details.append(head, body);
    return details;
  }

  function consumeCard(c) {
    const numeric = snap.states.filter((s) => s.kind === 'number');
    const draft = {
      id: c.id,
      trigger: c.trigger,
      items: [...c.items],
      count: c.count,
      effectState: c.effectState ?? '',
      effectDelta: c.effectDelta,
      cooldownDays: c.cooldownDays,
      auto: c.auto,
      enabled: c.enabled,
    };
    const details = ui.h('details', 'cf-card');
    const head = ui.h('summary', 'cf-head');
    const itemNames = c.itemNames.length ? c.itemNames.join('、') : T.noneFood;
    const eff = c.effectName ? c.effectName + ' ' + (c.effectDelta >= 0 ? '+' : '') + c.effectDelta : T.noEffect;
    head.append(
      ui.h('strong', 'cf-name', T.when + ' ' + c.triggerName + ' ' + T.consumeThen + ' ' + itemNames + ' ×' + c.count + ' → ' + eff),
      ui.pill(c.auto ? T.autoTag : T.promptOnly, c.auto ? 'plain' : 'off'),
    );
    const body = ui.h('div', 'cf-body');

    const row = ui.h('div', 'cf-row');
    row.append(
      ui.field(T.trigger, select(snap.states.map((s) => ({ value: s.id, label: s.name })), draft.trigger, (v) => { draft.trigger = v; })),
      ui.field(T.effect, select([{ value: '', label: T.noEffect }, ...numeric.map((s) => ({ value: s.id, label: s.name }))], draft.effectState ?? '', (v) => { draft.effectState = v; })),
      ui.field(T.effectDelta, num(draft.effectDelta, (v) => { draft.effectDelta = v; }, '0.1')),
      ui.field(T.count, num(draft.count, (v) => { draft.count = v; }, '1')),
      ui.field(T.cooldown, num(draft.cooldownDays, (v) => { draft.cooldownDays = v; }, '0.05')),
    );

    const itemsRow = ui.h('div', 'cf-row cf-items');
    itemsRow.append(ui.h('span', 'cf-note', T.consumeItems));
    const selected = new Set(draft.items);
    for (const it of snap.items) {
      const cb = ui.checkbox(it.name, {
        checked: selected.has(it.id),
        onChange: (v) => {
          if (v) selected.add(it.id); else selected.delete(it.id);
          draft.items = [...selected];
        },
      });
      itemsRow.append(cb.el);
    }
    if (!snap.items.length) itemsRow.append(ui.h('span', 'cf-note', T.needFood));

    const autoRow = ui.h('div', 'cf-row');
    const auto = ui.checkbox(T.auto, { checked: Boolean(draft.auto), onChange: (v) => { draft.auto = v; } });
    autoRow.append(auto.el);

    const actions = ui.actions();
    actions.append(
      ui.button(T.saveConsume, {
        variant: 'primary',
        onClick: () => void (async () => {
          if (!draft.items.length) { ui.toast(T.needItems, 'bad'); return; }
          await call('saveConsume', [draft], T.saved);
        })(),
      }),
      ui.button(T.del, {
        size: 'sm',
        variant: 'danger',
        onClick: () => void (async () => {
          if (!(await ui.confirm({ title: T.confirmDel(c.triggerName + ' → ' + itemNames), body: '', danger: true }))) return;
          await call('removeConsume', [c.id], T.deleted);
        })(),
      }),
    );

    body.append(row, itemsRow, autoRow, actions);
    details.append(head, body);
    return details;
  }

  function render() {
    if (!snap) return;
    const scroll = root.scrollTop;
    root.replaceChildren();

    const statesSheet = ui.sheet({ title: T.states, desc: T.statesDesc });
    const list = ui.h('div', 'cf-list');
    if (!snap.states.length) list.append(ui.placeholder(T.noStates));
    for (const d of snap.states) list.append(stateCard(d));
    const stateBar = ui.rowbar();
    stateBar.append(
      ui.button(T.addNumber, {
        size: 'sm', variant: 'primary',
        onClick: () => void call('saveState', [{ kind: 'number', name: '新数值', min: 0, max: 100, initial: 100, driftPerDay: 0, unit: '' }], T.saved),
      }),
      ui.button(T.addFlag, {
        size: 'sm',
        onClick: () => void call('saveState', [{ kind: 'flag', name: '新开关', initialActive: false }], T.saved),
      }),
    );
    if (!snap.exampleExists) {
      stateBar.append(ui.button(T.addExample, {
        size: 'sm',
        onClick: () => void call('addExample', [], T.exampleDone),
      }));
    }
    statesSheet.body.append(list, stateBar);

    const rulesSheet = ui.sheet({ title: T.rules, desc: T.rulesDesc });
    const rulesList = ui.h('div', 'cf-list');
    if (!snap.rules.length) rulesList.append(ui.placeholder(T.noRules));
    for (const r of snap.rules) rulesList.append(ruleCard(r));
    const ruleBar = ui.rowbar();
    const numeric = snap.states.filter((s) => s.kind === 'number');
    const flags = snap.states.filter((s) => s.kind === 'flag');
    ruleBar.append(ui.button(T.addRule, {
      size: 'sm', variant: 'primary',
      onClick: () => {
        if (!numeric.length) { ui.toast(T.needNumber, 'bad'); return; }
        if (!flags.length) { ui.toast(T.needFlag, 'bad'); return; }
        void call('saveRule', [{ source: numeric[0].id, op: '<', value: 30, target: flags[0].id }], T.saved);
      },
    }));
    if (!flags.length) ruleBar.append(ui.h('span', 'cf-note', T.needFlag));
    rulesSheet.body.append(rulesList, ruleBar);

    const consumeSheet = ui.sheet({ title: T.consumeTitle, desc: T.consumeDesc });
    const consumeList = ui.h('div', 'cf-list');
    if (!snap.consume.length) consumeList.append(ui.placeholder(T.noConsume));
    for (const c of snap.consume) consumeList.append(consumeCard(c));
    const consumeBar = ui.rowbar();
    consumeBar.append(ui.button(T.addConsume, {
      size: 'sm',
      variant: 'primary',
      onClick: () => {
        if (!snap.states.length) { ui.toast(T.needStates, 'bad'); return; }
        if (!snap.items.length) { ui.toast(T.needFood, 'bad'); return; }
        const trigger = snap.states.find((s) => s.kind === 'flag') ?? snap.states[0];
        const effect = snap.states.find((s) => s.kind === 'number');
        void call('saveConsume', [{
          trigger: trigger.id,
          items: [snap.items[0].id],
          count: 1,
          effectState: effect ? effect.id : null,
          effectDelta: effect ? 5 : 0,
          cooldownDays: 0.5,
          auto: true,
        }], T.saved);
      },
    }));
    consumeSheet.body.append(consumeList, consumeBar);

    root.append(statesSheet.el, ui.h('hr', 'cf-hr'), rulesSheet.el, ui.h('hr', 'cf-hr'), consumeSheet.el);
    root.scrollTop = scroll;
  }

  (async () => {
    try {
      snap = await ctx.invoke('state');
      render();
    } catch (err) {
      ui.toast((err && err.message) || String(err), 'bad');
    }
  })();
}

// ============================================================================
// 「道具自定义」「道具合成表」
// ============================================================================
const IT = {
  zh: {
    seeds: '种子道具',
    seedsDesc: '自动跟「农场自定义」里的种子同步，这里只设买价/卖价。买价 0 = 商店不卖；卖价 0 = 不能卖。',
    crops: '农作物道具',
    cropsDesc: '自动跟「农场自定义」里的收获物同步。卖出价改到这里；可以设置能不能被吃，以及吃掉后改哪个状态。',
    consumables: '消耗品道具',
    consumablesDesc: '自己加的道具：买价/卖价、缩略图，以及吃掉后的状态效果。',
    decorations: '装饰道具',
    decorationsDesc: '可买/可合成；设置缩略图、摆放贴图和图层（上/下）后，去「背包」页点放置。上层和杂草同层、会清掉落点杂草；下层在农作物后方、不清草。',
    addConsumable: '添加消耗品',
    addDecor: '添加装饰',
    buy: '买价（0=不卖）',
    sell: '卖价（0=不能卖）',
    name: '名字',
    icon: '缩略图',
    sprite: '摆放贴图',
    upload: '上传 PNG',
    autoSeed: '种子随作物自动生成',
    autoCrop: '收获物随作物自动生成',
    layer: '图层',
    layerTop: '上（和杂草同层，盖住作物/桌宠）',
    layerBottom: '下（在农作物后方）',
    decorScale: '贴图大小（倍率）',
    decorScaleHint: '只影响这个装饰；1 = 原大，0.3~3。',
    edible: '可以被消耗（吃）',
    effects: '吃掉后改变',
    effectState: '状态',
    addEffect: '加一条效果',
    noEffects: '没有状态效果（吃了不改变状态）',
    delta: '变化量',
    place: '放到桌宠位置',
    save: '保存',
    del: '删除',
    confirmDel: (n) => '删除「' + n + '」？合成表里引用它的材料/产物也会一起删掉。',
    noItems: '还没有道具。',
    saved: '已保存',
    deleted: '已删除',
    none: '未设置',
    onlyPng: '只支持 PNG。',
    pickTitle: '选一张 PNG 贴图',
    placed: '已放置',
    needSprite: '先上传摆放贴图再放。',
    noStates: '还没有数值状态；去「状态自定义」加一个再配效果。',
  },
  en: {
    seeds: 'Seeds',
    seedsDesc: 'Synced from the Farm page. Set buy/sell here. Buy 0 = not in shop; sell 0 = cannot sell.',
    crops: 'Crops',
    cropsDesc: 'Synced from the Farm page. Sell price lives here; set whether it is edible and which state eating changes.',
    consumables: 'Consumables',
    consumablesDesc: 'Custom items: buy/sell price, icon and the state effects when eaten.',
    decorations: 'Decorations',
    decorationsDesc: 'Buy or craft; set icon, placement sprite and layer (top/bottom), then place from the Bag page. Top shares the weed layer and clears weeds at the spot; bottom sits behind crops and leaves weeds alone.',
    addConsumable: 'Add consumable',
    addDecor: 'Add decoration',
    buy: 'Buy (0 = not sold)',
    sell: 'Sell (0 = cannot sell)',
    name: 'Name',
    icon: 'Icon',
    sprite: 'Placement sprite',
    upload: 'Upload PNG',
    autoSeed: 'auto from crop',
    autoCrop: 'auto from crop',
    layer: 'Layer',
    layerTop: 'Top (same layer as weeds; covers crops/pet)',
    layerBottom: 'Bottom (behind crops)',
    decorScale: 'Sprite size (scale)',
    decorScaleHint: 'Only this decoration; 1 = original, 0.3–3.',
    edible: 'Edible (can be consumed)',
    effects: 'Changes when eaten',
    effectState: 'State',
    addEffect: 'Add effect',
    noEffects: 'No state effects',
    delta: 'Delta',
    place: 'Place at pet',
    save: 'Save',
    del: 'Delete',
    confirmDel: (n) => 'Delete "' + n + '"? Recipes using it are removed too.',
    noItems: 'No items yet.',
    saved: 'Saved',
    deleted: 'Deleted',
    none: 'not set',
    onlyPng: 'PNG only.',
    pickTitle: 'Pick a PNG sprite',
    placed: 'Placed',
    needSprite: 'Upload a placement sprite first.',
    noStates: 'No number states yet; add one on the Status page.',
  },
};
const RT = {
  zh: {
    title: '道具合成表',
    desc: '每张表用 1~4 个道具（材料）合成新道具。材料从背包扣，产物进背包；桌宠可以用 farm_craft 合成。',
    add: '添加合成表',
    inputs: '材料',
    output: '产物',
    count: '数量',
    addInput: '加材料',
    save: '保存合成表',
    del: '删除',
    none: '还没有合成表。',
    noItems: '还没有道具；先去「道具自定义」加道具。',
    needInput: '至少一个材料。',
    needOutput: '要选产物。',
    saved: '已保存',
    deleted: '已删除',
    savedMsg: '合成表已保存',
    confirmDel: (n) => '删除合成表「' + n + '」？',
  },
  en: {
    title: 'Crafting recipes',
    desc: 'Each recipe turns 1–4 items into a new one. Materials are taken from the bag, the output goes in; the pet can craft with farm_craft.',
    add: 'Add recipe',
    inputs: 'Materials',
    output: 'Output',
    count: 'Count',
    addInput: 'Add material',
    save: 'Save recipe',
    del: 'Delete',
    none: 'No recipes yet.',
    noItems: 'No items yet; add some on the Items page.',
    needInput: 'At least one material.',
    needOutput: 'Pick an output.',
    saved: 'Saved',
    deleted: 'Deleted',
    savedMsg: 'Recipe saved',
    confirmDel: (n) => 'Delete recipe "' + n + '"?',
  },
};

function spriteKit(ctx, ui, T) {
  const urls = new Map();
  function url(name) {
    if (!name) return Promise.resolve(null);
    if (!urls.has(name)) {
      urls.set(name, ctx.invokeBinary('sprite', [name]).then((blob) => URL.createObjectURL(blob)).catch(() => null));
    }
    return urls.get(name);
  }
  function thumb(name, size = 40) {
    const box = ui.h('div', 'cf-thumb');
    box.style.width = size + 'px';
    box.style.height = size + 'px';
    if (!name) { box.classList.add('cf-missing'); box.textContent = '?'; return box; }
    const img = ui.h('img');
    img.alt = '';
    img.draggable = false;
    void url(name).then((u) => { if (u) img.src = u; else { box.classList.add('cf-missing'); box.textContent = '?'; } });
    box.appendChild(img);
    return box;
  }
  function pickPng() {
    if (typeof ctx.pickPath !== 'function') return Promise.resolve(null);
    return ctx.pickPath({ kind: 'file', title: T.pickTitle, extensions: ['.png'] }).catch(() => null);
  }
  return { thumb, pickPng };
}

const BAG = {
  zh: {
    title: '背包',
    desc: '身上的道具；装饰可以在这里点「放置」放到农场地面上。上层和杂草同层、清掉落点杂草；下层在农作物后方、不清草。',
    shopTitle: '商店',
    shopDesc: '只列「道具自定义」里买价 > 0 的道具；点「买 1」放进背包。',
    craftTitle: '手动合成',
    craftDesc: '选配方和数量，消耗背包里的材料合成；材料不够会提示。配方在「道具合成表」页维护。',
    craftRecipe: '配方',
    craftQty: '数量',
    craftNow: '合成',
    craftHave: '拥有',
    craftNeed: '需要',
    craftMax: (n) => '按当前材料最多合成 ' + n + ' 次',
    noRecipes: '还没有合成表；去「道具合成表」页加一张。',
    previewTitle: '农场预览',
    previewDesc: '当前田里的作物和装饰；点下面道具的图标，预览会高亮它的位置。',
    placedTitle: '农场里的道具',
    placedDesc: '每一株作物、每一个装饰单独显示；卡片上的百分比是它的位置。农作物可以铲除，装饰可以回收进背包。',
    emptyPlaced: '田里还没有作物或装饰。',
    cropKind: '农作物',
    decorKind: '装饰',
    removeCrop: '铲除',
    recycle: '回收',
    highlightHint: '点击图标高亮位置',
    placeTitle: (name) => '放置 ' + name,
    placeCoord: '落点（0~100%）',
    placeConfirm: '确定放置',
    placeCancel: '取消',
    placeHint: '填 0~100 的横坐标；预览里的虚线和半透明贴图就是落点。',
    coins: '金币',
    bagCount: '背包件数',
    emptyBag: '背包是空的。',
    emptyShop: '商店没有货（去「道具自定义」设买价）。',
    sell1: '卖 1',
    sellAll: '全卖',
    buy1: '买 1',
    place: '放置',
    notSellable: '没有出售价',
    price: '卖价',
    shopPrice: '买价',
    sold: '已卖出',
    bought: '已买入',
    placed: '已放置',
    pickTitle: '选一张 PNG 贴图',
  },
  en: {
    title: 'Bag',
    desc: 'Everything you carry; place decorations from here. Top shares the weed layer and clears weeds at the spot; bottom sits behind crops and leaves weeds alone.',
    shopTitle: 'Shop',
    shopDesc: 'Only items with buy > 0 on the Items page. "Buy 1" puts one in the bag.',
    craftTitle: 'Manual crafting',
    craftDesc: 'Pick a recipe and amount to consume materials from the bag. Recipes live on the Crafting page.',
    craftRecipe: 'Recipe',
    craftQty: 'Amount',
    craftNow: 'Craft',
    craftHave: 'have',
    craftNeed: 'need',
    craftMax: (n) => 'Materials allow up to ' + n + ' craft(s)',
    noRecipes: 'No recipes yet; add one on the Crafting page.',
    previewTitle: 'Farm preview',
    previewDesc: 'Current crops and decorations; click an icon below to highlight its position.',
    placedTitle: 'Placed on the farm',
    placedDesc: 'Each crop and decoration has its own card; the percentage is its position. Remove crops or recycle decorations back to the bag.',
    emptyPlaced: 'No crops or decorations placed yet.',
    cropKind: 'Crop',
    decorKind: 'Decor',
    removeCrop: 'Remove',
    recycle: 'Recycle',
    highlightHint: 'Click icon to highlight',
    placeTitle: (name) => 'Place ' + name,
    placeCoord: 'Position (0–100%)',
    placeConfirm: 'Place here',
    placeCancel: 'Cancel',
    placeHint: 'Enter an x position 0–100; the dashed line and ghost sprite show the spot.',
    coins: 'Coins',
    bagCount: 'Items',
    emptyBag: 'The bag is empty.',
    emptyShop: 'Nothing in the shop (set a buy price on the Items page).',
    sell1: 'Sell 1',
    sellAll: 'Sell all',
    buy1: 'Buy 1',
    place: 'Place',
    notSellable: 'no sell price',
    price: 'Sell',
    shopPrice: 'Buy',
    sold: 'Sold',
    bought: 'Bought',
    placed: 'Placed',
    pickTitle: 'Pick a PNG sprite',
  },
};

function bagPanel(ctx) {
  const { ui } = ctx;
  const T = isZh(ctx.language) ? BAG.zh : BAG.en;
  const { thumb } = spriteKit(ctx, ui, T);
  const root = ui.h('div', 'cf-root');
  ctx.root.appendChild(root);
  let snap = null;
  let selectedKey = null;
  let placing = null;
  let pickedRecipe = null;
  let craftQty = 1;
  let paintPreview = () => {};

  async function call(method, args = []) {
    try {
      const data = await ctx.invoke(method, args);
      snap = data;
      if (selectedKey && !(snap.preview?.items ?? []).some((it) => it.key === selectedKey)) selectedKey = null;
      render();
      if (data && data.text) ui.toast(data.text);
      return data;
    } catch (err) {
      ui.toast((err && err.message) || String(err), 'bad');
      return null;
    }
  }

  function bagCard(item) {
    const box = ui.h('div', 'bg-card');
    box.append(
      thumb(item.icon, 56),
      ui.h('strong', 'bg-name', item.name),
      ui.h('span', 'bg-count', '×' + item.count),
      ui.h('span', 'bg-meta', item.sell > 0 ? T.price + ' ￥' + item.sell : T.notSellable),
    );
    const acts = ui.h('div', 'bg-actions');
    if (item.sell > 0) {
      acts.append(
        ui.button(T.sell1, { size: 'sm', onClick: () => void call('sell', [item.id, 1]) }),
        ui.button(T.sellAll, { size: 'sm', onClick: () => void call('sell', [item.id, 0]) }),
      );
    }
    if (item.placeable) {
      acts.append(ui.button(T.place, {
        size: 'sm',
        variant: 'primary',
        onClick: () => {
          placing = {
            id: item.id,
            name: item.name,
            icon: item.icon,
            sprite: item.sprite || item.icon,
            x: 0.5,
          };
          render();
        },
      }));
    }
    if (acts.children.length) box.append(acts);
    return box;
  }

  function craftSection() {
    const sheet = ui.sheet({ title: T.craftTitle, desc: T.craftDesc });
    const recipes = snap.recipes ?? [];
    if (!recipes.length) {
      sheet.body.append(ui.placeholder(T.noRecipes));
      return sheet.el;
    }
    if (!pickedRecipe || !recipes.some((r) => r.id === pickedRecipe)) pickedRecipe = recipes[0].id;
    const rec = recipes.find((r) => r.id === pickedRecipe) ?? recipes[0];
    pickedRecipe = rec.id;

    const bar = ui.rowbar();
    const sel = ui.select({
      value: rec.id,
      options: recipes.map((r) => ({
        value: r.id,
        label: r.output.name + ' ← ' + r.inputs.map((i) => i.name + '×' + i.count).join(' + '),
      })),
    });
    sel.addEventListener('change', () => {
      pickedRecipe = sel.value;
      craftQty = 1;
      render();
    }, { signal: ctx.signal });
    const qty = ui.input({ type: 'number', value: String(craftQty) });
    qty.min = '1';
    qty.max = '99';
    qty.addEventListener('input', () => {
      const n = Math.floor(Number(qty.value));
      if (Number.isFinite(n) && n >= 1) { craftQty = n; paint(); }
    }, { signal: ctx.signal });
    bar.append(ui.field(T.craftRecipe, sel), ui.field(T.craftQty, qty));

    const details = ui.h('div', 'bg-craft');
    function paint() {
      details.replaceChildren();
      for (const input of rec.inputs) {
        const need = input.count * craftQty;
        const line = ui.h('div', 'bg-craftrow' + (input.have < need ? ' bad' : ''));
        line.append(
          thumb(input.icon, 28),
          ui.h('span', 'bg-craftname', input.name),
          ui.h('span', 'bg-craftnum', input.have + ' / ' + need),
        );
        details.append(line);
      }
      const need = rec.output.count * craftQty;
      const out = ui.h('div', 'bg-craftrow out');
      out.append(
        thumb(rec.output.icon, 28),
        ui.h('span', 'bg-craftname', rec.output.name),
        ui.h('span', 'bg-craftnum', '×' + need + '（' + T.craftHave + ' ' + rec.output.have + '）'),
      );
      details.append(out);
    }
    paint();

    const actions = ui.rowbar();
    actions.append(
      ui.h('span', 'cf-note', T.craftMax(rec.max)),
      ui.button(T.craftNow, {
        variant: 'primary',
        onClick: () => void call('craft', [rec.id, craftQty]),
      }),
    );
    sheet.body.append(bar, details, actions);
    return sheet.el;
  }

  function previewSection() {
    const sheet = ui.sheet({ title: T.previewTitle, desc: T.previewDesc });
    const stage = ui.h('div', 'bp-preview');
    stage.append(ui.h('div', 'bp-ground'));
    const draw = () => {
      for (const old of [...stage.querySelectorAll('.bp-item, .bp-marker, .bp-empty')]) old.remove();
      const items = snap.preview?.items ?? [];
      if (!items.length && !placing) {
        stage.append(ui.h('div', 'bp-empty', T.emptyPlaced));
      }
      for (const group of items) {
        for (const pos of group.positions) {
          const node = ui.h('div', 'bp-item ' + (group.kind === 'decor' ? group.layer : 'crop') +
            (selectedKey === group.key ? ' sel' : ''));
          node.style.left = (Number(pos.x) * 100) + '%';
          node.title = group.name + ' · ' + Math.round(Number(pos.x) * 100) + '%';
          node.append(thumb(pos.sprite || group.icon, 64));
          stage.append(node);
        }
      }
      if (placing) {
        const marker = ui.h('div', 'bp-marker');
        marker.style.left = (placing.x * 100) + '%';
        marker.append(ui.h('span', 'bp-marker-tag', Math.round(placing.x * 100) + '%'));
        const ghost = ui.h('div', 'bp-ghost');
        ghost.append(thumb(placing.sprite || placing.icon, 64));
        marker.append(ghost);
        stage.append(marker);
      }
    };
    paintPreview = draw;
    draw();
    sheet.body.append(stage);
    return sheet.el;
  }

  function placingSection() {
    if (!placing) return null;
    const sheet = ui.sheet({ title: T.placeTitle(placing.name), desc: T.placeHint });
    const row = ui.rowbar();
    const pos = ui.input({ type: 'number', value: String(Math.round(placing.x * 100)) });
    pos.min = '0';
    pos.max = '100';
    pos.addEventListener('input', () => {
      const n = Number(pos.value);
      if (Number.isFinite(n)) {
        placing.x = Math.min(1, Math.max(0, n / 100));
        paintPreview();
      }
    }, { signal: ctx.signal });
    row.append(
      ui.field(T.placeCoord, pos),
      ui.button(T.placeConfirm, {
        variant: 'primary',
        onClick: () => {
          const p = placing;
          placing = null;
          selectedKey = null;
          void call('placeItem', [p.id, p.x]);
        },
      }),
      ui.button(T.placeCancel, {
        onClick: () => {
          placing = null;
          render();
        },
      }),
    );
    sheet.body.append(row);
    return sheet.el;
  }

  function placedSection() {
    const sheet = ui.sheet({ title: T.placedTitle, desc: T.placedDesc });
    const grid = ui.h('div', 'bg-grid');
    const items = snap.preview?.items ?? [];
    if (!items.length) grid.append(ui.placeholder(T.emptyPlaced));
    for (const group of items) {
      const box = ui.h('div', 'bg-card bp-card' + (selectedKey === group.key ? ' sel' : ''));
      const pick = ui.h('button', 'bp-pick');
      pick.type = 'button';
      pick.title = T.highlightHint;
      pick.append(thumb(group.icon, 56));
      pick.addEventListener('click', () => {
        selectedKey = selectedKey === group.key ? null : group.key;
        render();
      }, { signal: ctx.signal });
      box.append(
        pick,
        ui.h('strong', 'bg-name', group.name),
        ui.h('span', 'bg-count', '×' + group.count),
        ui.h('span', 'bg-meta', (group.kind === 'crop' ? T.cropKind : T.decorKind) +
          ' · ' + Math.round(Number(group.positions[0]?.x ?? 0) * 100) + '%'),
      );
      const acts = ui.h('div', 'bg-actions');
      acts.append(ui.button(group.kind === 'crop' ? T.removeCrop : T.recycle, {
        size: 'sm',
        variant: 'primary',
        onClick: () => void call(group.kind === 'crop' ? 'removeCrop' : 'recycleDecor',
          [group.kind === 'crop' ? group.plotId : group.uid]),
      }));
      box.append(acts);
      grid.append(box);
    }
    sheet.body.append(grid);
    return sheet.el;
  }

  function render() {
    if (!snap) return;
    const scroll = root.scrollTop;
    root.replaceChildren();
    const top = ui.rowbar();
    top.append(
      ui.pill(T.coins + ' ' + snap.coins, 'plain'),
      ui.pill(T.bagCount + ' ' + snap.bagTotal, 'plain'),
    );
    root.append(top);

    const bagSheet = ui.sheet({ title: T.title, desc: T.desc });
    const bagGrid = ui.h('div', 'bg-grid');
    if (!snap.items.length) bagGrid.append(ui.placeholder(T.emptyBag));
    for (const item of snap.items) bagGrid.append(bagCard(item));
    bagSheet.body.append(bagGrid);

    const placingEl = placingSection();
    const previewEl = previewSection();
    const placedEl = placedSection();
    let craftEl;
    try {
      craftEl = craftSection();
    } catch (err) {
      console.error('bag craft section failed', err);
      craftEl = ui.h('pre', 'cf-note', String((err && err.stack) || err));
    }
    const parts = [bagSheet.el];
    if (placingEl) parts.push(ui.h('hr', 'cf-hr'), placingEl);
    parts.push(
      ui.h('hr', 'cf-hr'),
      previewEl,
      ui.h('hr', 'cf-hr'),
      placedEl,
      ui.h('hr', 'cf-hr'),
      craftEl,
    );
    root.append(...parts);
    root.scrollTop = scroll;
  }

  (async () => {
    try {
      snap = await ctx.invoke('state');
      render();
    } catch (err) {
      ui.toast((err && err.message) || String(err), 'bad');
    }
  })();
}

function shopPanel(ctx) {
  const { ui } = ctx;
  const T = isZh(ctx.language) ? BAG.zh : BAG.en;
  const { thumb } = spriteKit(ctx, ui, T);
  const root = ui.h('div', 'cf-root');
  ctx.root.appendChild(root);
  let snap = null;

  async function call(method, args = []) {
    try {
      const data = await ctx.invoke(method, args);
      snap = data;
      render();
      if (data && data.text) ui.toast(data.text);
      return data;
    } catch (err) {
      ui.toast((err && err.message) || String(err), 'bad');
      return null;
    }
  }

  function shopCard(item) {
    const box = ui.h('div', 'bg-card');
    box.append(
      thumb(item.icon, 56),
      ui.h('strong', 'bg-name', item.name),
      ui.h('span', 'bg-count', '￥' + item.buy),
    );
    if (item.sell > 0) box.append(ui.h('span', 'bg-meta', T.price + ' ￥' + item.sell));
    const acts = ui.h('div', 'bg-actions');
    acts.append(ui.button(T.buy1, {
      size: 'sm',
      variant: 'primary',
      onClick: () => void call('buy', [item.id, 1]),
    }));
    box.append(acts);
    return box;
  }

  function render() {
    if (!snap) return;
    const scroll = root.scrollTop;
    root.replaceChildren();
    const top = ui.rowbar();
    top.append(
      ui.pill(T.coins + ' ' + snap.coins, 'plain'),
      ui.pill(T.shopTitle + ' ' + snap.shop.length, 'plain'),
    );
    root.append(top);
    const sheet = ui.sheet({ title: T.shopTitle, desc: T.shopDesc });
    const grid = ui.h('div', 'bg-grid');
    if (!snap.shop.length) grid.append(ui.placeholder(T.emptyShop));
    for (const item of snap.shop) grid.append(shopCard(item));
    sheet.body.append(grid);
    root.append(sheet.el);
    root.scrollTop = scroll;
  }

  (async () => {
    try {
      snap = await ctx.invoke('state');
      render();
    } catch (err) {
      ui.toast((err && err.message) || String(err), 'bad');
    }
  })();
}

function itemsPanel(ctx) {
  const { ui } = ctx;
  const T = isZh(ctx.language) ? IT.zh : IT.en;
  const { thumb, pickPng } = spriteKit(ctx, ui, T);
  const root = ui.h('div', 'cf-root');
  ctx.root.appendChild(root);
  let snap = null;

  async function call(method, args = [], toast) {
    try {
      const data = await ctx.invoke(method, args);
      snap = data;
      render();
      if (toast) ui.toast(toast);
      return data;
    } catch (err) {
      ui.toast((err && err.message) || String(err), 'bad');
      return null;
    }
  }

  function num(value, onChange, step = '1') {
    const input = ui.input({ type: 'number', value: value === null || value === undefined ? '' : String(value) });
    input.step = step;
    input.addEventListener('input', () => { const n = Number(input.value); if (Number.isFinite(n)) onChange(n); }, { signal: ctx.signal });
    return input;
  }

  function text(value, onChange) {
    const input = ui.input({ value: value ?? '' });
    input.maxLength = 24;
    input.addEventListener('input', () => onChange(input.value), { signal: ctx.signal });
    return input;
  }

  function iconRow(draft, repaint) {
    const row = ui.h('div', 'cf-row');
    const preview = thumb(draft.icon, 48);
    const btn = ui.button(T.upload, {
      size: 'sm',
      onClick: () => void (async () => {
        const path = await pickPng();
        if (!path) return;
        try {
          const data = await ctx.invoke('importSprite', [draft.id, 'icon', path]);
          draft.icon = data.sprite;
          repaint();
          ui.toast(T.saved);
        } catch (err) { ui.toast(err.message || String(err), 'bad'); }
      })(),
    });
    row.append(ui.h('span', 'cf-note', T.icon), preview, btn);
    return row;
  }

  function spriteRow(draft, repaint) {
    const row = ui.h('div', 'cf-row');
    const preview = thumb(draft.sprite, 64);
    const btn = ui.button(T.upload, {
      size: 'sm',
      onClick: () => void (async () => {
        const path = await pickPng();
        if (!path) return;
        try {
          const data = await ctx.invoke('importSprite', [draft.id, 'sprite', path]);
          draft.sprite = data.sprite;
          repaint();
          ui.toast(T.saved);
        } catch (err) { ui.toast(err.message || String(err), 'bad'); }
      })(),
    });
    row.append(ui.h('span', 'cf-note', T.sprite), preview, btn);
    return row;
  }

  function effectsEditor(draft) {
    const box = ui.h('div', 'cf-row');
    const paint = () => {
      box.replaceChildren();
      box.append(ui.h('span', 'cf-note', draft.effects.length ? T.effects : T.noEffects));
      draft.effects.forEach((eff, idx) => {
        const row = ui.h('div', 'cf-row');
        const sel = ui.select({
          value: eff.state,
          options: snap.states.map((s) => ({ value: s.id, label: s.name })),
        });
        sel.addEventListener('change', () => { eff.state = sel.value; }, { signal: ctx.signal });
        row.append(
          ui.field(T.effectState, sel),
          ui.field(T.delta, num(eff.delta, (v) => { eff.delta = v; }, '0.1')),
          ui.button('✕', { size: 'sm', onClick: () => { draft.effects.splice(idx, 1); paint(); } }),
        );
        box.append(row);
      });
      if (draft.effects.length < 4 && snap.states.length) {
        box.append(ui.button(T.addEffect, {
          size: 'sm',
          onClick: () => { draft.effects.push({ state: snap.states[0].id, delta: 5 }); paint(); },
        }));
      }
      if (!snap.states.length) box.append(ui.h('span', 'cf-note', T.noStates));
    };
    paint();
    return box;
  }

  function itemCard(item, kind) {
    const draft = {
      id: item.id,
      kind: item.kind,
      name: item.name,
      buy: item.buy,
      sell: item.sell,
      consumable: item.consumable,
      effects: item.effects.map((e) => ({ state: e.state, delta: e.delta })),
      icon: item.icon,
      sprite: item.sprite,
      layer: item.layer ?? 'bottom',
      scale: Number(item.scale ?? 1),
    };
    const details = ui.h('details', 'cf-card');
    const head = ui.h('summary', 'cf-head');
    const title = ui.h('strong', 'cf-name', item.name);
    head.append(
      thumb(item.icon, 34),
      title,
      ui.pill(item.kind === 'seed' ? '种子' : item.kind === 'crop' ? '农作物' : item.kind === 'consumable' ? '消耗品' : '装饰', 'plain'),
      ...(item.kind === 'decor' ? [ui.pill(item.layer === 'top' ? T.layerTop : T.layerBottom, item.layer === 'top' ? 'on' : 'plain')] : []),
      ui.chip('￥' + item.buy + ' / ' + item.sell, 'plain'),
    );
    const body = ui.h('div', 'cf-body');
    const nameRepaint = () => { title.textContent = draft.name || item.id; };
    const row = ui.h('div', 'cf-row');
    if (kind === 'seed' || kind === 'crop') {
      row.append(ui.h('span', 'cf-note', item.name + (kind === 'seed' ? '（' + T.autoSeed + '）' : '（' + T.autoCrop + '）')));
    } else {
      row.append(ui.field(T.name, text(draft.name, (v) => { draft.name = v; nameRepaint(); })));
    }
    row.append(
      ui.field(T.buy, num(draft.buy, (v) => { draft.buy = v; })),
      ui.field(T.sell, num(draft.sell, (v) => { draft.sell = v; })),
    );
    body.append(row);

    if (kind === 'crop') {
      const cb = ui.checkbox(T.edible, { checked: Boolean(draft.consumable), onChange: (v) => { draft.consumable = v; } });
      body.append(cb.el);
    }
    if (kind === 'crop' || kind === 'consumable') body.append(effectsEditor(draft));

    const actions = ui.actions();
    actions.append(ui.button(T.save, {
      variant: 'primary',
      onClick: () => void call('saveItem', [draft], T.saved),
    }));
    if (kind === 'consumable' || kind === 'decor') {
      actions.append(ui.button(T.del, {
        size: 'sm',
        variant: 'danger',
        onClick: () => void (async () => {
          if (!(await ui.confirm({ title: T.confirmDel(item.name), body: '', danger: true }))) return;
          await call('removeItem', [item.id], T.deleted);
        })(),
      }));
    }
    if (kind === 'consumable') body.append(iconRow(draft, nameRepaint));
    if (kind === 'decor') {
      const layerSel = ui.select({
        value: draft.layer,
        options: [
          { value: 'bottom', label: T.layerBottom },
          { value: 'top', label: T.layerTop },
        ],
      });
      layerSel.addEventListener('change', () => { draft.layer = layerSel.value; }, { signal: ctx.signal });
      body.append(
        ui.field(T.layer, layerSel),
        ui.field(T.decorScale, num(draft.scale, (v) => { draft.scale = v; }, '0.05')),
        ui.h('p', 'cf-note', T.decorScaleHint),
        iconRow(draft, nameRepaint),
        spriteRow(draft, nameRepaint),
      );
    }
    body.append(actions);
    details.append(head, body);
    return details;
  }

  function section(title, desc, items, empty, adder, extra) {
    const sheet = ui.sheet({ title, desc });
    if (extra) sheet.body.append(extra);
    const list = ui.h('div', 'cf-list');
    if (!items.length) list.append(ui.placeholder(empty));
    for (const it of items) list.append(itemCard(it, it.kind));
    sheet.body.append(list);
    if (adder) {
      const bar = ui.rowbar();
      bar.append(adder);
      sheet.body.append(bar);
    }
    return sheet;
  }


  function render() {
    if (!snap) return;
    const scroll = root.scrollTop;
    root.replaceChildren();
    const addConsumable = ui.button(T.addConsumable, {
      size: 'sm', variant: 'primary',
      onClick: () => void call('saveItem', [{ kind: 'consumable', name: '新消耗品', buy: 0, sell: 0, effects: [] }], T.saved),
    });
    const addDecor = ui.button(T.addDecor, {
      size: 'sm', variant: 'primary',
      onClick: () => void call('saveItem', [{ kind: 'decor', name: '新装饰', buy: 0, sell: 0 }], T.saved),
    });
    const sheets = [
      section(T.seeds, T.seedsDesc, snap.seeds, T.noItems, null),
      section(T.crops, T.cropsDesc, snap.crops, T.noItems, null),
      section(T.consumables, T.consumablesDesc, snap.consumables, T.noItems, addConsumable),
      section(T.decorations, T.decorationsDesc, snap.decorations, T.noItems, addDecor),
    ];
    sheets.forEach((sheet, i) => {
      if (i) root.append(ui.h('hr', 'cf-hr'));
      root.append(sheet.el);
    });
    root.scrollTop = scroll;
  }

  (async () => {
    try {
      snap = await ctx.invoke('state');
      render();
    } catch (err) {
      ui.toast((err && err.message) || String(err), 'bad');
    }
  })();

  // 合成表放在道具自定义下面，避免顶层页签过多。
  recipesPanel(ctx);
}

function recipesPanel(ctx) {
  const { ui } = ctx;
  const T = isZh(ctx.language) ? RT.zh : RT.en;
  const root = ui.h('div', 'cf-root');
  ctx.root.appendChild(root);
  let snap = null;

  async function call(method, args = [], toast) {
    try {
      const data = await ctx.invoke(method, args);
      snap = data;
      render();
      if (toast) ui.toast(toast);
      return data;
    } catch (err) {
      ui.toast((err && err.message) || String(err), 'bad');
      return null;
    }
  }

  function num(value, onChange) {
    const input = ui.input({ type: 'number', value: String(value ?? 1) });
    input.min = '1';
    input.max = '99';
    input.addEventListener('input', () => { const n = Number(input.value); if (Number.isFinite(n)) onChange(n); }, { signal: ctx.signal });
    return input;
  }

  function itemSelect(value, onChange) {
    const sel = ui.select({
      value,
      options: snap.items.map((it) => ({ value: it.id, label: it.name })),
    });
    sel.addEventListener('change', () => onChange(sel.value), { signal: ctx.signal });
    return sel;
  }

  function recipeCard(recipe) {
    const draft = {
      id: recipe.id,
      inputs: recipe.inputs.map((row) => ({ item: row.item, count: row.count })),
      output: { item: recipe.output.item, count: recipe.output.count },
    };
    const details = ui.h('details', 'cf-card');
    const head = ui.h('summary', 'cf-head');
    const label = (id) => snap.items.find((it) => it.id === id)?.name ?? id;
    head.append(
      ui.h('strong', 'cf-name', recipe.inputs.map((r) => label(r.item) + '×' + r.count).join(' + ') +
        ' → ' + label(recipe.output.item) + '×' + recipe.output.count),
    );
    const body = ui.h('div', 'cf-body');
    const inputsBox = ui.h('div', 'cf-row');
    const paintInputs = () => {
      inputsBox.replaceChildren();
      inputsBox.append(ui.h('span', 'cf-note', T.inputs));
      draft.inputs.forEach((row, idx) => {
        const line = ui.h('div', 'cf-row');
        line.append(
          ui.field(T.inputs, itemSelect(row.item, (v) => { row.item = v; })),
          ui.field(T.count, num(row.count, (v) => { row.count = v; })),
          ui.button('✕', {
            size: 'sm',
            onClick: () => { draft.inputs.splice(idx, 1); paintInputs(); },
          }),
        );
        inputsBox.append(line);
      });
      if (draft.inputs.length < 4) {
        inputsBox.append(ui.button(T.addInput, {
          size: 'sm',
          onClick: () => { draft.inputs.push({ item: snap.items[0].id, count: 1 }); paintInputs(); },
        }));
      }
    };
    paintInputs();
    const outputRow = ui.h('div', 'cf-row');
    outputRow.append(
      ui.field(T.output, itemSelect(draft.output.item, (v) => { draft.output.item = v; })),
      ui.field(T.count, num(draft.output.count, (v) => { draft.output.count = v; })),
    );
    const actions = ui.actions();
    actions.append(
      ui.button(T.save, { variant: 'primary', onClick: () => void call('saveRecipe', [draft], T.saved) }),
      ui.button(T.del, {
        size: 'sm',
        variant: 'danger',
        onClick: () => void (async () => {
          if (!(await ui.confirm({ title: T.confirmDel ? T.confirmDel(recipe.id) : recipe.id, body: '', danger: true }))) return;
          await call('removeRecipe', [recipe.id], T.deleted);
        })(),
      }),
    );
    body.append(inputsBox, outputRow, actions);
    details.append(head, body);
    return details;
  }

  function render() {
    if (!snap) return;
    const scroll = root.scrollTop;
    root.replaceChildren();
    const sheet = ui.sheet({ title: T.title, desc: T.desc });
    const list = ui.h('div', 'cf-list');
    if (!snap.recipes.length) list.append(ui.placeholder(T.none));
    for (const r of snap.recipes) list.append(recipeCard(r));
    const bar = ui.rowbar();
    bar.append(ui.button(T.add, {
      size: 'sm', variant: 'primary',
      onClick: () => {
        if (!snap.items.length) { ui.toast(T.noItems, 'bad'); return; }
        void call('saveRecipe', [{
          inputs: [{ item: snap.items[0].id, count: 1 }],
          output: { item: snap.items[0].id, count: 1 },
        }], T.saved);
      },
    }));
    if (!snap.items.length) bar.append(ui.h('span', 'cf-note', T.noItems));
    sheet.body.append(list, bar);
    root.append(sheet.el);
    root.scrollTop = scroll;
  }

  (async () => {
    try {
      snap = await ctx.invoke('state');
      render();
    } catch (err) {
      ui.toast((err && err.message) || String(err), 'bad');
    }
  })();
}

// ============================================================================
// 「生态自定义」面板：生长条件 + 天气
// ============================================================================
function ecologyPanel(ctx) {
  const { ui } = ctx;
  const zh = isZh(ctx.language);
  const root = ui.h('div', 'cf-root');
  ctx.root.appendChild(root);
  let snapshot = null;

  const DEFAULT_WEATHERS = [
    { id: 'calm', name: '无风', builtin: true, deletable: false, duration: 300, weight: 30, cropSway: 'both', cropAmp: 4, decorSway: 'none', decorAmp: 1, squash: 0, mood: 2, speed: 1 },
    { id: 'breeze', name: '微风', builtin: true, deletable: true, duration: 250, weight: 40, cropSway: 'left', cropAmp: 5, decorSway: 'none', decorAmp: 3, squash: 0, mood: 1, speed: 1.2 },
    { id: 'gale', name: '大风', builtin: true, deletable: true, duration: 100, weight: 20, cropSway: 'right', cropAmp: 13, decorSway: 'none', decorAmp: 9, squash: 0, mood: -6, speed: 2.4 },
    { id: 'egg', name: '彩蛋', builtin: true, deletable: true, duration: 300, weight: 10, cropSway: 'none', cropAmp: 0, decorSway: 'none', decorAmp: 0, squash: 0.45, mood: 4, speed: 3 },
  ];

  function normalizeWeathers(list) {
    const rows = Array.isArray(list) ? list : [];
    const out = rows.filter((w) => w && typeof w === 'object').map((w, i) => ({
      id: String(w.id || ('weather_' + i)).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32),
      name: String(w.name || '天气').slice(0, 12),
      builtin: Boolean(w.builtin),
      deletable: w.deletable !== false,
      duration: Math.max(1, Math.min(3600, Number(w.duration) || 20)),
      weight: Math.max(0, Math.min(100, Number(w.weight) || 0)),
      cropSway: ['both', 'left', 'right', 'none'].includes(w.cropSway ?? w.sway) ? (w.cropSway ?? w.sway) : 'both',
      cropAmp: Math.max(0, Math.min(40, Number(w.cropAmp ?? w.swayAmp) || 0)),
      decorSway: ['both', 'left', 'right', 'none'].includes(w.decorSway ?? w.sway) ? (w.decorSway ?? w.sway) : 'both',
      decorAmp: Math.max(0, Math.min(40, Number(w.decorAmp ?? w.swayAmp) || 0)),
      squash: Math.max(0, Math.min(0.6, Number(w.squash) || 0)),
      mood: Math.max(-100, Math.min(100, Number(w.mood) || 0)),
      speed: Math.max(0, Math.min(20, Number(w.speed) || 1)),
    }));
    if (!out.some((w) => w.id === 'calm')) out.unshift({ ...DEFAULT_WEATHERS[0] });
    if (!out.some((w) => w.id !== 'calm')) out.push(...DEFAULT_WEATHERS.slice(1).map((w) => ({ ...w })));
    for (const w of out) if (w.id === 'calm') { w.name = '无风'; w.deletable = false; }
    return out;
  }

  function cloneSettings(s) {
    const src = s ?? {};
    return {
      realMinutesPerDay: Number(src.realMinutesPerDay ?? 60),
      maxStepDays: Number(src.maxStepDays ?? 1),
      tickIntervalMs: Number(src.tickIntervalMs ?? 5000),
      dailyEvent: Boolean(src.dailyEvent),
      water: {
        dryPerDay: Number(src.water?.dryPerDay ?? 0.15),
        waterGain: Number(src.water?.waterGain ?? 1),
        wiltDays: Number(src.water?.wiltDays ?? 2.2),
      },
      weathers: normalizeWeathers(src.weathers),
    };
  }

  let draft = null;
  const getDraft = () => {
    if (!draft) draft = cloneSettings(snapshot?.settings);
    return draft;
  };
  const num = (value, onChange, step = '1', min = '0', max = '') => {
    const input = ui.input({ type: 'number', value: String(value ?? '') });
    input.step = step; input.min = min;
    if (max !== '') input.max = max;
    input.addEventListener('input', () => { const n = Number(input.value); if (Number.isFinite(n)) onChange(n); }, { signal: ctx.signal });
    return input;
  };
  const text = (value, onChange, placeholder = '') => {
    const input = ui.input({ value: value ?? '', placeholder });
    input.maxLength = 12;
    input.addEventListener('input', () => onChange(input.value), { signal: ctx.signal });
    return input;
  };
  const select = (options, value, onChange) => {
    const el = ui.select({ value: String(value), options });
    el.addEventListener('change', () => onChange(el.value), { signal: ctx.signal });
    return el;
  };

  async function save() {
    const d = getDraft();
    try {
      await ctx.invoke('saveSettings', [{
        realMinutesPerDay: d.realMinutesPerDay,
        maxStepDays: d.maxStepDays,
        tickIntervalMs: d.tickIntervalMs,
        dailyEvent: d.dailyEvent,
        water: { ...d.water },
        moodIntervalMin: d.moodIntervalMin,
        weathers: normalizeWeathers(d.weathers),
      }]);
      ui.toast(zh ? '已保存' : 'Saved');
      await reload();
    } catch (e) { ui.toast((e && e.message) || String(e), 'bad'); }
  }

  async function applyNow(id) {
    try {
      await ctx.invoke('applyWeatherNow', [id]);
      ui.toast(zh ? '天气已立即生效' : 'Weather applied');
    } catch (e) { ui.toast((e && e.message) || String(e), 'bad'); }
  }

  async function preview(id) {
    try {
      await ctx.invoke('previewWeather', [id]);
      ui.toast(zh ? '预览 5 秒' : 'Preview 5s');
    } catch (e) { ui.toast((e && e.message) || String(e), 'bad'); }
  }

  function weatherCard(w, index) {
    const box = ui.h('div', 'cf-card');
    const head = ui.h('div', 'cf-row');
    const name = ui.field(zh ? '名称' : 'Name', text(w.name, (v) => { w.name = v; }, '天气'));
    if (w.id === 'calm') name.querySelector('input').disabled = true;
    head.append(name);
    if (w.deletable !== false && w.id !== 'calm') {
      head.append(ui.button(zh ? '删除' : 'Delete', {
        size: 'sm', variant: 'danger',
        onClick: () => {
          draft.weathers = draft.weathers.filter((x) => x.id !== w.id);
          paint();
        },
      }));
    }
    head.append(ui.button(zh ? '立即生效' : 'Apply now', {
      size: 'sm',
      variant: 'primary',
      onClick: () => void applyNow(w.id),
    }));
    head.append(ui.button(zh ? '预览 5 秒' : 'Preview 5s', {
      size: 'sm',
      onClick: () => void preview(w.id),
    }));
    const row1 = ui.h('div', 'cf-row');
    row1.append(
      ui.field(zh ? '持续（秒）' : 'Duration (s)', num(w.duration, (v) => { w.duration = v; }, '1', '1')),
      ui.field(zh ? '触发概率（权重）' : 'Probability (weight)', num(w.weight, (v) => { w.weight = v; }, '1', '0')),
      ui.field(zh ? '速度（倍率）' : 'Speed (x)', num(w.speed, (v) => { w.speed = v; }, '0.1', '0', '20')),
      ui.field(zh ? '心情变化/结算' : 'Mood per settlement', num(w.mood, (v) => { w.mood = v; }, '1', '-100')),
    );
    const crop = ui.h('div', 'cf-row');
    crop.append(
      ui.field(zh ? '农作物方向' : 'Crop direction', select([
        { value: 'both', label: zh ? '左右' : 'Both' },
        { value: 'left', label: zh ? '左' : 'Left' },
        { value: 'right', label: zh ? '右' : 'Right' },
        { value: 'none', label: zh ? '不摆' : 'None' },
      ], w.cropSway, (v) => { w.cropSway = v; })),
      ui.field(zh ? '农作物幅度（°）' : 'Crop amplitude', num(w.cropAmp, (v) => { w.cropAmp = v; }, '0.5', '0')),
    );
    const decor = ui.h('div', 'cf-row');
    decor.append(
      ui.field(zh ? '装饰物方向' : 'Decor direction', select([
        { value: 'both', label: zh ? '左右' : 'Both' },
        { value: 'left', label: zh ? '左' : 'Left' },
        { value: 'right', label: zh ? '右' : 'Right' },
        { value: 'none', label: zh ? '不摆' : 'None' },
      ], w.decorSway, (v) => { w.decorSway = v; })),
      ui.field(zh ? '装饰物幅度（°）' : 'Decor amplitude', num(w.decorAmp, (v) => { w.decorAmp = v; }, '0.5', '0')),
    );
    const fx = ui.h('div', 'cf-row');
    const fxInput = ui.input({ value: zh ? '测试中，暂无素材' : 'Testing; no asset yet', disabled: true });
    fxInput.disabled = true;
    fx.append(ui.field(zh ? '特效贴图' : 'Effect sprite', fxInput));
    box.append(head, row1, crop, decor, fx);
    return box;
  }

  function paint() {
    const scroll = root.scrollTop;
    root.replaceChildren();
    const d = getDraft();
    const sheet = ui.sheet({
      title: zh ? '生态自定义' : 'Ecology',
      desc: zh
        ? '1 游戏日 = 现实分钟决定生长速度；离线最多补几天是防止关机回来一次跳太多天；刷新间隔只影响状态/事件更新，不影响生长速度。天气按持续时间切换，触发概率按权重计算。'
        : 'Real minutes per game day sets growth speed; max offline days caps how many game days a long shutdown can catch up; the refresh interval only affects state/event updates, not growth speed. Weather changes by duration and weighted probability.',
    });
    const time = ui.h('div', 'cf-row');
    time.append(
      ui.field(zh ? '1 游戏日 = 现实分钟' : 'Real minutes per game day', num(d.realMinutesPerDay, (v) => { d.realMinutesPerDay = v; }, '0.5', '0.5')),
      ui.field(zh ? '离线最多补几天（安全上限）' : 'Max offline days (safety cap)', num(d.maxStepDays, (v) => { d.maxStepDays = v; }, '0.1', '0.01')),
      ui.field(zh ? '刷新间隔（毫秒，不影响生长）' : 'Refresh interval (ms, does not affect growth)', num(d.tickIntervalMs, (v) => { d.tickIntervalMs = v; }, '100', '1000')),
    );
    const daily = ui.checkbox(zh ? '每天推送 farm.day' : 'Emit farm.day', {
      checked: d.dailyEvent,
      onChange: (v) => { d.dailyEvent = v; },
    }).el;
    const water = ui.h('div', 'cf-row');
    water.append(
      ui.field(zh ? '每游戏日蒸发' : 'Dry per day', num(d.water.dryPerDay, (v) => { d.water.dryPerDay = v; }, '0.01', '0')),
      ui.field(zh ? '一次浇水补水' : 'Water gain', num(d.water.waterGain, (v) => { d.water.waterGain = v; }, '0.05', '0')),
      ui.field(zh ? '干透后枯萎天数' : 'Wilt days', num(d.water.wiltDays, (v) => { d.water.wiltDays = v; }, '0.1', '0.01')),
    );
    const moodRow = ui.h('div', 'cf-row');
    moodRow.append(ui.field(zh ? '心情结算间隔（真实分钟）' : 'Mood interval (real min)', num(d.moodIntervalMin, (v) => { d.moodIntervalMin = v; }, '1', '1')));
    const weatherBox = ui.h('div', 'cf-list');
    d.weathers.forEach((w, i) => weatherBox.append(weatherCard(w, i)));
    const add = ui.button(zh ? '添加天气' : 'Add weather', {
      size: 'sm', variant: 'primary',
      onClick: () => {
        d.weathers.push({
          id: 'weather_' + Date.now().toString(36), name: zh ? '新天气' : 'New weather', builtin: false, deletable: true,
          duration: 20, weight: 10, sway: 'both', swayAmp: 4, squash: 0, mood: 0, speed: 1,
        });
        paint();
      },
    });
    const saveBar = ui.rowbar();
    saveBar.append(ui.button(zh ? '保存生态设置' : 'Save ecology', { variant: 'primary', onClick: () => void save() }));
    sheet.body.append(
      ui.h('strong', 'cf-note', zh ? '生长条件' : 'Growth conditions'),
      time, daily,
      ui.h('hr', 'cf-hr2'),
      ui.h('strong', 'cf-note', zh ? '浇水' : 'Water'),
      water,
      ui.h('hr', 'cf-hr2'),
      ui.h('strong', 'cf-note', zh ? '天气' : 'Weather'),
      moodRow,
      ui.h('p', 'cf-note', zh ? '无风固定存在，不可删除；默认包含无风、微风、大风、彩蛋。特效贴图暂不开放，测试中。' : 'Calm is built in and cannot be deleted. Defaults: calm, breeze, gale, egg. Effect sprites are disabled while testing.'),
      weatherBox,
      add,
      saveBar,
    );
    root.append(sheet.el);
    root.scrollTop = scroll;
  }

  async function reload() {
    try {
      const data = await ctx.invoke('state');
      snapshot = data && data.catalog ? data.catalog : data;
      draft = null;
      paint();
    } catch (e) { ui.toast((e && e.message) || String(e), 'bad'); }
  }

  reload();
}

function managePanel(ctx) {
  const { ui } = ctx;
  const root = ui.h('div', 'cf-root');
  ctx.root.appendChild(root);
  const sheet = ui.sheet({
    title: '存档与重置',
    desc: '备份会复制 state.json 和 custom.json 到 data/farm/backups；重置会先备份，再清空存档和全部自定义设置，World 随后重启。',
  });
  const bar = ui.rowbar();
  const status = ui.h('p', 'cf-note', '');
  const backup = ui.button('备份存档', {
    variant: 'primary',
    onClick: async () => {
      backup.disabled = true;
      status.textContent = '正在备份…';
      try {
        const r = await ctx.invoke('backup');
        status.textContent = r.text || '已备份';
      } catch (err) {
        status.textContent = '备份失败：' + ((err && err.message) || err);
      } finally { backup.disabled = false; }
    },
  });
  const reset = ui.button('重置一切', {
    onClick: async () => {
      if (!window.confirm('确定重置一切？会清空存档和全部自定义设置（会先自动备份）。')) return;
      reset.disabled = true;
      status.textContent = '正在重置…';
      try {
        const r = await ctx.invoke('reset');
        status.textContent = r.text || '已重置，World 正在重启…';
        setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 3000);
      } catch (err) {
        status.textContent = '重置失败：' + ((err && err.message) || err);
        reset.disabled = false;
      }
    },
  });
  bar.append(backup, reset);
  sheet.body.append(bar, status);
  root.appendChild(sheet.el);
}

export default {
  panels: {
    manage: { mount: managePanel },
    bag: { mount: bagPanel },
    shop: { mount: shopPanel },
    customize: { mount: panel },
    ecology: { mount: ecologyPanel },
    status: { mount: statusPanel },
    items: { mount: itemsPanel },
  },
};
