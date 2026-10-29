# 自定义农场 · custom-farm

给 Coopanion 桌宠的种田扩展。桌宠在**任务栏上沿**种地，桌面图层实时渲染；所有配置都在 Coopanion WebUI 里完成，不再需要独立背包窗口。

**18 种作物只是起点。** 农作物、杂草、装饰物、天气、状态、道具、合成表和贴图都可以在面板里增删、改数值、换图——想种什么、长什么样、吃什么补什么，全由你决定。

## 玩法

- **种**：桌宠走到田里，消耗 1 包种子种下一棵；作物有不同阶段和生长天数。
- **浇**：土会变干，浇一次能浇透脚下一片；太久不浇会枯萎，枯萎后只能拔掉重种。
- **收**：熟了的作物可以用 `farm_harvest` 收，产物**掉在地上**，要再用 `farm_collect` 捡进背包。
- **重复收**：番茄、草莓、黄瓜、红辣椒、蓝莓、茄子等可以收多次；土豆、玉米、南瓜等收一次就拔掉。
- **卖与买**：背包里的作物、种子、消耗品、装饰可以卖；种子、食材、装饰可以在商店买。
- **吃与状态**：作物和食物可以吃，默认同时增加**饱食度**和**心情**；饱食度低于 30 会进入「饥饿」，自动吃东西。
- **做菜**：用「道具自定义 / 合成表」把食材做成蛋炒饭、番茄炒蛋、意大利面等。
- **杂草**：田里会长杂草，可以拔掉，也可以把带收获物的杂草收成道具。
- **桌面图层**：草地、作物、杂草、装饰、掉落物、浇水特效、天气摇摆都在任务栏上沿渲染；背包和商店在 WebUI 里。

## 可以自定义什么

| 面板 | 能改什么 |
|---|---|
| **农场自定义 → 农场** | 地面贴图、地表高度、农田大小、导入自己的 PNG |
| **农场自定义 → 农作物** | 增删作物、阶段数、每阶段天数、产物卖价、种子买价、各阶段/种子/产物贴图、上下图层 |
| **农场自定义 → 杂草** | 增删杂草、阶段与天数、出现权重、上下图层、收获物名字/价值/贴图 |
| **农场自定义 → 浇水特效 / 枯萎** | 浇水帧序列、水花帧序列、帧间隔、枯萎贴图 |
| **生态自定义** | 一个游戏日多长、离线最多补几天、刷新间隔、每天是否推事件、浇水蒸发/补水/枯萎天数、天气 |
| **天气** | 增删天气（无风不可删）、持续时间、权重、作物/装饰摇摆方向与幅度、压扁幅度、速度倍率（0~20）、心情变化 |
| **状态自定义** | 数值状态、开关状态、条件规则、消耗行为（例如饥饿时自动吃背包里的东西） |
| **道具自定义** | 种子/农作物/消耗品/装饰的买价卖价、能不能吃、吃掉后的状态效果、图标、摆放贴图、图层、缩放 |
| **合成表** | 1~4 个材料合成 1 个产物，桌宠可以用 `farm_craft` 合成 |
| **设置模板 ZIP** | 导出/导入全部设置和自定义贴图（不含存档） |
| **环境提示词** | 发给桌宠的静态提示词，写“饿了怎么办、什么时候提醒主人”等 |

所有上传的贴图只接受 PNG，单张 ≤ 4 MB、≤ 2048×2048。种子/农作物道具的图标会自动继承作物设置里的贴图。

## 默认食物效果

新开局自带：

- **饱食度** 0~100，初始 100，每游戏日 -5；低于 30 → **饥饿**
- **心情** 0~100，初始 60；`>= 70` 开心，`< 30` 无聊
- 饥饿生效时自动吃背包里的作物/食物，0.5 游戏日冷却

每种作物、米饭和意大利面默认同时加饱食度和心情：

```text
土豆 24/2、胡萝卜 16/2、番茄 14/4、草莓 12/7、玉米 22/3、南瓜 28/4
甜菜根 16/2、蓝莓 10/7、小白菜 14/2、花椰菜 16/2、黄瓜 12/3、茄子 15/2
大蒜 6/1、菠萝 18/8、小萝卜 10/2、红辣椒 5/3、红洋葱 8/1、西瓜 24/7
大米 30/3、意大利面 42/9
```

蛋炒饭、番茄炒蛋、鸡蛋、鲜肉、稻穗也带效果。道具自己的效果优先于「消耗行为」里的 `effectDelta`；自定义作物默认没有食物效果，可以在道具页单独加。

