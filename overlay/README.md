# 桌面图层（overlay）· 使用说明

> 运行时 WPF 回退已改为 WebView2 宿主 `overlay-webview.ps1`，加载与 Electron 相同的
> `overlay-electron/renderer.html` / `renderer.js`；本文档描述的是保留的旧 WPF 自绘
> 实现（`overlay.ps1`），正常启动不再使用它。
>
> v4：作物种在任务栏上沿的全宽透明条带上；统一缩放、掉落物、摇晃、浇水/枯萎特效、
> 收割的作物**不发光**。图层只渲染，状态全从 `state.json` 读。

## 1. 它长什么样

```
工作区（WorkArea）
├────────────────────────────────────────────┤
│   第X天 HH:MM 天气 · 背包 N 件 · 地上 M 个    │ ← HUD（左上）
│         🌱        🌽        🍅     ✨  🎃      │ ← 作物 + 掉落物（没有文字标签）
├────────────────────────────────────────────┤ ← 地面线 = 草地顶边
│▨▨▨▨▨▨ 草地（6 行草皮 × 2 倍 = 12px）▨▨▨▨▨▨│
├────────────────────────────────────────────┤ ← 任务栏上沿
│ [任务栏]                                     │
```

素材目录：`..\assets\sprites\`（换一套美术只换这里的 PNG，不改代码）。
草地参数：`-GroundTile popo20230114_gd_grass_0`、`-GroundRows 6`、`-GroundSink 6`。
草皮按 6 行 × 2 倍 = 12px 画，但整体**往下沉 6px**，下半截被窗口裁掉 → 任务栏上方只露 **6px 绿**。
作物/掉落物/特效的"地面线"跟着抬到露出部分的上沿，所以脚是踩在露出来的草上的。
想更薄就加大 `-GroundSink`（别超过 10，剩 2px 就只剩一条线了）。

整体尺寸：`-Zoom 2` + `-StripHeight 140`。
想换一块地（比如草地+石头的 `popo20230114_gd_grass_1`）改 `-GroundTile` 就行。

- 任务栏在下：地面 = 任务栏上沿；在别的边：地面 = 屏幕底边（跟桌宠一致）。
- 每 1.5 秒比对一次工作区，任务栏换边/改高度/换分辨率都会跟着重排。
- 位置换算是纯函数 `placement.ps1:Get-Placement`，15 项回归测试：`tools\test-placement.ps1`。

## 2. 这一版新增

| 特性 | 怎么做的 |
|---|---|
| **统一缩放** | 所有作物同一个倍率（`-Zoom`，默认 2），相对大小 = 贴图像素大小；生长靠**换帧**，不靠放大 |
| **草地地表** | 从 12×12 草皮块 `popo20230114_gd_grass_0` 截上面 `-GroundRows`（默认 6）行，按同一倍率平铺整条；作物脚踩在草地上面 |
| **没有文字** | 作物上方不再写名字/阶段，只有左上角 HUD（天数/时间/天气/背包/地上掉落数） |
| **不发光** | 熟了不加光效；掉落物只是图标本身（淡暗影，没有金色光晕）；地面也不再画站立的金色光条 |
| **不重放历史特效** | 启动时把 `state.fx` 里上次运行留下的收/浇水/收割标记为已播；否则旧位置会冒出一串发光图标，像"地板在发光"。演示/测试要重放时加 `-PlayFxHistory` |
| **让开任务栏系统 UI** | 每 250ms 看前台窗口：托盘溢出（`TopLevelWindowForOverflowXamlIsland` / `NotifyIconOverflowWindow`）、右键菜单 `#32768`、任务视图、开始菜单等在前面时，把图层 `Hide()`，不盖住它们；系统 UI 消失后按桌宠可见性恢复 |
| **掉落物** | 收割后产物从植株处**往左/右弹一段距离**落地（抛物线），落地后轻轻浮动，**一直留在原地直到被捡走**；`collect` 让它划一道弧线**被吸到桌宠身上**。尺寸 = 图标像素 × `-Zoom` × `-DropScale`（默认 1，和作物同一像素刻度） |
| **摇晃** | 后台线程每 400ms 读 `http://127.0.0.1:7797/api/state` 的 `startX`（桌宠位置），离某棵 < 4.5% 就让它晃 0.55 秒 |
| **浇水特效** | `fx.kind=water` → 游戏原素材：植株上方落下的水滴（`water_pour_1..4`）+ 地面溅起的水花（`water_burst_1..6`） |
| **滴水** | 土湿 ≥ 90% 的植株会循环播游戏里的「滴水动画」（按植株高度选 4 个阶段；21 帧一轮，轮间停 4.5 秒） |
| **枯萎** | `dead` 的植株换成 `sprite_crop_wither_universal`（残株），半透明 |
| **没有水条** | 不再在根部画 3px 水分条；湿不湿看滴水就行 |

