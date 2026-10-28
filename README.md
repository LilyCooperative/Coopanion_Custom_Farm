# 自定义农场（Custom Farm）

Coopanion 桌宠的种田扩展：桌宠在**任务栏上沿**种地，桌面图层实时渲染，配置全部在 Coopanion WebUI 里完成。

**18 种作物只是起点。** 农作物、杂草、装饰物、天气、状态、道具、合成表和贴图都能增删、改数值、换图；想种什么、长什么样、吃什么补什么，全由你决定。

> 独立 WPF 背包已移除；背包、商店、农场预览、摆放和手动合成都在 WebUI。

## 玩法

- **种**：桌宠走到田里，消耗 1 包种子种下一棵；不同作物有不同阶段和生长天数。
- **浇**：土会变干，浇一次浇透脚下一片；太久不浇会枯萎，枯萎后只能拔掉重种。
- **收**：熟了的作物可以收，产物**掉在地上**，再走过去捡进背包。
- **重复收**：番茄、草莓、黄瓜、红辣椒、蓝莓、茄子等可以收多次；土豆、玉米、南瓜等收一次就拔掉。
- **买卖**：作物、种子、消耗品、装饰可以卖；种子、食材、装饰可以在商店买。
- **吃与状态**：作物和食物可以吃，默认同时增加**饱食度**和**心情**；饱食度低于 30 会进入「饥饿」，自动吃东西。
- **做菜**：用合成表把食材做成蛋炒饭、番茄炒蛋、意大利面等。
- **杂草**：田里会长杂草，可以拔掉，也可以收成道具。
- **桌面图层**：草地、作物、杂草、装饰、掉落物、浇水特效、天气摇摆都在任务栏上沿渲染；背包和商店在 WebUI 里。

## 可以自定义什么

- **农作物**：增删作物、阶段数、每阶段天数、产物卖价、种子买价、各阶段/种子/产物贴图。
- **杂草**：增删杂草、阶段与天数、出现权重、上下图层、收获物名字/价值/贴图。
- **地面**：内置草皮、导入自己的 PNG、地表高度、农田大小。
- **装饰物**：图标、摆放贴图、上下图层、缩放、买价卖价。
- **天气**：增删天气（无风不可删）、持续时间、权重、作物/装饰摇摆方向与幅度、压扁幅度、速度、心情变化。
- **状态**：数值状态、开关状态、条件规则、消耗行为（例如饥饿时自动吃背包里的东西）。
- **道具**：种子/农作物/消耗品/装饰的买价卖价、能不能吃、吃掉后的状态效果、图标。
- **合成表**：1~4 个材料合成 1 个产物，桌宠可以用 `farm_craft` 合成。
- **设置模板 ZIP**：导出/导入全部设置和自定义贴图（不含存档）。
- **环境提示词**：发给桌宠的静态提示词，写“饿了怎么办、什么时候提醒主人”等。
- **安装路径**：在「游戏配置 → 安装」里直接改，改完自动搬运并重启图层。

## 安装

### 从 Coopanion 扩展页安装（推荐）

在 Coopanion 扩展页搜索「自定义农场」或 `@lily-cooperative/custom-farm`，安装后启用 World。

扩展包自带 `overlay` / `overlay-electron` / `assets`，第一次启动会复制到安装目录，不需要另外准备项目文件夹。

### 本地开发

```powershell
# 注册本地 link
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1

# 改完扩展代码后重启进程
Invoke-RestMethod -Method Post http://127.0.0.1:17788/api/run/restart

# 只重建 World（不会重新 import 源码）
Invoke-RestMethod -Method Post http://127.0.0.1:17788/api/worlds/restart
```

## 安装路径

在 Coopanion 的 **游戏配置 → 安装** 里可以直接看到和修改安装路径：

- 默认：`<Coopanion 数据目录>\custom-farm`
- 修改后自动停止桌面图层，把 `overlay` / `overlay-electron` / `assets` 搬到新目录，然后重新启动
- 存档和自定义配置仍在 `data\home\companion\data\farm\`，不会跟着搬
- 安装目录里的 `overlay\runtime\` 是运行痕迹，可以清；`assets\sprites\cust_*.png` 是上传的贴图

## 默认内容

- 18 种作物：土豆、胡萝卜、番茄、草莓、玉米、南瓜、甜菜根、蓝莓、小白菜、花椰菜、黄瓜、茄子、大蒜、菠萝、小萝卜、红辣椒、红洋葱、西瓜。
- 默认饱食度 0~100（初始 100，每游戏日 -5，低于 30 进入饥饿）；心情 0~100（初始 60，>=70 开心，<30 无聊）。
- 每种作物、米饭和意大利面默认同时加饱食度和心情；蛋炒饭、番茄炒蛋、鸡蛋、鲜肉、稻穗也带效果。
- 默认天气：无风、微风、大风、彩蛋；默认商店和 4 张食物合成表。

完整的食物数值、作物表、默认参数见 [custom-farm/README.md](custom-farm/README.md)。

## 文件与数据

| 路径 | 作用 |
|---|---|
| `custom-farm/` | 扩展本体：`src/` 逻辑、`dist/` WebUI、`tools/` 自测和打包脚本、`icon.png`、`describe.json` |
| `overlay/` | WPF 桌面图层回退 |
| `overlay-electron/` | Electron 桌面图层 |
| `assets/sprites/` | 内置作物/杂草/地面/装饰/图标 PNG |
| `scripts/` | 本地安装/停用脚本 |
| `docs/` | 打包和发布说明 |

数据文件：

- 存档：`data\home\companion\data\farm\state.json`
- 自定义配置：`data\home\companion\data\farm\custom.json`
- 上传贴图：`<安装目录>\assets\sprites\cust_*.png`
- 配置：`data\home\companion\config.json` → `worlds.farm`

## 兼容性

- Coopanion `>= 0.2.13`，World API `6`
- Node.js `>= 22`（Coopanion 自带）
- Electron `^45.1.0`（桌面图层依赖）
- Windows 10/11 默认 Electron 图层，Electron 不可用时回退 WPF；macOS / Linux 可用核心 World、WebUI 和 Electron 图层

## 许可

代码 MIT（见 `LICENSE`）。美术素材各有自己的许可，**不随代码 MIT 授权**；来源和限制见 `ASSETS.md`、`ASSET_SOURCES.md`、`THIRD_PARTY_LICENSES.md`。
