# 公开发布清单

当前版本：`0.37.0`。

## 包内容

- `custom-farm/package.json`：`private: false`，`publishConfig.access = public`
- `files`：`src`、`dist`、`overlay`、`overlay-electron`、`assets`、`icon.png`、`describe.json`、`README.md`、`LICENSE`
- `cortico.kind = world`，`cortico.api = 6`，`cortico.icon = icon.png`
- `cortico.locales.zh / en` 提供市场页显示名和简介
- `prepack` / `postpack` 只临时复制图层和素材，不把运行痕迹打进包

## 平台

- 核心 World、WebUI 跨平台
- Windows 默认 Electron/HTML 桌面图层，Electron 不可用时回退 WPF
- macOS / Linux 使用 Electron 图层
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
