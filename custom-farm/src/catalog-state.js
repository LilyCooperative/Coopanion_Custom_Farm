/**
 * 运行期目录（catalog）：由 custom.json 编译出来的作物 / 杂草 / 地面。
 *
 * 单独放一个模块，避免 farm.js（纯逻辑）和 catalog.js（读写磁盘）互相 import：
 * farm.js 只读这里的 live 对象，catalog.js 负责把用户配置写进来。
 */
export const live = {
  /** 当前生效的杂草类型（按权重） */
  weedTypes: [],
  /** 地面：selected = sprite 名；custom = 用户上传的贴图 */
  ground: { selected: null, custom: [], builtin: [] },
  /** item id -> 图标 sprite 名（没有就用 icon_item_<id>） */
  itemIcons: {},
  /** item id -> 显示名 */
  names: {},
  /** 作物状态（浇水参数 / 浇水特效 / 枯萎贴图） */
  status: {
    water: { dryPerDay: 0.15, waterGain: 1, wiltDays: 2.2 },
    fx: { pour: [], burst: [], pourMs: 70, burstMs: 80 },
    wither: null,
  },
  /** 作物 key -> 作物定义（与 CROPS 里的对象是同一个） */
  crops: {},
  /** 杂草 key -> 类型定义 */
  weeds: {},
};