## 2.5 动画（用游戏自己的资源）

**先说清楚一件事**：gu_sprites 里**没有**作物的逐帧动画（只有各阶段的静止帧）。
游戏里作物相关的动态效果是**粒子**——crop_shiny_01..60（60 个闪光/碎屑）和
浇水/滴水相关的一组 sprite（旧导出脚本已删除；当前文件待确认来源）。

| 动作 | 播什么 | 素材 |
|---|---|---|
| **播种** | 种子从 0.5 弹到 1.12 再回 1（260ms）+ 地面扬起 6 颗碎屑 | crop_shiny_* |
| **生长** | 换到下一帧（等级就是帧号）+ 弹一下；判定 = 等级变了 | — |
| **收割** | 植株中段 10 颗 + 根部 4 颗碎屑炸开（抛物线 + 淡出 460~760ms），随后产物落地 | crop_shiny_* |
| **浇水** | 植株上方 4 帧水滴落下（70ms/帧）+ 根部 6 帧水花溅起（80ms/帧） | water_pour_1..4 / water_burst_1..6 |
| **浇透滴水** | 21 帧滴水循环（80ms/帧），一轮 1.68 秒，停 4.5 秒再来；按植株高度选阶段 1~4 | water_drip1..4_00..20 |
| **捡东西** | 产物划弧线飞到桌宠位置，边飞边缩小 | icon_item_* |
| **桌宠走过** | 4.5% 内的作物绕根部摆 0.55 秒 | — |

动画是 30fps 的 `DispatcherTimer`（`Update-Anim`），按时间算位置，不做 WPF Storyboard——
因为要跟实时状态（桌宠位置、新掉落物）联动。粒子和水花都是普通 Image，由同一个循环推进。

> 时间参数（260ms 弹动、70/80ms 一帧、滴水间隔）是按观感调的：游戏里的动画曲线在客户端脚本里，
> 这几个包里没有，取不到权威值。滴水动画的 4 个阶段对应植株从矮到高（7/13/25/31px）。

## 3. 状态契约（world 每 5 秒 / 每次动作后写）

```json
{
  "day": 2, "clock": "09:12", "coins": 340, "weather": "晴",
  "current": 2, "currentAt": 0.62,
  "inventory": { "total": 3, "items": { "tomato": 2 } },
  "drops": [ { "id": 101, "item": "tomato", "crop": "tomato", "x": 0.42, "count": 1 } ],
  "fx": [ { "id": 7, "kind": "collect", "x": 0.78, "toX": 0.62, "item": "pumpkin" } ],
  "plots": [
    { "id": 1, "crop": "tomato", "name": "番茄", "prefix": "sprite_seed_tomato",
      "frame": 5, "level": 5, "levels": 6, "x": 0.18, "water": 0.62,
      "ready": true, "dead": false, "progress": 100 }
  ]
}
```

- `plots[].prefix/frame` 直接决定用哪张贴图（frame 就是等级），图层不再自己维护作物表
- `fx` 是一次性特效（`water` / `harvest` / `collect`），图层按 `id` 去重、只播一次
- `drops` 消失 = 被捡走了（配合 `fx.collect` 播吸附动画）

## 4. 常用命令

