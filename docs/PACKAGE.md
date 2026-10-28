# 打包与迁移

> 公开版优先用 Coopanion 扩展页安装；本地开发才需要 link 安装。

## 目录结构

| 路径 | 作用 |
|---|---|
| `custom-farm\` | 扩展本体（World、WebUI、工具、图标、自描述） |
| `overlay\` | WPF 桌面图层回退 |
| `overlay-electron\` | Electron 桌面图层 |
| `assets\sprites\` | 内置作物、杂草、地面、装饰、图标 PNG |
| `scripts\` | 本地安装 / 停用脚本 |
| `docs\` | 打包和发布说明 |

## 本地安装

```powershell
# 在项目根目录
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

脚本会把 `custom-farm` 以 link 方式登记进
`%LOCALAPPDATA%\Programs\Coopanion\data\extensions\package.json`，然后可选启动桌面图层。

停用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
# 连扩展注册一起摘掉
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 -RemoveExtension
```

## 安装目录

扩展第一次启动时，会把包内的 `overlay` / `overlay-electron` / `assets` 复制到：

```text
<Coopanion 数据目录>\custom-farm
```

这个路径可以在 Coopanion **游戏配置 → 安装** 里修改；改完会自动搬运并重启图层。

存档和自定义配置不跟着安装目录走，固定在：

```text
%LOCALAPPDATA%\Programs\Coopanion\data\home\companion\data\farm\
```

## 打包

```powershell
cd custom-farm
npm pack
```

`prepack` 会把项目根目录的 `overlay` / `overlay-electron` / `assets` 临时复制进包内，`postpack` 再清理。生成的包可以直接发布到 npm，也可以作为 GitHub Release 的源。

## Coopanion 升级

- 扩展本体、`custom.json`、`state.json` 都在数据目录，升级 App 不受影响。
- 安装目录里的图层和素材也保留；需要重装时删掉 `<数据目录>\custom-farm` 即可，下次启动会重新复制。
