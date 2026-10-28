# 打包与迁移（开发安装）

> 这是本地开发/迁移说明。公开版应优先用 Coopanion「扩展」页安装，或发一个自包含 ZIP；不要要求用户手改 `data/extensions/package.json`。


这套东西是**一个自包含的文件夹**：拷走整个 `Pet\`，在另一台机器上跑一遍 `scripts\install.ps1` 就能用。

## 目录结构

| 路径 | 作用 | 必须跟着走？ |
|---|---|---|
| `custom-farm\` | 自定义农场 World（Node 扩展，12 个工具） | 是 |
| `overlay\` | 任务栏上沿的桌面图层（WPF）+ 单守护启动器 | 是 |
| `overlay\tools\` | 图层回归测试 / 位置测试 / **BOM 修复** | 是 |
| `bag\` | 背包窗口（WPF）+ 生成好的美术 | 是 |
| `assets\sprites\` | 全部 PNG（作物各阶段、图标、草地、UI 形状、浇水/滴水 94 张） | 是，没图会空场 |
| `scripts\install.ps1` | 一键安装/迁移 | 是 |
| `scripts\uninstall.ps1` | 停用（停图层 + 清掉旧登录自启；`-RemoveExtension` 再摘掉扩展注册） | 是 |
| `docs\` | 打包/迁移说明（本文件） | 不用带 |
| `_backup\` | 存档备份（右键菜单补丁已移除） | 建议留着 |

## 新机器上三步

```powershell
# 1. 把整个 Pet 文件夹拷到目标机器（路径随便）
# 2. 装好 Coopanion 并至少启动一次（生成 data\extensions）
# 3. 在 Pet 根目录跑安装脚本
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

装完重启 Coopanion，在控制台启用「自定义农场」World。

`scripts\install.ps1` 干了什么：

1. 检查目录完整性（缺 `overlay\overlay.ps1` 之类会直接报错）
2. 把扩展以 **link** 方式登记进 `%LOCALAPPDATA%\Programs\Coopanion\data\extensions\package.json`
   （`link:<Pet>\custom-farm`，所以扩展不需要复制，改代码立刻生效；旧名字 `cortico-world-farm` 会被自动摘掉）
3. 有 pnpm 就顺手 `pnpm install`
4. 启动两块桌面图层：`overlay\restart-layers.ps1 -Restart`（单守护，缺哪块补哪块）
5. 清理老版本的"登录自启"快捷方式：图层现在跟着桌宠启停（桌宠退出/隐藏，图层也退出/隐藏），不需要它

参数：`-PetHome <目录>`、`-CoopanionData <目录>`、`-NoOverlay`。

停用 / 卸载（Pet 文件不删，随时可以再装）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
# 连扩展注册一起摘掉（需要重启 Coopanion；先停用「自定义农场」World）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 -RemoveExtension
```

## 机器相关的部分（都自动处理）

| 项 | 怎么处理的 |
|---|---|
| 绝对路径 | 扩展用 `src/paths.js` 从自身位置推（`<Pet>\overlay\...`），没有写死路径 |
| Coopanion 安装位置 | 脚本读 `%LOCALAPPDATA%`，可用 `-CoopanionData` 覆盖 |
| 农场自定义 | `custom.json` 在 `data\farm\`（每台机器一份）；上传的贴图在 `assets\sprites\cust_*.png`，跟着 Pet 文件夹走 |
| 扩展被复制而非链接 | 设环境变量 `PET_HOME=<Pet>`，或在 World 配置里填 `petRoot` |
| 屏幕尺寸/任务栏位置 | 图层每次启动用 `SystemParameters.WorkArea` 重新算，任务栏换边也行 |
| 桌宠位置 | 图层/背包从 `companion/config.json` 的 `worlds.desktop-pet.port` 读，默认 7797；可用 `PET_API` 覆盖 |
| 图层生命周期 | 跟着桌宠：显示/隐藏/退出都自动跟；不再写启动文件夹，换机器不用重新放快捷方式 |
| 图层 pid / 状态 | 全在 `overlay\runtime\`，跟着文件夹走；换机器不会有旧 pid 干扰 |

## Coopanion 升级会怎样

| 东西 | 升级后 |
|---|---|
| 扩展本体（link 到 `<Pet>`） | **不受影响** |
| 存档、背包 | 在 `data\home\companion\data\farm\`，不受影响 |
| 农场自定义 | `custom.json` 在同一个 data 目录；贴图在 `<Pet>\assets\sprites`，都不受影响 |
| 图层 / 背包窗口 | 独立进程，不受影响 |
| WPF 背包窗口 | 用 `farm_bag` 工具或手动 `bag\bag.ps1` 打开；右键菜单入口已移除 |


## 打包成压缩包

```powershell
Compress-Archive -Path .\custom-farm, .\overlay, .\bag, .\assets, .\scripts, .\docs, .\README.md, .\_backup -DestinationPath ..\custom-farm.zip
```

`overlay\tools\` 会跟着 `overlay` 一起进去（`fix-encoding.ps1`、`test-layers.ps1`、`test-placement.ps1`）。

打包前建议清掉运行痕迹（**别删 `runtime\state.json`**，那是线上存档；`commands\` 留着）：

```powershell
Get-ChildItem .\overlay\runtime -File |
  Where-Object { $_.Name -ne 'state.json' } |
  Remove-Item -Force
```

换机器后第一次 `restart-layers.ps1` 会重新生成 pid / supervisor.json / 日志；
旧 pid 文件即使留着也不会误杀——`restart-layers.ps1` 会核对进程命令行。

## 环境依赖

- Windows 10/11，PowerShell 5.1（自带），.NET Framework 4.x（WPF，自带）
- Coopanion 已安装并至少运行过一次
- Node 22+：**Coopanion 自带**，不需要另外装
- pnpm：可选，没有也能装（Coopanion 启动时自己会装扩展）
- 不需要 VBScript / 计划任务：图层由 World 启动，跟着桌宠启停

## 四个坑（给以后的我）

1. **`extensions\package.json` 不能带 BOM**：PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会加 BOM，Node 的 `JSON.parse` 直接抛错，**Coopanion 起不来**。必须用 `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`。
2. **从命令行启动 Coopanion 前先清 `ELECTRON_RUN_AS_NODE`**：DSH 之类的工具会把它设成 1，继承下去后 `Coopanion.exe` 退化成纯 Node——不报错、不起界面、静默退出。
3. **spawn 别加 `detached: true`**：Windows 上那会用 DETACHED_PROCESS 起进程，PowerShell 5.1 起不来（窗口一直不出现、日志也没有）。不加也一样能活过父进程；再带上 `windowsHide: true` 就不会闪窗。
4. **`.ps1` 反过来必须带 UTF-8 BOM**：不带的话 PowerShell 5.1 按 GBK 读，中文源码解析失败、进程在写日志前静默退出（看起来就是"图层消失"）。改完脚本跑 `overlay\tools\fix-encoding.ps1`，它会补 BOM 并逐文件验证。