```powershell
cd <Pet>\overlay          # 从本文件所在目录跑，别写死绝对路径
Set-ExecutionPolicy -Scope Process Bypass -Force

.\restart-layers.ps1             # 确保两层在跑（幂等；健康的进程绝不动）
.\restart-layers.ps1 -Restart    # 先停再起（改完代码用这个）
.\restart-layers.ps1 -Check      # 0 = 两层都在 + 野草层在桌宠之上
.\restart-layers.ps1 -Stop       # 全停
.\verify-overlay.ps1             # 置顶/桌宠在上/点击穿透/不抢焦点（验的是背景层）
.\tools\test-placement.ps1       # 位置换算 15 项
.\tools\test-layers.ps1          # 图层生命周期回归 18 项（自愈 / 桌宠隐藏显示 / 桌宠消失恢复 / 无黑窗）

# 想验证动画：手动定点截几张（毫秒）
.\restart-layers.ps1 -Stop        # 先停线上图层，否则单实例保护会拒绝
# 看浇水 / 滴水（4 棵：3 棵浇透、1 棵半干；带一个 water 特效）
.\overlay.ps1 -NoWeeds -Seconds 2 -StatePath .\tools\demo-water.json -Shots 120,450,900,1500 -LogPath .\runtime\demo.log -PlayFxHistory
.\restart-layers.ps1              # 看完把线上图层拉回来
```

历次入口（`start-layers.ps1` / `start-overlay.ps1` / `start-weeds-layer.ps1` /
`stop-layers.ps1` / `stop-overlay.ps1`）现在都只是 `restart-layers.ps1` 的转发壳，
保留它们只为不弄坏旧文档和旧快捷方式。

## 4.5 图层是怎么被拉起来的（v5，2026-10-26 重写）

**一句话：只有一个守护进程管生命周期，其他所有地方只喊「确保在跑」。**

```
restart-layers.ps1 -Ensure        ← World 启动 / 手动，都调这个
        │
        ├─ 已经在跑？→ 只看一眼窗口在不在，然后退出（不杀、不重启）
        └─ 没在跑  ？→ 用 CREATE_NO_WINDOW 起 restart-layers.ps1 -Supervise（隐藏）
                              │
                              ├─ 每 1.5 秒看两块窗口：bg 在不在、weeds 在不在
                              ├─ 缺哪块只补哪块，健康的绝不碰（退避：5s/10s/…最多 60s）
                              └─ 把 pid 写进 runtime\bg.pid / runtime\weeds.pid
```

| 文件 | 作用 |
|---|---|
| `runtime\layers.log` | 守护自己的日志（拉起/失败/退避） |
| `runtime\bg.log` / `weeds.log` | 两块图层各自的日志 |
| `runtime\supervisor.json` | 守护 pid + 启动时间（ensure 用它判断） |
| `runtime\bg.pid` / `weeds.pid` | 每块自己的 pid（以前两块共用一个 `overlay.pid`，后起的覆盖先起的 → 清理时杀错） |

旧版背景层「35 秒 / 两分钟后无声消失」的根因：World 里有个 90 秒巡检
（`巡检发现野草层不在`），发现 `weeds.pid` 不在就**把整组图层杀掉重起**；而旧
`Kill-Overlays` 按 pid 文件杀，`overlay.pid` 又被后起的野草层覆盖，于是健康的背景层
被误杀。日志停在 `snapshot ->`，没有 `closed`，因为进程是被外部 `Stop-Process` 掉的。
现在 World 只在启动时 `-Ensure`，巡检已删除；图层缺了自己会补。

### 跟着桌宠走（v5.1）

图层不是常驻程序，是桌宠的挂件：

| 桌宠 | 图层 |
|---|---|
| 看得见 | 两层的窗口显示，野草在桌宠上面，背景在它下面 |
| 右键「隐藏」/ 托盘 hide（`win.hide()`，窗口还在） | **1 秒内一起隐藏**（进程保留，回来是瞬间的） |
| 托盘「关闭」/ 窗口没了（App 还活着） | 4~5 秒后**停掉两块图层进程**；守护继续等，窗口再开就自动拉起来 |
| App 退出 / 禁用「自定义农场」World | `world.js` 的 `stop()` 直接 `restart-layers.ps1 -Stop`，约 1~2 秒内全停 |
| App 崩溃（没走 stop） | 桌宠窗口消失 → 图层 4~5 秒内停；`state.json` 30 秒不再更新 → 守护退出 |

