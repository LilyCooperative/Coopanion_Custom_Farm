# 公开前检查（2026-10-28）

对照 Coopanion 官方 README：
<https://github.com/Pal-AI-Lab/Coopanion/blob/main/README_zh.md>

## 结论

现在**可以本地用**，但**还不能直接公开分发**。最关键的是：素材许可、npm 发布元数据/实际发布。

## 一、独立性

已处理：

- 删除了 `scripts/repatch-connector.ps1`。它直接改 `coopanion-connector-dsh` 的 `dist/index.cjs`，不是独立插件该做的事。
- World 启动时不再删除用户「启动」文件夹里的旧快捷方式。
- 运行时不再修改 Coopanion / DSH 的程序文件；只读写自己的 `data/farm` 和 `overlay/runtime`。

仍需处理：

- `scripts/install.ps1` 会写 `data/extensions/package.json` 做 link 注册。这是手动开发安装方式，官方 Coopanion 应通过「扩展」页安装；公开版不要依赖它。
- 核心 World 跨平台；WPF 桌面图层/独立背包仅 Windows。新增实验性 Electron/HTML overlay（`overlay-electron/`，非 Windows 自动尝试），但只覆盖地面/作物/装饰/野草/掉落物，未实机验证，也没有水特效/粒子/双层 z-order。
- `overlay`/`bag` 已改为从 `companion/config.json` 的 `worlds.desktop-pet.port` 读取，支持 `PET_API`/`COOPANION_CONFIG` 覆盖；WebUI 测试仍写死 `17788`。
- `install.ps1` / `uninstall.ps1` 只应在开发包中，公开安装包应改为官方扩展安装或自包含 ZIP。

## 二、打包

当前 `custom-farm/package.json` 已改为自包含打包：

- `"private": false`，已去掉 `os` 限制，核心 World 可跨平台安装。
- `"files"` 包含 `src`、`dist`、`overlay`、`bag`、`assets`、`README.md`、`LICENSE`。
- `prepack` 脚本临时把 Pet 根目录的 `overlay/`、`bag/`、`assets/` 复制进包内，`postpack` 清理。
- 已用 `npm pack --dry-run` 验证：**372 个文件**，包含 `overlay/overlay.ps1`、`bag/bag.ps1` 和素材。

剩余：没有 `repository` / `homepage` / `bugs` / `author` 字段；尚未真正发布 npm。

## 三、素材

已经替换：

- 地面、大树、稻草人：Grok 重绘
- 18 种作物及种子/产物图标：Farm Crops - Growth Stages Pixel Art Pack（IDRK15599，免费商用，不可单独转售/再分发）
- 野草：vigi game
- 枯萎、食材/菜品、闪光、烟尘、兜底土图标、背包标题/面板：Grok 重绘

仍待确认：

- 水特效 94 张已全部从 `water-fx-redraw` / `my-drawn-effects` 覆盖为 Grok 版；只剩素材许可问题。

许可风险：

- vigi game 允许个人/商业使用，但不能单独转卖/再分发素材包。
- Grok 生成图没有第三方许可，但需要确认生成服务条款允许公开再分发。

## 四、文档

已处理：

- 修正 README 里“插件本身不含美术资源”“数值来自游戏配置表”“只有熟了/枯了才 pushEvent”等过期说法。
- 修正 token 事件说明：自动唤醒只剩 `farm.dry` / `farm.ripe` / `farm.state`。

仍需：

- README 已加自包含 `npm pack` 说明和 Windows/WPF 要求；仍要决定官方扩展页还是 GitHub ZIP。
- README 明确代码 MIT、素材不随 MIT。
- 更新 / 删除 `docs/PACKAGE.md` 里手动改 `extensions/package.json` 的说明。

## 五、工程/发布

- `node tools/selftest.mjs`：166/166。
- 没有 CI、没有 WPF 图层自动测试、没有 npm pack 校验。
- 没有正式 release tag / changelog。
- 建议加：
  - GitHub Actions: `node tools/selftest.mjs` + `node --check`
  - 一个在 Windows runner 上启动 `overlay.ps1 -Snapshot` 的冒烟测试
  - `npm pack --dry-run` 检查包内容
  - 版本 tag 和 release 说明

## 六、对照 Coopanion README 的注意点

- **扩展安装**：官方是「扩展」页安装 npm 上带 `cortico-world` 的包，装完点「重启进程」；不是手动改 `extensions/package.json`。
- **许可**：Coopanion 本体 AGPL-3.0；插件代码 MIT 可以并存，但公开时要给源码和 LICENSE。
- **第三方素材**：必须单独声明；官方也有 `THIRD_PARTY_NOTICES.md` 的做法。
- **平台**：核心 World 跨平台，桌面图层/独立背包 Windows-only。
- **数据/隐私**：插件不联网；只读写本机 `data/farm` 和 `overlay/runtime`。
- **本地服务**：端口已动态读取；官方提到本地服务有随机凭据，当前只读 API 没有带凭据，仍需按官方当前接口核对。

## 公开前最小清单

1. 确认 Grok 生成服务条款允许再分发水特效。
3. 自包含包已能 `npm pack`；下一步是补 `repository` 元数据并实际发布/上交扩展页。
4. `private` 已去掉、LICENSE 已补；还缺 `repository` 和发布说明。
5. 把 `scripts/install.ps1` 标成开发安装，不作为公开安装步骤。
6. 删除/改写 `docs/PACKAGE.md` 里的 host 注册说明。
7. 加 CI / Windows 冒烟测试。
8. 重新跑一次素材来源审计并归档。