## 安装

### 从 Coopanion 扩展页安装（推荐）

在 Coopanion 的扩展页搜索「自定义农场」或 `@lily-cooperative/custom-farm`，安装后启用 World。

扩展包自带 `overlay` / `overlay-electron` / `assets`，第一次启动会把它们复制到安装目录，不需要另外准备项目文件夹。

**扩展不再把 Electron 作为 npm 依赖下载。** 安装时只装扩展本身；有没有 Electron 运行时都不会影响安装。桌面图层按下面的「环境自检 / 图层引擎」选择。

### 本地开发

```powershell
# 注册本地 link
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1

# 改完扩展代码后重启进程
Invoke-RestMethod -Method Post http://127.0.0.1:17788/api/run/restart
```

## 游戏配置

### 环境自检 / 图层引擎

**游戏配置页顶部**有「环境自检」按钮，会检查：

- 当前平台和 Node 版本
- 是否能找到 `electron.exe`
- 安装目录里的 `overlay-webview.ps1`、WebView2 库和 WebView2 运行时是否可用

自检会明确显示「缺少 Electron 运行时」还是「WPF/WebView2 图层可用」。下面的「图层引擎」切选单可以选：

- **自动**：有备用 Electron 就用，没有就用 WPF/WebView2（推荐，不会下载 Electron）
- **备用 Electron**：只使用检测到的 Electron，需要 `electron.exe`
- **WPF（WebView2）**：完全不使用 Electron，但加载和 Electron 相同的 `renderer.html/renderer.js`

WPF 回退现在是 WebView2 宿主，不再用另一套 WPF 自绘；因此缩放、精灵位置、阴影、粒子、水滴、晃动等视觉效果和 Electron 基本完全一致。需要 Windows 10/11 自带的 WebView2 Runtime。

自检里的「Electron 包」下拉会列出检测到的路径；也可以在「备用 Electron」配置项里手动选 `electron.exe`。

第一次启用时还会自动做一次自检；如果当前引擎缺运行时，会推一次 `farm.env` 事件，让桌宠把“缺少 Electron 运行时 / 怎么修”转告主人。之后不会重复提醒。

Coopanion 只提供打包后的 `Coopanion.exe`，没有可复用的独立 `electron.exe`；所以默认不再下载第二份 Electron。备用 Electron 可以放在安装目录的 `node_modules\electron\dist\electron.exe`，或在「备用 Electron」里手动选择路径。

### 安装路径

在 Coopanion 的 **游戏配置 → 安装** 里可以直接看到和修改安装路径：