实现：`overlay.ps1` 每秒查一次桌宠窗口（`PetWindowState`：没了 / 被隐藏 / 看得见），
用 WPF `Hide()` / `Show()` 跟随；守护用窗口存在 + `state.json` 的修改时间判断
"桌宠没了"和"App 没了"，**电脑睡眠时 `state.json` 也会停，但桌宠窗口还在，不会误收**。

**没有 PowerShell 黑窗**：

- 守护拉起子进程用 Win32 `CreateProcess` + `CREATE_NO_WINDOW` + 只继承 NUL 句柄
  （不是 `Start-Process`）。控制台窗口对象根本不存在，也没有句柄泄漏
  （句柄泄漏会让「捕获 restart-layers.ps1 输出」的脚本永远等不到 EOF）。
- 不再放"登录自启"快捷方式：没有桌宠时图层会自己退，那个快捷方式只会闪一下。
  老版本放过的 `.lnk` / `layers-hidden.vbs` 会在安装或 World 启动时清掉。
- World 里所有 `spawn('powershell.exe', ...)` 都带 `windowsHide: true`。
- 右键菜单「背包」补丁以前用 `detached: true`（= DETACHED_PROCESS，PS 5.1 起不来还会闪窗），
  已改成 `{ stdio: 'ignore', windowsHide: true }`；`petmenu.js` 每次 World 启动会就地修好旧补丁。

**日志不再刷屏**：旧版每次 `state.json` 变化（每 5 秒）都重写一张 26 KB PNG，
一天白写几百 MB。现在快照默认关闭，只有 `-Snapshot` / `-Shots` 才写；
每次启动仍会写一张 `runtime\overlay-snapshot-bg.png` 供 `verify-overlay.ps1` 用。

`tools\demo-water.json` 是一份手写的演示状态（4 棵、浇水/滴水特效），只给上面的调试命令用，不影响线上。

## 5. 断言（verify-overlay.ps1）

置顶 / 桌宠在上 / 点击穿透 / 不进任务栏 / 不抢焦点，8 项全 PASS。
现在验证的是**背景层**（`runtime\bg.pid`）——野草层按设计就在桌宠上面。
快照用窗口自渲染的 `RenderTargetBitmap`（截屏在这台机器是全黑的）。

## 5.5 改完 .ps1 一定要修 BOM

PowerShell 5.1 读 `.ps1`：有 UTF-8 BOM 按 UTF-8，**没有就按系统 ANSI（GBK）**。
本仓库所有脚本都含中文，丢了 BOM 会解析失败、进程在写第一行日志之前就静默退出
（表现又是「图层不见了」，而且日志里什么都没有）。很多编辑器/工具每次保存都会
把 BOM 抹掉，所以改完脚本跑一下：

```powershell
.\tools\fix-encoding.ps1
```

它会补齐 BOM，并用和 `-File` 相同的方式（ANSI 解码 + 语法解析）逐文件验证。
`restart-layers.ps1` 每次 ensure 前也会做同样的预检，失败会写进 `layers.log` 并打印原因。

## 6. 坑（这一轮新踩的）

0a. **`$pid` 是只读自动变量**（`$PID`）！写 `$pid = [int]$p.id` 直接抛
   SessionStateUnauthorizedAccessException，而且是在渲染回调里抛，表现为"窗口起来了但什么都没有"。
   同一个大小写不敏感的坑，这已经是第四次（$leaf/$LEAF、$shots/$Shots、$pid/$PID）。
0. **删代码块别只删到下一个注释**：删作物名字那块时顺手吃掉了 `foreach` 的收尾 `}`，
   报错指向第 57 行（离现场 300 行远）。删完先数括号。
1. **`$shots` 和 `$Shots` 是同一个变量**（PS 大小写不敏感），初始化时把入参清空了 —— 第二次踩这个坑。
2. **BOM 会掉**：用 node 改写 .ps1 后如果 BOM 丢了，PS 5.1 按 ANSI 读，中文注释直接变语法错误。
   写回时统一 `"\uFEFF" + text`。
3. **贴图不一定有 `_0` 后缀**：`sprite_crop_wither_universal.png` 就没有，`Get-Sprite` 要退一级再找。
4. DispatcherTimer 回调里别用 `GetNewClosure()` 里再引用同一个 timer 变量（拿到的是 null）；
   要么用 `param($sender,$e)`，要么干脆把逻辑放进主循环。
