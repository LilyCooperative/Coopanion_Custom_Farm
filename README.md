# 自定义农场（Custom Farm）

Coopanion 桌宠的农场插件：桌宠在**任务栏上沿**种地——买种、播种、浇水、除草、收割、卖作物；
桌面图层负责渲染（草地、作物、野草、掉落物和特效），背包窗口是独立的 WPF 面板（`farm_bag` 可打开）。

> **平台说明（重要）**
> - **Windows 10/11**：桌面图层默认使用 **Electron/HTML**（`overlay-electron/`），WPF 只作为 Electron 不可用时的回退；独立背包仍是 WPF。WebUI 可用。
> - **macOS / Linux**：核心 World、WebUI 和 Electron/HTML overlay 可用，但**没有实机测试**；WPF 独立背包不支持。
> - Electron overlay 已覆盖地面/作物/装饰/野草/掉落物、水特效、粒子、掉落动画；未覆盖两层 z-order、桌宠显示/隐藏联动和换屏跟随，详见 `overlay-electron/README.md`。
> - 欢迎 macOS/Linux 用户反馈安装、World 启动和 WebUI 问题：[GitHub Issues](https://github.com/LilyCooperative/Coopanion_Custom_Farm/issues)。

> **素材说明**：当前贴图仅做示意，请自行替换 `assets/sprites/` 下的 PNG。哪些是免费素材包、哪些是 AI 生成、作者有什么要求，见 **[ASSETS.md](ASSETS.md)**。

WebUI →「自定义农场」→ **农场自定义** 页签里可以换地面贴图、增删作物/杂草、改阶段天数与价值、
上传各阶段贴图、改浇水参数/浇水特效/枯萎贴图（详见 `custom-farm\README.md` 的 7.6 节）；
**状态自定义** 页签里可以定义数值/开关状态、不等式条件和消耗行为（比如饱食度低于 30 进入饥饿，
饥饿时自动吃掉一个作物把饱食度加回来，见 7.7 节）。
**道具自定义** 页管种子/农作物/消耗品/装饰的买卖价、能不能吃、吃掉后的状态效果、贴图与摆放；
**道具合成表** 页用 1~4 个道具合成新道具，桌宠可以用 `farm_craft` 合成（见 7.8 / 7.9 节）。
背包和商店共用图标格，商店右下角显示买价 `￥100`（见 7.10 节）。
设置页最右边是 **「环境提示词」**（原「自定义农场」页签）：发给桌宠的静态提示词，
可以写“看到饥饿/饱食度低就提醒主人、用 farm_consume 吃东西”，改前面的价格/阶段不会自动改这里（见 7.11 节）。
第一页最上面还可以导出/导入 **设置模板 ZIP**（所有设置 + 自定义贴图）。
设置页最左边是 **背包**（背包 + 农场预览 + 摆放道具 + 手动合成，装饰输入坐标放置），右边是 **商店**；
原来的「配置」显示为「游戏配置」；种子/农作物道具的图标自动继承作物贴图（见 7.12 节）。
> **多屏**：图层自动跟随桌宠窗口所在显示器；找不到桌宠时回退主屏。任务栏在上/下/左/右时按该屏工作区计算，换屏后 1.5 秒内重排。
**生态自定义**：农场自定义右侧的新页签。**生长条件**（原生态）放时间/离线补算/浇水；**天气**可增删天气（无风不可删），设置持续时间、触发权重、农作物/装饰物各自的摇摆方向（左右/左/右/不摆）与幅度、压扁拉长幅度；每种天气可预览 5 秒。默认有 无风、微风、大风、彩蛋；特效贴图暂不开放，显示「测试中」。

「农场自定义」页现在按 **农场 / 农作物 / 杂草 / 浇水特效** 分栏：农田大小、地表高度、屏幕纵向覆盖高度和地面平铺在“农场”，
作物上限/密度以及作物与杂草的贴图缩放在“农作物”，野草数量/概率/铲草半径在“杂草”，时间与浇水在「生态自定义 → 生长条件」。
装饰道具可设 **上/下** 图层：上层和杂草同层、清掉落点杂草，可盖住作物；下层在农作物后方。
「道具自定义 → 装饰道具」每张装饰卡里可以单独调 **这个贴图的大小（0.3~3 倍）**，上下层都生效。



> **2026-10-28 改名**：扩展目录/包名 `cortico-world-farm` → `custom-farm`，显示名「种田」→「自定义农场」。
> World 内部的 `id` 仍然是 `farm`，所以**存档路径和 `worlds.farm.*` 配置都不变**，旧档直接续上。

## 版本与依赖

| 项目 | 要求 |
|---|---|
| 当前扩展版本 | `0.33.5` |
| Coopanion | `>= 0.2.13`，World API `6` |
| Node.js | `>= 22` |
| Electron | `^45.1.0` |
| npm 包 | `@lily-cooperative/custom-farm` |

Coopanion 宿主由应用提供；`package.json` 的运行依赖只有 Electron。扩展兼容性由 `cortico.kind = "world"` 和 `cortico.api = 6` 声明。

## 目录

| 路径 | 作用 | 要不要跟机器走 |
|---|---|---|
| `custom-farm\` | 农场 World（Node 扩展）：`src\` 逻辑与工具，`dist\`「农场自定义」面板，`tools\selftest.mjs`（165 项自测）、`tools\reset-farm.ps1` | 是 |
| `overlay\` | WPF 桌面图层的回退实现；默认已切到 `overlay-electron/` | 否 |
| `overlay\tools\` | 图层回归测试、位置测试、**BOM 修复** | 是 |
| `overlay\runtime\` | 运行痕迹（state.json / 日志 / pid / 快照），**自动生成，不进版本库** | 否 |
| `bag\` | 背包窗口 `bag.ps1` + 已生成的美术 `art\` | 是 |
| `assets\sprites\` | 全部 PNG（作物各阶段、图标、草地、UI 形状、浇水/滴水） | 是，没图会空场 |
| `scripts\` | `install.ps1` / `uninstall.ps1`（本地 link 注册，不修改 Coopanion 程序） | 是 |
| `docs\` | `PACKAGE.md`（打包迁移） | 不用带 |
| `_backup\` | 存档备份（运行时右键菜单补丁已移除），**不进版本库** | 建议留着 |

## 快速开始

> 核心 World 跨平台；桌面图层优先 Electron/HTML，Electron 不可用时 Windows 回退 WPF。背包窗口仍是 Windows WPF。公开分发前请先看 [docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md)。

### 自包含扩展包

```powershell
cd custom-farm
npm pack
```

`prepack` 会把 `overlay/`、`bag/`、`assets/` 临时收进包里，`postpack` 再清理临时副本。`npm pack --dry-run` 已验证包含图层、背包和素材；生成的包可以发布到 npm（供 Coopanion 扩展页安装），也可以作为 GitHub Release ZIP 的源。

> 素材许可不等于代码 MIT；公开发布前必须先看 `THIRD_PARTY_LICENSES.md` / `ASSET_SOURCES.md`。

### 本地开发安装

```powershell
# 装到本机 Coopanion（整个 Pet 文件夹放在哪都行）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1

# 改完扩展代码：必须重启进程才会重新 import
Invoke-RestMethod -Method Post http://127.0.0.1:17788/api/run/restart

# 只重建 World（不会重新 import 源码）
Invoke-RestMethod -Method Post http://127.0.0.1:17788/api/worlds/restart
```

装完在 Coopanion 控制台启用「自定义农场」；对桌宠说“打开背包”，或手动运行 `bag\bag.ps1`。

## 验证

```powershell
cd custom-farm
node tools\selftest.mjs                 # 165 项，不依赖 Coopanion

cd ..\overlay
.\restart-layers.ps1 -Check             # 0 = 两层都在 + 野草层在桌宠之上
.\tools\test-placement.ps1              # 位置换算 15 项
.\tools\test-layers.ps1                 # 图层生命周期回归
```

**改过任何 `.ps1` 之后**跑一次 `overlay\tools\fix-encoding.ps1`：PowerShell 5.1 会把无 BOM 的中文脚本按 GBK 读，
解析失败后静默退出（表现就是“图层不见了”）。

## 线上文件（不在仓库里）

| 项 | 路径 |
|---|---|
| 存档 | `%LOCALAPPDATA%\Programs\Coopanion\data\home\companion\data\farm\state.json` |
| 自定义目录 | `...\data\farm\custom.json`（作物 / 杂草 / 地面选择；删掉它就回到内置默认） |
| 自定义贴图 | `assets\sprites\cust_*.png`（农场自定义页上传的，跟着 Pet 文件夹走） |
| 配置 | `%LOCALAPPDATA%\Programs\Coopanion\data\home\companion\config.json` → `worlds.farm` |
| 图层状态 | `overlay\runtime\state.json`（World 每 5 秒写） |
| 图层日志 | `overlay\runtime\layers.log` / `bg.log` / `weeds.log` |
| WebUI | `http://127.0.0.1:17788` |
| 桌宠 API | 自动读 `companion/config.json` 的 `worlds.desktop-pet.port`，默认 7797；可用 `PET_API` 覆盖 |

重开局用 `custom-farm\tools\reset-farm.ps1`（先停 World → 删档 → 再启动），不要手动删存档：
World 停机时会存一次，手动删会被写回去。

## 游戏日与离线

- 1 个游戏日 = `worlds.farm.realMinutesPerDay` 真实分钟（当前 60，即 1 现实小时 = 1 游戏日）。
- 桌宠关掉 / 电脑睡眠之后**不会补天**：单次推进最多 `worlds.farm.maxStepDays`（默认 1）个游戏日。
- 田里少掉的棵会在 `farm_status` 的「最近田里的变化」里写明原因（收满/拔枯/枯死/缩放删除）。

## 许可

代码 MIT（见 `LICENSE`）。美术素材各有自己的许可，**不随代码 MIT 授权**；公开分发前必须逐项确认 `THIRD_PARTY_LICENSES.md` / `ASSET_SOURCES.md`，不要直接再分发购买包的原始素材。

## 素材许可

素材来源见 [ASSET_SOURCES.md](ASSET_SOURCES.md)。

![免费素材农场](docs/screenshot-free-crops.png)

地面、大树、稻草人来自 **Grok 重绘**；18 种作物来自 **Farm Crops - Growth Stages Pixel Art Pack**（IDRK15599）；野草来自 **Free Pixel Grass & Bushes Pack**（vigi game）。完整许可与限制见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)（作者：https://irdk15599.itch.io/ ），原始文本在 `assets\LICENSES\GandalfHardcore Farming Tiles and Crops 32x32.txt`。