- 默认：`<Coopanion 数据目录>\custom-farm`
- 修改后会停止桌面图层，把 `overlay` / `overlay-electron` / `assets` 搬到新目录，然后重新启动
- 存档和自定义配置仍在 `data\home\companion\data\farm\`，不会被搬走
- 安装目录里的 `overlay\runtime\` 是运行痕迹，可以清；`assets\sprites\cust_*.png` 是你上传的贴图

### 显示器

**游戏配置 → 显示器** 可以选择图层放在哪块屏幕：

- 「自动」使用主屏
- 下拉里会列出当前所有显示器，改完约 1 秒内移动到目标屏幕
- 这个设置作用于 Electron 图层；WPF/WebView2 回退使用主屏（与现有 WPF 行为一致）

### 备份与重置

**游戏配置** 页底部有「存档与重置」：

- **备份存档**：把 `state.json` 和 `custom.json` 复制到 `data\farm\backups\backup-时间\`
- **重置一切**：先自动备份，再清空 `state.json` 和 `custom.json`，World 自动重启并生成默认目录；安装路径和已上传的 PNG 文件不会被删除

也可以从「存档与重置」页签操作同样的按钮。

## 桌面图层

- 图层拆成 `bg` / `top` 两个透明窗口：`bg` 在桌宠下面，`top` 是桌宠的 owned window，永远在桌宠上面。
- 野草、装饰、作物、掉落物和特效按 `layer` 设置分配到两个窗口；上层野草/装饰可以正常遮挡桌宠，下层作物在桌宠后面。
- 层级守护每 500ms 重新确认桌宠窗口；桌宠重新置顶、显示/隐藏、被点击或窗口重建后，会自动重新挂 owner / 把 `bg` 放回桌宠下面，防止图层整体翻转。
- **Windows 10/11**：默认「自动」——检测到备用 Electron 就用 Electron，否则用 WPF/WebView2；不会为了安装扩展下载 Electron。两个引擎都使用同一套 Canvas renderer，缩放和特效一致。
- **macOS / Linux**：暂不支持；`os` 已收紧为 `win32`。
- 图层跟着桌宠显示/隐藏/退出；任务栏换边、换屏会重新计算位置。
- 背包、商店、农场预览、摆放和手动合成都在 WebUI。

## 工具

| 工具 | 用途 |
|---|---|
| `farm_status` | 看每棵作物的位置、等级、进度、水分、是否可收/枯萎，背包、掉落物、摆放的装饰物位置和最近田里的变化 |
| `farm_stand` | 站到某个位置，`at` 必填 |
| `farm_plant` | 在脚下种一棵，消耗 1 包种子 |
| `farm_water` | 浇脚下一片 |
| `farm_harvest` | 收脚下这棵，产物掉在地上 |
| `farm_pull` | 拔掉枯萎的作物 |
| `farm_collect` | 把脚下的掉落物捡进背包 |
| `farm_consume` | 吃背包里的作物/食物，按道具效果加减状态 |
| `farm_craft` | 按合成表合成道具 |
| `farm_shop` | 看商店 |
| `farm_buy` | 买种子/消耗品/装饰 |
| `farm_sell` | 卖背包里的道具 |
| `farm_place` | 把装饰放到地上 |

事件：`farm.ripe`、`farm.dry`、`farm.day`、`farm.state`、`farm.env`。`farm.day` 默认关，`dailyEvent=true` 才推；`farm.env` 只在第一次启用自检失败时推一次，让桌宠把环境问题转告主人。

## 默认参数

| 键 | 默认 | 说明 |
|---|---|---|
| `maxPlants` | 12 | 同时最多几棵 |
| `farmCells` | 48 | 农田总宽度（12~48 格） |
| `cropGapScale` / `cropGapPct` | 0.8 / 2 | 作物间距 |
| `cropScale` / `dropScale` | 1.5 / 0.6 | 作物 / 掉落物大小 |
| `groundHeight` / `stripHeight` | 5 / 320 | 地表高度 / 图层纵向覆盖 |
| `realMinutesPerDay` | 60 | 1 游戏日 = 多少真实分钟 |
| `maxStepDays` | 1 | 离线回来最多补几个游戏日（安全上限，防止关机一夜跳几十天） |
| `tickIntervalMs` | 5000 | 刷新间隔；只影响状态/事件更新频率，不改变生长速度 |
| `startCoins` | 120 | 新开局金币 |
| `moodIntervalMin` | 10 | 心情按真实分钟结算的间隔 |
| 浇水 | 0.15 / 1 / 2.2 | 每天蒸发 / 一次补水 / 干透后枯萎天数 |

## 文件

| 路径 | 作用 |
|---|---|
| `src/crops.js` | 18 种作物的内置阶段/生长点/收获次数/贴图前缀 |
| `src/shop.js` | 内置价格表 |
| `src/catalog.js` | 读取/保存 `custom.json`，编译作物、杂草、地面、道具、状态、天气 |
| `src/farm.js` | 种、浇、收、捡、卖、状态、天气等纯逻辑 |
| `src/world.js` | World、工具、tick、WebUI、安装路径迁移 |
| `src/ENV_PROMPT.md` | 发给桌宠的环境提示词 |
| `dist/webui.js` / `.css` | 「自定义农场」面板 |
| `icon.png` | 扩展图标（安装页显示） |
| `describe.json` | 工具/事件自描述 |
| `overlay/` | WPF/WebView2 回退（同一套渲染器） |
| `overlay-electron/` | Electron 图层 |
| `assets/` | 内置作物/杂草/地面/装饰/图标 |

数据文件：

- 存档：`data\home\companion\data\farm\state.json`
- 自定义配置：`data\home\companion\data\farm\custom.json`
- 上传贴图：`<安装目录>\assets\sprites\cust_*.png`

## 兼容性

- Coopanion `>= 0.2.13`，World API `6`
- Node.js `>= 22`（Coopanion 自带）
- 仅 Windows 10/11；macOS / Linux 暂不支持，等后续测试
- Electron 不是 npm 依赖；备用 Electron 可选，Windows 没有时用 WPF/WebView2
- WPF 回退需要 Windows 10/11 的 WebView2 Runtime（系统一般自带）
- Windows 10/11 已实机测试；macOS / Linux 未实机测试

## 许可

代码 MIT。美术素材各有自己的许可，不随代码 MIT 授权；来源和限制见仓库根目录的 `ASSETS.md`、`ASSET_SOURCES.md`、`THIRD_PARTY_LICENSES.md`。
