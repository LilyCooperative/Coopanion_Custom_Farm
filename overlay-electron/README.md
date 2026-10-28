# Electron / HTML overlay（实验）

这是 WPF `overlay/` 的跨平台替代实现：Electron 透明置顶窗口 + Canvas 渲染 `overlay/runtime/state.json`。

## 状态

- **Windows**：默认走 Electron/HTML；只有 Electron 不可用时才回退 WPF `overlay/`。
- **macOS / Linux**：World 检测到 `electron` 依赖后启动本目录；**没有实机测试**，欢迎反馈。
- 当前 Electron 渲染器覆盖：地面、作物、大树、稻草人、野草、掉落物、水特效、闪光粒子、收割粒子、掉落物弹跳/吸附、天气摇摆/压扁拉长。
- 尚未覆盖：两层 z-order（背景层在桌宠后、前景层在桌宠前）、桌宠隐藏联动、多屏跟随。
- 因此它是**可运行的跨平台基础版**，不是 WPF 全部功能的等价替换。

## 安装

`electron` 是 `custom-farm/package.json` 的 dependency：

```powershell
cd custom-farm
npm install
```

Coopanion 扩展页安装时也会安装 optional dependency。没有 `electron` 时，Windows 继续用 WPF，其他平台只保留 WebUI。

## 直接运行

```powershell
node overlay-electron/launch.js `
  --state-path .\overlay\runtime\state.json `
  --assets-dir .\assets\sprites `
  --pid .\overlay-electron\runtime.pid `
  --log .\overlay-electron\runtime.log
```

## 限制

- Electron 窗口目前使用主显示器工作区，不跟随桌宠换屏。
- 透明窗口依赖系统合成器；Linux 需要桌面合成器，macOS 需要屏幕录制权限之外无特殊要求。
- 如果启动失败，World 会保留 WebUI；Windows 会回退 WPF。
