# Changelog

本项目（Coopanion 自定义农场扩展）的版本变更记录。日期使用本地时间，格式参考 Keep a Changelog。

## [0.38.0] - 2026-10-29

### Added

- 游戏配置页顶部新增「环境自检」：检查 Electron、WPF/WebView2 脚本、SDK 库和运行时，并明确提示缺少哪一项。
- 新增图层引擎切选单：自动 / 备用 Electron / WPF（WebView2）；支持手动指定备用 `electron.exe`。
- 第一次启用自动做一次环境自检；当前引擎缺运行时，推一次 `farm.env` 事件，让桌宠把问题和修复方式转告主人；之后不重复提醒。
- 新增 `farm.env` 事件类型（descriptor 共 5 个事件）。
- 图层拆成两个窗口：Electron 使用 `bg` / `top` 两个透明窗口，WPF/WebView2 回退同样起 bg / top 两个宿主；`bg` 固定在桌宠下面，`top` 设成桌宠的 owned window，按用户设置的 `layer: top/bottom` 分别绘制野草、装饰、作物和特效。
- 农作物设置新增「图层」上下选择（和杂草一样）；顶层作物绘制在 `top` 窗口，可遮挡桌宠，默认仍在 `bottom`。
- 新增 `zorder` 守护：每 500ms 重新确认桌宠窗口，桌宠重新置顶、显示/隐藏、被点击或窗口重建后，会自动重新挂 owner / 把 bg 放回桌宠下面，避免图层整体翻转。
- `renderer.js` 支持 `?layer=bg|top|all`，两个窗口加载同一套渲染器和素材。

### Changed

- 移除 `electron` npm 依赖；安装扩展不再下载第二份 Electron，解决“能下载但写不进 `node_modules/electron` / 安装后图层起不来”。
- 默认图层引擎改为「自动」：有备用 Electron 就用，否则 Windows 用 WPF/WebView2，不会因缺 Electron 导致安装失败。
- WPF 回退改为 WebView2 宿主：`overlay/overlay-webview.ps1` 加载与 Electron 相同的 `renderer.html` / `renderer.js` 和素材，缩放、阴影、粒子、水滴、晃动等视觉一致；窗口保持透明、置顶、点击穿透。
- `launch.js` 支持 `--electron <path>`；World 只把检测到的可执行文件传进去，不再隐式 `require('electron')`。
- `package.json` 的 `os` 收紧为 `["win32"]`；macOS / Linux 暂不发布，等后续实测。
- 环境自检的 `wpf` 项现在同时检查 WebView2 脚本、DLL 和 Runtime。

### Fixed

- 修复安装扩展时 Electron 安装脚本被跳过，导致 `node_modules/electron/dist/electron.exe` 缺失、图层无法启动的问题。
- 修复第一次启用时环境自检结果没有写入存档、可能重复提醒的问题。

### Tests

- 自测 167/167 通过。
- npm 包 380 个文件，包含 WebView2 x64 的 3 个 DLL 和 `zorder.ps1`；不包含 `node_modules/electron`。
- 干净安装：只安装扩展本身，无 Electron 依赖；无 Electron 时环境自检通过（WPF/WebView2 可用）。
- 实际切换 `WPF/WebView2` 引擎并截图确认农场正常显示；切回 `自动` 后 Electron 图层恢复、WebView2 进程退出。

## [0.37.0] - 2026-10-28

### Added

- 游戏配置页底部新增「备份存档」「重置一切」按钮；备份把 `state.json`、`custom.json` 写入 `data/farm/backups/backup-时间/`。
- 新增独立「存档与重置」页签，和游戏配置里的按钮共用同一套后端。
- 游戏配置新增「显示器」下拉；Electron 图层按显示器 id 移动，`overlay-electron` 写出 `screens.json` 供下拉使用。

### Changed

- 重置一切先自动备份，再清空存档和自定义设置，World 自动重启；安装路径和已上传 PNG 不删除。
- 设置页的 farm 配置页签统一改为「游戏配置」。

## [0.36.0] - 2026-10-28

### Added

- `farm_status` 新增「摆放的装饰」：名字、位置百分比、上层/下层。

### Changed

- 内置作物、小木屋、稻草堆的初始化只做一次，更新/重载不再重置用户改过的阶段、天数、价格、贴图。
- 背包/掉落物/已摆放装饰里的孤儿道具会清理，例如旧存档的 `deco_16`；新安装不再带这个 ID。
- 天气「速度（倍率）」上限从 4 放宽到 20，允许 0~20。
- 生态自定义文案说明清楚：`1 游戏日 = 现实分钟`、离线最多补几天、刷新间隔不影响生长。

## [0.35.0] - 2026-10-28

### Changed

- 删除独立 WPF 背包：`bag/`、`farm_bag` 工具、`bagScript` 和相关安装检查一起移除；背包/商店保留在 WebUI。
- 安装路径进入「游戏配置 → 安装」：默认 `<Coopanion 数据目录>\custom-farm`；首次启动复制 `overlay` / `overlay-electron` / `assets`，修改路径时停图层、搬目录、重启。
- README 重写：先讲玩法和可自定义项，文件/参数放后面；删除“坑/验证/待做/走过去的协议”等过时描述。
- 插件简介去掉“不唤模型”，强调作物、杂草、装饰、天气、状态、道具、合成表、贴图都可自定义。

## [0.34.1] - 2026-10-28

### Fixed

- `package.json` 的 `files` 补上 `describe.json`；修复市场同步提示 `describe.json missing or too large`。

## [0.34.0] - 2026-10-28

### Added

- 默认状态新增「饱食度」0~100、初始 100、每天 -5；条件 `饱食度 < 30 → 饥饿`；饥饿自动吃东西。
- 18 种作物 + 米饭 + 意大利面默认同时加饱食度和心情；蛋炒饭、番茄炒蛋、鸡蛋、鲜肉、稻穗补小效果。
- 恢复意大利面：`icon_item_pasta`、`pasta` 道具、`鲜肉 + 番茄 → 意大利面` 合成表；不再从旧存档删除 `pasta`。
- `cortico.icon` 改为包根 `icon.png`，本地 link 和 npm 包都能读到；新增 `cortico.locales.zh/en`。

### Changed

- 「添加示例」改为幂等「补齐示例」。

## [0.33.6] - 2026-10-28

### Added

- 花盆图标、`cortico.icon`、扩展元数据收尾。

## 更早版本

0.28.0 ~ 0.33.5：农场核心（18 种作物、种/浇/收/吃/买卖、背包/商店、装饰/野草/天气、状态与合成表、自定义贴图）逐步完成。
