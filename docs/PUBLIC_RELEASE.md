# 公开发布清单

当前版本：`0.38.1`。

## 包内容

- `custom-farm/package.json`：`private: false`，`publishConfig.access = public`
- `files`：`src`、`dist`、`overlay`、`overlay-electron`、`assets`、`icon.png`、`describe.json`、`README.md`、`LICENSE`
- `cortico.kind = world`，`cortico.api = 6`，`cortico.icon = icon.png`
- `cortico.locales.zh / en` 提供市场页显示名和简介
- 没有 npm `dependencies`：安装时不会再下载 Electron
- `prepack` / `postpack` 只临时复制图层和素材，不把运行痕迹打进包

## 平台

- 仅 Windows 10/11（`os: ["win32"]`）；macOS / Linux 暂不支持，等后续测试
- 核心 World、WebUI 可在 Node 里跨平台跑，但正式安装只放行 Windows
- Windows 默认「自动」：有备用 Electron 就用，否则用 WPF/WebView2；WPF 回退加载同一套 renderer，视觉与 Electron 一致
- WPF 回退需要 Windows 10/11 的 WebView2 Runtime（系统一般自带）
- 独立 WPF 背包已移除，背包/商店在 WebUI 里

## 安装

- 官方安装：Coopanion 扩展页搜索 `@lily-cooperative/custom-farm`
- 本地开发：`scripts\install.ps1` 以 link 方式注册
- 安装路径：游戏配置 → 安装，默认 `<Coopanion 数据目录>\custom-farm`，修改后自动搬运

## 素材

- 18 种作物及种子/产物图标：Farm Crops - Growth Stages Pixel Art Pack（IDRK15599）
- 野草：Free Pixel Grass & Bushes Pack（vigi game）
- 地面、装饰、食物图标、粒子、水特效、扩展图标：Grok 重绘
- 意大利面图标：项目内按同一调色板补画
- 代码 MIT；素材不随 MIT 授权，详见根目录 `ASSETS.md`、`ASSET_SOURCES.md`、`THIRD_PARTY_LICENSES.md`

## 发布

- 自测：`node tools/selftest.mjs`（167 项）
- 打包：`cd custom-farm && npm pack`
- 发布：`npm publish --access public`
- 市场同步：在 `Pal-AI-Lab/cortico-extensions` 开 `[sync] @lily-cooperative/custom-farm` issue
