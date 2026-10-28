<#
  桌面农场图层（v4）

  作物种在任务栏上沿的一条全宽透明条带上。这一版加了：
    - 统一缩放（所有作物同一个倍率，相对大小跟贴图像素一致，不随进度放大）
    - 掉落物：收割后掉在地上、弹一下，桌宠走过来收 → 被吸到它身上
    - 摇晃：桌宠走近时旁边那棵会晃（实时读桌宠位置（端口从 companion config 读取）的 startX）
    - 浇水特效 / 枯萎表现
    - 收割的作物不再发光

  启动    由 .\restart-layers.ps1 统一拉起（单守护；别直接手跑这个文件）
  停止    .\restart-layers.ps1 -Stop
  自检    .\restart-layers.ps1 -Check / .\verify-overlay.ps1
#>
param(
    [switch]$Clickable,
    [switch]$NoAnchor,
    [string]$StatePath = '',
    [int]$Seconds = 0,
    [string]$LogPath = '',
    [string]$AssetsDir = '',
    [int]$StripHeight = 220,
    [double]$Zoom = 2,
    [string]$PetApi = '',
    # 在启动后第 N 毫秒各存一张快照（验证动画用）：-Shots 350,900
    [double[]]$Shots = @(),
    # 草地地表：素材是一整条长地板，整条横向拉伸铺满（不切块、不重复）
    # 掉落物和作物同一个像素倍率；想让它比图标原生尺寸小一点就调这个（0.6 = 六折）
    [double]$DropScale = 1.0,
    [string]$GroundTile = 'popo20230114_gd_grass_0',
    [int]$GroundRows = 32,
    # 草皮整体往下沉多少像素：下半截被窗口裁掉，只剩上面一小条绿露在任务栏上方
    [int]$GroundSink = 9,
    # 作物/野草相对地面线再下沉几像素（贴图底部有透明边）
    [int]$CropSink = 3,
    # 前景层：只画上层野草 / 上层装饰（叠在桌宠上面）
    [switch]$WeedsOnly,
    # 背景层：只画下层野草（上层野草交给前景层）
    [switch]$NoWeeds,
    # 【已废弃】旧版背景层用它在内部拉起野草层；现在统一由 restart-layers.ps1 守护。
    # 保留这个参数只是为了不让还没重启的旧 World 传参时报错退出。
    [switch]$SpawnWeedsLayer,
    # 自检：让所有野草持续大幅摇晃，用来确认渲染链路
    [switch]$DebugWobble,
    # 每帧渲染后写 PNG 快照（默认关闭：以前每次 state 刷新都写一张，白写磁盘还刷日志）
    [switch]$Snapshot,
    # 演示/测试：重放 state.fx 里的历史特效（正常运行时默认不回放，避免旧位置冒发光图标）
    [switch]$PlayFxHistory
)

$ErrorActionPreference = 'Stop'

# 桌宠 API 端口不写死：优先 -PetApi / PET_API，其次从 Coopanion 的 companion config 读
# worlds.desktop-pet.port，最后才回退 7797。便携版可用 COOPANION_CONFIG 指定 config.json。
function Resolve-PetApi([string]$explicit) {
    if ($explicit) { return $explicit }
    if ($env:PET_API) { return [string]$env:PET_API }
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:COOPANION_CONFIG) { $candidates.Add([string]$env:COOPANION_CONFIG) }
    if ($env:COOPANION_DATA) { $candidates.Add((Join-Path $env:COOPANION_DATA 'home\companion\config.json')) }
    if ($env:LOCALAPPDATA) { $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\Coopanion\data\home\companion\config.json')) }
    if ($env:APPDATA) { $candidates.Add((Join-Path $env:APPDATA 'Coopanion\data\home\companion\config.json')) }
    foreach ($file in $candidates) {
        try {
            if (-not (Test-Path -LiteralPath $file)) { continue }
            $cfg = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
            $port = [int]$cfg.worlds.'desktop-pet'.port
            if ($port -gt 0) { return ('http://127.0.0.1:' + $port + '/api/state') }
        } catch { }
    }
    return 'http://127.0.0.1:7797/api/state'
}
$PetApi = Resolve-PetApi $PetApi

# 每块图层写自己的 pid 文件：bg.pid / weeds.pid。
# （旧版两块都写 overlay.pid，后起的把先起的覆盖掉 → 清理脚本会杀错进程。）
$script:kind = $(if ($WeedsOnly) { 'weeds' } else { 'bg' })
$script:selfPidFile = Join-Path $PSScriptRoot ('runtime\' + $script:kind + '.pid')

$script:rt = Join-Path $PSScriptRoot 'runtime'
try {
    New-Item -ItemType Directory -Force -Path $script:rt -ErrorAction Stop | Out-Null
    $probe = Join-Path $script:rt '.w'
    Set-Content -LiteralPath $probe -Value 'x' -ErrorAction Stop
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
} catch {
    $script:rt = Join-Path $env:TEMP 'farm-overlay'
    New-Item -ItemType Directory -Force -Path $script:rt | Out-Null
}
if (-not $LogPath) { $LogPath = Join-Path $script:rt ($script:kind + '.log') }
$script:LogPath = $LogPath
try {
    if ((Test-Path -LiteralPath $LogPath) -and (Get-Item -LiteralPath $LogPath).Length -gt 4MB) {
        Move-Item -LiteralPath $LogPath -Destination ($LogPath + '.old') -Force
    }
} catch { }

function Log([string]$m) {
    try {
        Add-Content -LiteralPath $script:LogPath -Encoding utf8 -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff') + ' [' + $PID + '] ' + $m)
    } catch { }
}

# 单实例保护：同一种图层（背景 / 野草前景）已经有一个在跑就不再开第二个。
# 先看自己的 pid 文件（快、准确），再用命令行兜底。
try {
    if (Test-Path -LiteralPath $script:selfPidFile) {
        $old = Get-Content -LiteralPath $script:selfPidFile -Raw -ErrorAction SilentlyContinue
        if ($null -ne $old) {
            $old = ([string]$old).Trim()
            if ($old -match '^\d+$' -and [int]$old -ne $PID) {
                if (Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue) {
                    Log ('同类图层已在跑 pid=' + $old + '，本进程退出')
                    exit 0
                }
            }
        }
    }
} catch { }
$myKind = $(if ($WeedsOnly) { '-WeedsOnly' } else { '-NoWeeds' })
try {
    $dup = @()
    foreach ($pr in (Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue)) {
        $cmd = [string]$pr.CommandLine
        if ($pr.ProcessId -eq $PID) { continue }
        if ($cmd -eq '') { continue }
        if ($cmd -notlike '*-File*') { continue }
        if ($cmd -like '*-Command*') { continue }
        if ($cmd -notlike '*overlay.ps1*') { continue }
        if ($cmd -notlike ('*' + $myKind + '*')) { continue }
        $dup += $pr
    }
    if ($dup.Count -gt 0) { exit 0 }
} catch { }

# 立刻登记自己，守护进程据此判断"这块已经起来了"
try { Set-Content -LiteralPath $script:selfPidFile -Value $PID -Encoding ascii -ErrorAction Stop } catch { }

. (Join-Path $PSScriptRoot 'placement.ps1')
Log ('shots param count=' + $Shots.Count)
Log ('=== start v5 (' + $script:kind + ') === ps=' + $PSVersionTable.PSVersion + ' state=' + $StatePath + ' zoom=' + $Zoom)

try {

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
try { Add-Type -AssemblyName System.Xaml } catch { }
Log 'assemblies ok'

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

public static class FarmWin32 {
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    public const int GWLP_HWNDPARENT = -8;
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);

    /// <summary>桌宠窗口中心在屏幕上的 x 比例（0~1）；失败返回 -1。</summary>
    public static double PetXFromWindow(double screenWidth) {
        IntPtr h = FindPetWindow();
        if (h == IntPtr.Zero || screenWidth <= 0) return -1;
        RECT r;
        if (!GetWindowRect(h, out r)) return -1;
        double cx = (r.Left + r.Right) / 2.0;
        double f = cx / screenWidth;
        return f < 0 ? 0 : (f > 1 ? 1 : f);
    }
    [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA {
        public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge;
        public RECT rc; public IntPtr lParam;
    }
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
    public const uint ABM_GETTASKBARPOS = 5;

    public static int[] Taskbar() {
        APPBARDATA d = new APPBARDATA();
        d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
        UIntPtr ok = SHAppBarMessage(ABM_GETTASKBARPOS, ref d);
        if (ok == UIntPtr.Zero) return new int[] { -1, 0, 0, 0, 0 };
        return new int[] { (int)d.uEdge, d.rc.Left, d.rc.Top, d.rc.Right, d.rc.Bottom };
    }

    public const int GWL_EXSTYLE      = -20;
    public const int WS_EX_TRANSPARENT = 0x00000020;
    public const int WS_EX_LAYERED     = 0x00080000;
    public const int WS_EX_TOOLWINDOW  = 0x00000080;
    public const int WS_EX_NOACTIVATE  = 0x08000000;
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_NOZORDER = 0x0004;

    /// <summary>
    /// 找桌宠窗口。visibleOnly=true 只找看得见的；false 连被 hide() 藏起来的窗口也找
    /// （用来区分"桌宠藏起来了"和"桌宠真的没了"）。
    /// </summary>
    public static IntPtr FindPetWindowAny(bool visibleOnly) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            if (visibleOnly && !IsWindowVisible(h)) return true;
            StringBuilder sb = new StringBuilder(512);
            GetWindowTextW(h, sb, 512);
            if (sb.ToString().IndexOf("桌宠") < 0) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            try {
                if (System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.StartsWith("Coopanion")) {
                    found = h; return false;
                }
            } catch { }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static IntPtr FindPetWindow() { return FindPetWindowAny(true); }

    /// <summary>桌宠窗口状态：0=没有窗口，1=有但被藏起来，2=看得见。</summary>
    public static int PetWindowState() {
        IntPtr h = FindPetWindowAny(false);
        if (h == IntPtr.Zero) return 0;
        return IsWindowVisible(h) ? 2 : 1;
    }
}

/// <summary>后台线程轮询桌宠位置（config 端口 /api/state 的 startX），UI 线程只读。</summary>
public static class FarmPetWatch {
    public static volatile bool Enabled = false;
    public static volatile float PetX = -1f;      // 0~1，-1 = 不知道
    public static volatile bool Ok = false;

    /// <summary>从 JSON 文本里抠一个数字字段（不想为一行状态引 JSON 库）。</summary>
    private static bool TryNum(string body, string key, out double v) {
        v = 0;
        int i = body.IndexOf("\"" + key + "\"");
        if (i < 0) return false;
        int c = body.IndexOf(':', i);
        if (c < 0) return false;
        int end = body.IndexOfAny(new char[] { ',', '}' }, c + 1);
        if (end < 0) return false;
        string num = body.Substring(c + 1, end - c - 1).Trim();
        return double.TryParse(num, System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out v);
    }

    private static Thread _t;
    private static string _url = "";
    private static int _ms = 400;

    public static void Start(string url, int intervalMs) {
        _url = url; _ms = intervalMs; Enabled = true;
        if (_t != null) return;
        _t = new Thread(Loop);
        _t.IsBackground = true;
        _t.Start();
    }
    public static void Stop() { Enabled = false; }

    private static void Loop() {
        while (true) {
            if (Enabled && _url.Length > 0) {
                try {
                    var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(_url);
                    req.Timeout = 1500;
                    req.ReadWriteTimeout = 1500;
                    req.Method = "GET";
                    using (var resp = (System.Net.HttpWebResponse)req.GetResponse())
                    using (var sr = new System.IO.StreamReader(resp.GetResponseStream())) {
                        string body = sr.ReadToEnd();
                        double v;
                        if (TryNum(body, "startX", out v)) { PetX = (float)v; Ok = true; }
                    }
                } catch {
                    Ok = false;
                }
            }
            Thread.Sleep(_ms);
        }
    }
}
"@
Log 'win32 + petwatch ok'

# ---------- 素材 ----------
if (-not $AssetsDir) { $AssetsDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'assets\sprites' }
$script:spriteCache = @{}
$script:assetsOk = (Test-Path -LiteralPath $AssetsDir)
Log ('assets ' + $AssetsDir + ' exists=' + $script:assetsOk)

# 游戏里的作物没有逐帧动画，用的是粒子：crop_shiny_01..60 是闪光碎屑。
# 浇水相关素材：
#   water_pour_1..4   浇水时从上方落下的水滴（游戏「浇水特效2」）
#   water_burst_1..6  落地溅起的水花（游戏「溅起水花」）
#   water_drip<1..4>_<00..20>  浇透的植株滴水（游戏「滴水动画」，按植株高度分 4 个阶段）
$script:shinyNames = @()
$i = 1
while ($i -le 60) {
    $n = 'crop_shiny_' + $i.ToString('00')
    if (Test-Path -LiteralPath (Join-Path $AssetsDir ($n + '.png'))) { $script:shinyNames += $n }
    $i++
}
$script:pourNames = @()
foreach ($i in 1..4) {
    $n = 'water_pour_' + $i
    if (Test-Path -LiteralPath (Join-Path $AssetsDir ($n + '.png'))) { $script:pourNames += $n }
}
$script:burstNames = @()
foreach ($i in 1..6) {
    $n = 'water_burst_' + $i
    if (Test-Path -LiteralPath (Join-Path $AssetsDir ($n + '.png'))) { $script:burstNames += $n }
}

function Get-ImageFile([string]$name) {
    if (-not $script:assetsOk -or -not $name) { return $null }
    $file = Join-Path $AssetsDir ($name + '.png')
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    if ($script:spriteCache.ContainsKey($file)) { return $script:spriteCache[$file] }
    try {
        $bmp = [System.Windows.Media.Imaging.BitmapImage]::new()
        $bmp.BeginInit()
        $bmp.UriSource = [Uri]::new($file)
        $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bmp.EndInit()
        $bmp.Freeze()
        $script:spriteCache[$file] = $bmp
        return $bmp
    } catch {
        Log ('image load failed: ' + $file + ' :: ' + $_.Exception.Message)
        return $null
    }
}

function Get-Sprite([string]$prefix, [int]$frame) {
    if (-not $script:assetsOk -or -not $prefix) { return $null }
    $file = Join-Path $AssetsDir ($prefix + '_' + $frame + '.png')
    if (-not (Test-Path -LiteralPath $file)) {
        # 有些贴图没有 _0 后缀（比如枯萎的残株）
        $plain = Join-Path $AssetsDir ($prefix + '.png')
        if (Test-Path -LiteralPath $plain) { $file = $plain }
    }
    if (-not (Test-Path -LiteralPath $file)) {
        # 帧数不够时退回最后一张
        $alt = Get-ChildItem -LiteralPath $AssetsDir -Filter ($prefix + '_*.png') -ErrorAction SilentlyContinue |
            Sort-Object Name | Select-Object -Last 1
        if (-not $alt) { return $null }
        $file = $alt.FullName
    }
    if ($script:spriteCache.ContainsKey($file)) { return $script:spriteCache[$file] }
    try {
        $bmp = [System.Windows.Media.Imaging.BitmapImage]::new()
        $bmp.BeginInit()
        $bmp.UriSource = [Uri]::new($file)
        $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bmp.EndInit()
        $bmp.Freeze()
        $script:spriteCache[$file] = $bmp
        return $bmp
    } catch {
        Log ('sprite load failed: ' + $file + ' :: ' + $_.Exception.Message)
        return $null
    }
}

$WITHER = 'sprite_crop_wither_universal'

# ---------- 状态 ----------
$demo = [pscustomobject]@{
    day = 3; clock = '06:40'; coins = 128; weather = '晴'; current = $null; currentAt = $null
    inventory = [pscustomobject]@{ total = 0; items = [pscustomobject]@{} }
    drops = @()
    fx = @()
    plots = @(
        [pscustomobject]@{ id = 1; crop = 'tomato'; name = '番茄'; prefix = 'sprite_seed_tomato'; frame = 4; level = 4; levels = 6; x = 0.12; water = 0.7; ready = $false; dead = $false; progress = 62 },
        [pscustomobject]@{ id = 2; crop = 'pumpkin'; name = '南瓜'; prefix = 'sprite_seed_pumpkin'; frame = 6; level = 6; levels = 7; x = 0.34; water = 0.4; ready = $true; dead = $false; progress = 100 },
        [pscustomobject]@{ id = 3; crop = 'corn'; name = '玉米'; prefix = 'sprite_seed_corn'; frame = 2; level = 2; levels = 6; x = 0.58; water = 0.9; ready = $false; dead = $false; progress = 25 }
    )
}
$script:state = $demo
if ($StatePath -and (Test-Path -LiteralPath $StatePath)) {
    try {
        $script:state = Get-Content -LiteralPath $StatePath -Raw -Encoding utf8 | ConvertFrom-Json
        Log ('state loaded: ' + $StatePath)
    } catch {
        Log ('state load failed, fallback demo: ' + $_.Exception.Message)
        $script:state = $demo
    }
} else { Log 'using demo state' }

function C([string]$hex) { return [System.Windows.Media.ColorConverter]::ConvertFromString($hex) }
function B([string]$hex) { return [System.Windows.Media.SolidColorBrush]::new((C $hex)) }
$FONT = 'Microsoft YaHei UI'

# ---------- 窗口 ----------
$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="FarmOverlay" Width="1200" Height="260"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ResizeMode="NoResize"
        ShowActivated="False" WindowStartupLocation="Manual" SnapsToDevicePixels="True">
  <Grid x:Name="Scene" Background="Transparent">
    <Canvas x:Name="Farm" ClipToBounds="False"/>
  </Grid>
</Window>
"@
$win = [Windows.Markup.XamlReader]::Parse($xaml)
$canvas = $win.FindName('Farm')
Log 'xaml parsed'

$script:sceneW = 1200
$script:sceneH = $StripHeight
if ($null -ne $script:state.stripHeight) {
    $script:sceneH = [Math]::Min(800, [Math]::Max(120, [int]$script:state.stripHeight))
}
$script:plants = @{}     # plotId -> @{ img; x; wobbleUntil; baseTransform }
$script:drops = @{}      # dropId -> @{ img; x; born; takenUntil }
$script:drips = @{}      # plotId -> @{ img; stage; idx; at; per; pauseUntil; wet }
$script:fxItems = @()    # 临时特效
$script:playedFx = @{}
$script:skipFxHistory = -not $PlayFxHistory   # 正常运行跳过历史 fx；演示用 -PlayFxHistory
$script:lastPetX = -1.0

function Add-El([object]$el, [double]$x, [double]$y) {
    [System.Windows.Controls.Canvas]::SetLeft($el, $x)
    [System.Windows.Controls.Canvas]::SetTop($el, $y)
    [void]$canvas.Children.Add($el)
}

# 从屏幕直接找桌宠的 x（API 的 startX 只记拖动位置，漫游时不变）
$script:petScreenCache = @{ x = -1; at = 0 }

# 只截 3 条单像素高的横线（地表上方 45/70/95px），用 LockBits 直接读字节。
# 比整块截图 + GetPixel 便宜两个数量级；300ms 一次足够跟上桌宠的移动。
function Get-PetXFromScreen([int]$groundY, [int]$screenW) {
    $now = (Get-Date).Ticks
    if ($script:petScreenCache.x -ge 0 -and ($now - $script:petScreenCache.at) -lt 2500000) {
        return $script:petScreenCache.x
    }
    try {
        $w = [int]$screenW
        $sum = 0.0; $cnt = 0
        foreach ($dy in 45, 70, 95) {
            $y = $groundY - $dy
            if ($y -lt 0) { continue }
            $bmp = [System.Drawing.Bitmap]::new($w, 1)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.CopyFromScreen(0, $y, 0, 0, [System.Drawing.Size]::new($w, 1))
            $g.Dispose()
            $rect = [System.Drawing.Rectangle]::new(0, 0, $w, 1)
            $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $bytes = New-Object byte[] ($data.Stride)
            [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
            $bmp.UnlockBits($data)
            $bmp.Dispose()
            for ($i = 0; $i -lt $bytes.Length - 3; $i += 8) {
                $b = $bytes[$i]; $gg = $bytes[$i + 1]; $r = $bytes[$i + 2]
                if (($b -gt ($r + 35)) -and ($b -gt 90) -and ($b -lt 245)) { $sum += ($i / 4); $cnt++ }
            }
        }
        if ($cnt -lt 15) { $script:petScreenCache = @{ x = -1; at = $now }; return -1 }
        $fx = ($sum / $cnt) / $w
        $script:petScreenCache = @{ x = $fx; at = $now }
        return $fx
    } catch {
        $script:petScreenCache = @{ x = -1; at = (Get-Date).Ticks }
        return -1
    }
}

function New-Shadow([string]$color, [double]$blur, [double]$opacity) {
    $fx = [System.Windows.Media.Effects.DropShadowEffect]::new()
    $fx.BlurRadius = $blur; $fx.ShadowDepth = 0; $fx.Opacity = $opacity; $fx.Color = (C $color)
    return $fx
}

function New-Image([object]$sprite, [double]$x, [double]$y, [double]$w, [double]$h) {
    $img = [System.Windows.Controls.Image]::new()
    $img.Source = $sprite
    $img.Width = $w; $img.Height = $h
    $img.Stretch = 'Uniform'
    [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($img, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
    Add-El $img $x $y
    return $img
}

# ---------- 粒子 / 水花 ----------
$script:smokeNames = @()
foreach ($i in 0..5) {
    $n = 'smoke_ps_02_' + $i
    if (Test-Path -LiteralPath (Join-Path $AssetsDir ($n + '.png'))) { $script:smokeNames += $n }
}

function Start-Smoke([double]$x) {
    if ($script:smokeNames.Count -eq 0) { return }
    $sp = Get-ImageFile $script:smokeNames[$script:smokeNames.Count - 1]
    if (-not $sp) { return }
    $w = [Math]::Round(26 * $Zoom)
    $img = New-Image $sp ($x * $script:sceneW - $w / 2) ($script:sceneH - $script:visibleGrass - $w) $w $w
    [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($img, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
    $script:splashes += @{ img = $img; frames = $script:smokeNames; idx = -1; born = (Get-Date).Ticks; per = 70 }
}
$script:particles = @()
$script:petGoneCount = 0
$script:ownedBy = [IntPtr]::Zero
$script:sawPet = $false
$script:peakAngle = 0.0
$script:wobbleUntil = @{}    # plotId/weaponId -> 摇晃结束时刻（跨场景重建保留）
$script:wobbleAmp = @{}      # plotId -> 摇晃幅度
$script:petNearIds = @{}     # 上一帧哪些作物在桌宠旁边（只在"进入"那一刻触发摇晃）
$script:splashes = @()
$script:popUntil = @{}
$script:plotLevels = @{}

function Spawn-Particles([double]$x, [double]$y, [int]$count, [double]$spread) {
    if ($script:shinyNames.Count -eq 0) { return }
    $k = 0
    while ($k -lt $count) {
        $name = $script:shinyNames[(Get-Random -Maximum $script:shinyNames.Count)]
        $sprite = Get-ImageFile $name
        if ($sprite) {
            $size = [Math]::Max(12, [Math]::Round($sprite.PixelWidth * $Zoom * 0.62))
            $img = New-Image $sprite 0 0 $size $size
            $img.Visibility = 'Hidden'
            $script:particles += @{
                img = $img
                x0 = $x; y0 = $y
                vx = [double](Get-Random -Minimum ([int](-100 * $spread)) -Maximum ([int](100 * $spread))) / 100.0
                vy = [double](Get-Random -Minimum -260 -Maximum -90) / 100.0
                born = (Get-Date).Ticks
                life = 460 + (Get-Random -Maximum 300)
                size = $size
            }
        }
        $k++
    }
}

# 浇水动画：从植株上方落下的水滴 + 地面溅起的水花（默认是游戏原素材，可在「农场自定义 → 农作物状态」换帧/改速）
function Start-WaterFx([double]$x, [int]$plotId, [double]$plantH) {
    $gx = $x * $script:sceneW
    $ground = $script:sceneH - $script:visibleGrass
    $pour = $script:pourNames
    $burst = $script:burstNames
    $pourMs = 70
    $burstMs = 80
    $wf = $script:state.waterFx
    if ($null -ne $wf) {
        if ($null -ne $wf.pour) { $pour = @($wf.pour) }
        if ($null -ne $wf.burst) { $burst = @($wf.burst) }
        if ($null -ne $wf.pourMs) { $pourMs = [Math]::Max(10, [int]$wf.pourMs) }
        if ($null -ne $wf.burstMs) { $burstMs = [Math]::Max(10, [int]$wf.burstMs) }
    }
    # 只认 assets 里真实存在的 PNG；自定义帧被删掉了就跳过
    $pour = @($pour | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $AssetsDir ([string]$_ + '.png'))) })
    $burst = @($burst | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $AssetsDir ([string]$_ + '.png'))) })
    if ($pour.Count -gt 0) {
        $sprite = Get-ImageFile $pour[0]
        if ($sprite) {
            $w = [Math]::Round($sprite.PixelWidth * $Zoom)
            $h = [Math]::Round($sprite.PixelHeight * $Zoom)
            # 水滴从植株上方落下：小苗贴着苗顶，大棵贴着树冠
            $rise = $(if ($plantH -gt 8) { $plantH } else { 34 })
            $top = $ground - $rise - $h + 6
            $img = New-Image $sprite ($gx - $w / 2) $top $w $h
            [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($img, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
            $script:splashes += @{ img = $img; frames = $pour; idx = 0; born = (Get-Date).Ticks; per = $pourMs }
        }
    }
    if ($burst.Count -gt 0) {
        $sprite = Get-ImageFile $burst[0]
        if ($sprite) {
            $w = [Math]::Round($sprite.PixelWidth * $Zoom)
            $h = [Math]::Round($sprite.PixelHeight * $Zoom)
            $img = New-Image $sprite ($gx - $w / 2) ($ground - $h + 2) $w $h
            [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($img, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
            $script:splashes += @{ img = $img; frames = $burst; idx = 0; born = (Get-Date).Ticks; per = $burstMs }
        }
    }
    # 刚浇过：立刻从头滴一轮
    if ($plotId -gt 0 -and $script:drips.ContainsKey($plotId)) {
        $d = $script:drips[$plotId]
        $d.at = (Get-Date).Ticks
        $d.idx = -1
        $d.pauseUntil = 0
    }
}

# ---------- 画一场 ----------
function Render-Scene {
    $canvas.Children.Clear()
    $script:plants = @{}
    $script:decorEls = @()
    $script:drops = @{}
    $script:fxItems = @(@())
    $script:dripSeen = @{}

    $W = $script:sceneW
    $H = $script:sceneH
    $z = $Zoom
    $farm = $script:state.farm
    $cropScale = $(if ($farm -and $null -ne $farm.cropScale) { [double]$farm.cropScale } else { 1.0 })
    $cropScale = [Math]::Min(1.0, [Math]::Max(0.2, $cropScale))
    $cropZoom = $(if ($farm -and $null -ne $farm.cropZoom) { [double]$farm.cropZoom } else { 1.0 })
    $cropZoom = [Math]::Min(2.5, [Math]::Max(0.3, $cropZoom))
    # 掉落物/收获物图标缩放；没有 World 设置时用启动参数兜底
    $script:dropScale = $(if ($null -ne $script:state.dropScale) { [double]$script:state.dropScale } else { [double]$DropScale })
    $script:dropScale = [Math]::Min(3.0, [Math]::Max(0.3, $script:dropScale))
    # 草地永远铺满整条底边；farmCells 只缩放 tile 和作物/野草，不发窄、不裁剪
    $grassX = 0
    $grassW = $W
    # 地面贴图由 World 写在 state.ground.tile（农场自定义页可换）；没有就用参数默认值。
    # 先读图再算高度：长条地板按自身高度铺，地面露出多少由 state.groundHeight 控制。
    $tileName = $GroundTile
    if ($script:state.ground -and $script:state.ground.tile) { $tileName = [string]$script:state.ground.tile }
    $tile = Get-ImageFile $tileName
    $groundRows = $(if ($tile) { [Math]::Min($GroundRows, $tile.PixelHeight) } else { $GroundRows })
    $grassH = [int]($groundRows * $z * $cropScale)
    $wantGround = $(if ($null -ne $script:state.groundHeight) { [double]$script:state.groundHeight } else { 10 })
    $wantGround = [Math]::Min($grassH, [Math]::Max(2, $wantGround))
    $script:visibleGrass = [int][Math]::Round($wantGround)
    $groundSinkPx = [Math]::Max(0, $grassH - $script:visibleGrass)
    $ground = $H - $script:visibleGrass

    # --- 草地地表：只在农田范围内，贴图也按 cropScale 缩放（不是裁剪） ---
    if ($tile -and $grassW -gt 0) {
        $crop = [System.Windows.Media.Imaging.CroppedBitmap]::new($tile, [System.Windows.Int32Rect]::new(0, 0, $tile.PixelWidth, $groundRows))
        $brush = [System.Windows.Media.ImageBrush]::new($crop)
        # 素材是一整条 96px 宽的长条地板：按原宽高比重复铺，屏幕多宽就贴几次，
        # 最后一列由窗口自然裁掉，不把整条横向拉伸。
        $brush.TileMode = [System.Windows.Media.TileMode]::Tile
        $brush.ViewportUnits = [System.Windows.Media.BrushMappingMode]::Absolute
        $tileW = [Math]::Max(1, $crop.PixelWidth * $z * $cropScale)
        $tileH = [Math]::Max(1, $crop.PixelHeight * $z * $cropScale)
        $brush.Viewport = [System.Windows.Rect]::new(0, 0, $tileW, $tileH)
        $brush.Stretch = [System.Windows.Media.Stretch]::Fill
        if (-not $WeedsOnly) {
        $grass = [System.Windows.Shapes.Rectangle]::new()
        $grass.Width = $grassW
        $grass.Height = $grassH
        $grass.Fill = $brush
        [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($grass, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
        Add-El $grass $grassX ($H - $grassH + $groundSinkPx)
        }
    }

    # --- 地面指示（桌宠站的位置）---
    # 2026-10-26：这条 40×3 的金色条带一圈黄色阴影，在深色任务栏/草地上看起来就是
    # "某块地板在发光"；而且 currentAt 可能停在旧位置（current 已经为 null），
    # 会变成一块没有理由的亮斑。桌宠本体就在那儿，不再画地面标记。
    # （原来的 $mark 代码已删）

    # --- 作物 ---
    # ---------- 野草（按每类杂草的图层：bottom 在背景层作物后，top 在 weeds 层） ----------
    $weedLayer = $(if ($WeedsOnly) { 'top' } elseif ($NoWeeds) { 'bottom' } else { '*' })
    if ($weedLayer -ne 'none') {
    foreach ($weed in @($script:state.weeds)) {
        if ($null -eq $weed) { continue }
        $wl = $(if ([string]$weed.layer -eq 'bottom') { 'bottom' } else { 'top' })
        if ($weedLayer -ne '*' -and $wl -ne $weedLayer) { continue }
        $isFlower = ([string]$weed.kind -eq 'flower')
        $maxLvl = $(if ($isFlower) { 5 } else { 3 })
        $lvl = [int]$weed.level
        if ($lvl -lt 0) { $lvl = 0 }
        if ($lvl -gt $maxLvl) { $lvl = $maxLvl }
        $spriteName = $(if ($isFlower) { 'sprite_seed_eden_flower_' + $lvl } else { 'sprite_resource_weeds_' + $lvl })
        $weedSprite = $null
        # 农场自定义：World 直接给出这丛草当前阶段的贴图名
        if ($weed.sprite) { $weedSprite = Get-ImageFile ([string]$weed.sprite) }
        if (-not $weedSprite) { $weedSprite = Get-ImageFile $spriteName }
        if (-not $weedSprite) { continue }
        $weedW = [Math]::Max(1, [Math]::Round($weedSprite.PixelWidth * $Zoom * $cropScale * $cropZoom))
        $weedH = [Math]::Max(1, [Math]::Round($weedSprite.PixelHeight * $Zoom * $cropScale * $cropZoom))
        $weedX = ([double]$weed.x) * $script:sceneW
        $weedImg = New-Image $weedSprite ($weedX - $weedW / 2) ($ground - $weedH + $CropSink) $weedW $weedH
        [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($weedImg, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
        $weedImg.Opacity = 0.95
        $weedPhase = (([int]$weed.id + 7) * 2.399963) % 6.2831853
        $weedAngle = [Math]::Sin((Get-Date).Ticks / 10000000.0 * 1.047 + $weedPhase) * 3.2
        $weedRot = [System.Windows.Media.RotateTransform]::new($weedAngle)
        $weedRot.CenterX = $weedW / 2
        $weedRot.CenterY = $weedH
        $weedImg.RenderTransform = $weedRot
        $weedTf = $weedRot
        $script:plants[1000 + [int]$weed.id] = @{
            img = $weedImg; rot = $weedRot; sc = [System.Windows.Media.ScaleTransform]::new(1.0, 1.0)
            x = [double]$weed.x; wobbleUntil = 0; amp = 0
            swing = $true
            phase = $weedPhase
            weed = $true
        }
    }

    }

    # ---------- 上层装饰：和杂草一样画在 weeds 层（在桌宠/作物上方） ----------
    if ($WeedsOnly) {
        foreach ($f in @($script:state.furniture)) {
            if ($null -eq $f -or [string]$f.layer -ne 'top') { continue }
            $spriteName = [string]$f.sprite
            if (-not $spriteName) { continue }
            $fSprite = Get-ImageFile $spriteName
            if (-not $fSprite) { continue }
            $fScale = $(if ($null -ne $f.scale) { [double]$f.scale } else { 1.0 })
            $fScale = [Math]::Min(3.0, [Math]::Max(0.3, $fScale))
            $fw = [Math]::Round($fSprite.PixelWidth * $Zoom * 1.4 * $fScale)
            $fh = [Math]::Round($fSprite.PixelHeight * $Zoom * 1.4 * $fScale)
            $fx = ([double]$f.x) * $W - $fw / 2
            $fImg = New-Image $fSprite $fx ($ground - $fh) $fw $fh
            [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($fImg, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
            $fImg.Effect = (New-Shadow '#66000000' 4 0.3)
            $fRot = [System.Windows.Media.RotateTransform]::new(0)
            $fRot.CenterX = $fw / 2; $fRot.CenterY = $fh
            $fSc = [System.Windows.Media.ScaleTransform]::new(1.0, 1.0)
            $fSc.CenterX = $fw / 2; $fSc.CenterY = $fh
            $fTf = [System.Windows.Media.TransformGroup]::new()
            [void]$fTf.Children.Add($fRot); [void]$fTf.Children.Add($fSc)
            $fImg.RenderTransform = $fTf
            $script:decorEls += @{ img = $fImg; rot = $fRot; sc = $fSc; phase = ($fx * 0.01) }
        }
        return
    }

    # ---------- 下层装饰（画在作物后面） ----------
    foreach ($f in @($script:state.furniture)) {
        if ($null -eq $f -or [string]$f.layer -eq 'top') { continue }
        $spriteName = [string]$f.sprite
        if (-not $spriteName) { continue }
        $fSprite = Get-ImageFile $spriteName
        if (-not $fSprite) { continue }
        $fScale = $(if ($null -ne $f.scale) { [double]$f.scale } else { 1.0 })
        $fScale = [Math]::Min(3.0, [Math]::Max(0.3, $fScale))
        $fw = [Math]::Round($fSprite.PixelWidth * $Zoom * 1.4 * $fScale)
        $fh = [Math]::Round($fSprite.PixelHeight * $Zoom * 1.4 * $fScale)
        $fx = ([double]$f.x) * $W - $fw / 2
        $fImg = New-Image $fSprite $fx ($ground - $fh) $fw $fh
        [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($fImg, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
        $fImg.Effect = (New-Shadow '#66000000' 4 0.3)
        $fRot = [System.Windows.Media.RotateTransform]::new(0)
        $fRot.CenterX = $fw / 2; $fRot.CenterY = $fh
        $fSc = [System.Windows.Media.ScaleTransform]::new(1.0, 1.0)
        $fSc.CenterX = $fw / 2; $fSc.CenterY = $fh
        $fTf = [System.Windows.Media.TransformGroup]::new()
        [void]$fTf.Children.Add($fRot); [void]$fTf.Children.Add($fSc)
        $fImg.RenderTransform = $fTf
        $script:decorEls += @{ img = $fImg; rot = $fRot; sc = $fSc; phase = ($fx * 0.01) }
    }

    foreach ($p in @($script:state.plots)) {
        $cx = ([double]$p.x) * $W
        $prefix = [string]$p.prefix
        $frame = 0
        if ($null -ne $p.frame) { $frame = [int]$p.frame }
        # 枯萎贴图可在「农场自定义 → 农作物状态」里换；状态里没写就用内置残株
        $witherName = $WITHER
        if ($script:state.wither) { $witherName = [string]$script:state.wither }
        if ([bool]$p.dead) { $prefix = $witherName; $frame = 0 }
        $sprite = $null
        if ([bool]$p.dead) {
            $sprite = Get-ImageFile $witherName
            if (-not $sprite) { $sprite = Get-Sprite $WITHER 0 }
        } elseif ($p.sprite) {
            $sprite = Get-ImageFile ([string]$p.sprite)
        }
        if (-not $sprite) { $sprite = Get-Sprite $prefix $frame }
        if (-not $sprite) { continue }

        $iw = [Math]::Max(1, [Math]::Round($sprite.PixelWidth * $z * $cropScale * $cropZoom))
        $ih = [Math]::Max(1, [Math]::Round($sprite.PixelHeight * $z * $cropScale * $cropZoom))

        # 影子
        $shadow = [System.Windows.Shapes.Ellipse]::new()
        $shadow.Width = [Math]::Max(12, $iw * 0.7); $shadow.Height = 5
        $shadow.Fill = B '#000000'; $shadow.Opacity = 0.28
        Add-El $shadow ($cx - $shadow.Width / 2) ($ground - 4)

        # 水分只用来决定要不要滴水（>=0.9 视为浇透）；不再画根部状态条
        $water = 0.0
        if ($null -ne $p.water) { $water = [double]$p.water }
        if ($water -gt 1) { $water = 1 }

        # 作物本体（统一缩放；不发光、不写字）
        $img = New-Image $sprite ($cx - $iw / 2) ($ground - $ih + $CropSink) $iw $ih
        $img.Effect = (New-Shadow '#FF000000' 5 0.4)
        if ([bool]$p.dead) { $img.Opacity = 0.75 }

        # 浇透的作物会滴水（游戏「滴水动画」按植株高度分 4 个阶段，锚点在底部中心）
        $plotIdForDrip = [int]$p.id
        if (-not [bool]$p.dead -and $water -ge 0.90) {
            $hPx = $sprite.PixelHeight
            $stage = 1
            if ($hPx -ge 12) { $stage = 2 }
            if ($hPx -ge 20) { $stage = 3 }
            if ($hPx -ge 28) { $stage = 4 }
            if (-not $script:drips.ContainsKey($plotIdForDrip)) {
                $script:drips[$plotIdForDrip] = @{ img = $null; stage = $stage; idx = 0; at = 0; per = 80.0; pauseUntil = 0 }
            }
            $d = $script:drips[$plotIdForDrip]
            $d.stage = $stage
            $script:dripSeen[$plotIdForDrip] = $true
            $nowT = (Get-Date).Ticks
            if ($d.at -eq 0) { $d.at = $nowT }
            $idx = 0
            if ($d.pauseUntil -le $nowT) {
                $idx = [int][Math]::Floor((($nowT - $d.at) / 10000.0) / $d.per)
                if ($idx -lt 0) { $idx = 0 }
                if ($idx -gt 20) { $idx = 0; $d.at = $nowT }   # 跨过一轮：重新开始
            }
            $d.idx = $idx
            $dsp = Get-ImageFile ('water_drip' + $stage + '_' + $idx.ToString('00'))
            if ($dsp) {
                $dw = [Math]::Round($dsp.PixelWidth * $Zoom)
                $dh = [Math]::Round($dsp.PixelHeight * $Zoom)
                # 从植株偏左/中/右的位置落下，几棵并排时不至于全在一条线上
                $off = ((($plotIdForDrip % 3) - 1) * $iw * 0.18)
                # 滴水从植株冠部往下滴，不再贴在根部地面
                $dripTop = $ground - $ih + $CropSink
                $d.img = New-Image $dsp ($cx + $off - $dw / 2) $dripTop $dw $dh
                $d.img.Opacity = 0.9
                if ($d.pauseUntil -gt $nowT) { $d.img.Visibility = 'Hidden' }
            }
        }

        $tf = [System.Windows.Media.TransformGroup]::new()
        # 相位由 id 固定；初始角度直接算出来，避免重建那一帧跳回 0°
        $startPhase = ([int]$p.id * 2.399963) % 6.2831853
        $startAngle = 0.0
        if ([bool]$p.swing) { $startAngle = [Math]::Sin((Get-Date).Ticks / 10000000.0 * 1.047 + $startPhase) * 3.2 }
        $rot = [System.Windows.Media.RotateTransform]::new($startAngle)
        $rot.CenterX = $iw / 2
        $rot.CenterY = $ih
        $tf.Children.Add($rot)
        $sc = [System.Windows.Media.ScaleTransform]::new(1.0, 1.0)
        $sc.CenterX = $iw / 2
        $sc.CenterY = $ih
        $tf.Children.Add($sc)
        $img.RenderTransform = $tf

        # 等级变了 = 长了一级：弹一下（游戏里也是换帧 + 轻微弹动）
        $plotId = [int]$p.id
        $lvl = [int]$p.level
        if ($script:plotLevels.ContainsKey($plotId)) {
            if ([int]$script:plotLevels[$plotId] -ne $lvl) { $script:popUntil[$plotId] = (Get-Date).Ticks + 2600000 }
        } else {
            $script:popUntil[$plotId] = (Get-Date).Ticks + 2600000   # 刚种下：从小弹出来
        }
        $script:plotLevels[$plotId] = $lvl

        $script:plants[$plotId] = @{
            img = $img; rot = $rot; sc = $sc; x = [double]$p.x
            wobbleUntil = 0; amp = 0
            tf = $tf
            swing = [bool]$p.swing
            # 相位由 id 固定（每 5 秒重建一次也不会跳相）
            phase = $startPhase
        }
    }

    # --- 掉落物 ---
    foreach ($d in @($script:state.drops)) {
        $dx = ([double]$d.x) * $W
        $iconPrefix = 'icon_item_' + [string]$d.crop
        $sprite = $null
        if ($d.sprite) { $sprite = Get-ImageFile ([string]$d.sprite) }
        if (-not $sprite) { $sprite = Get-Sprite $iconPrefix 0 }
        if (-not $sprite) { continue }
        $size = [Math]::Round($sprite.PixelWidth * $Zoom * $script:dropScale)
        $img = New-Image $sprite ($dx - $size / 2) ($ground - $size - 2) $size $size
        $img.Effect = (New-Shadow '#FF000000' 6 0.5)
        $fromX = [double]$d.x
        if ($null -ne $d.fromX) { $fromX = [double]$d.fromX }
        $script:drops[[int]$d.id] = @{
            img = $img; x = [double]$d.x; fromX = $fromX
            size = $size; born = (Get-Date).Ticks; ground = $ground
        }
        $img.Visibility = 'Hidden'   # 由动画器接管
    }

    # 已经不湿（或没了）的植株：丢掉滴水控制器（画布已经清空，图不用手动删）
    if (-not $WeedsOnly -and $script:drips.Count -gt 0) {
        foreach ($k in @($script:drips.Keys)) {
            if (-not $script:dripSeen.ContainsKey($k)) { $script:drips.Remove($k) }
        }
    }

    # （HUD 文字已按用户要求去掉）
}

# ---------- 动画 ----------
function Add-Fx([string]$kind, [double]$x, [double]$toX, [string]$prefix) {
    $now = (Get-Date).Ticks
    $item = @{ kind = $kind; x = $x; toX = $toX; start = $now; ms = 700; els = @() }
    if ($kind -eq 'collect') {
        $sprite = Get-Sprite $prefix 0
        if ($sprite) {
            $size = [Math]::Round($sprite.PixelWidth * $Zoom * $script:dropScale)
            $img = New-Image $sprite ($x * $script:sceneW - $size / 2) ($script:sceneH - $size - 2) $size $size
            $img.Effect = (New-Shadow '#66000000' 4 0.3)   # 只留淡淡的暗影，不要再给地面加黄光
            $item.els = @($img)
            $item.size = $size
        }
    } elseif ($kind -eq 'water') {
        $i = 0
        while ($i -lt 5) {
            $drop = [System.Windows.Shapes.Ellipse]::new()
            $drop.Width = 4; $drop.Height = 7
            $drop.Fill = B '#CC8FD0F0'
            $drop.Effect = (New-Shadow '#FF6FA8D8' 6 0.9)
            Add-El $drop ($x * $script:sceneW - 2 + ($i - 2) * 7) ($script:sceneH - 60)
            $item.els += $drop
            $i++
        }
    } elseif ($kind -eq 'harvest') {
        # 收割时作物晃一下
        foreach ($k in $script:plants.Keys) {
            $pl = $script:plants[$k]
            if ([Math]::Abs($pl.x - $x) -lt 0.02) { $script:wobbleUntil[$k] = $now + 7000000; $script:wobbleAmp[$k] = 9 }
        }
    }
    if ($item.els.Count -gt 0) { $script:fxItems += $item }
}

function Update-Anim {
    $now = (Get-Date).Ticks
    $W = $script:sceneW
    $H = $script:sceneH
    $ground = $script:sceneH - $script:visibleGrass
    $wx = $script:state.weatherFx
    $wMode = 'both'
    $wAmp = 3.2
    $dMode = 'both'
    $dAmp = 1.5
    $wSquash = 0.0
    $wSpeed = 1.0
    if ($null -ne $wx) {
        if ($null -ne $wx.cropMode) { $wMode = [string]$wx.cropMode } elseif ($null -ne $wx.mode) { $wMode = [string]$wx.mode }
        if ($null -ne $wx.cropAmp) { $wAmp = [double]$wx.cropAmp } elseif ($null -ne $wx.swayAmp) { $wAmp = [double]$wx.swayAmp }
        if ($null -ne $wx.decorMode) { $dMode = [string]$wx.decorMode }
        if ($null -ne $wx.decorAmp) { $dAmp = [double]$wx.decorAmp }
        if ($null -ne $wx.squash -and [string]$wx.id -eq 'egg') { $wSquash = [double]$wx.squash }
        if ($null -ne $wx.speed) { $wSpeed = [double]$wx.speed }
    }
    $wAmp = [Math]::Min(40, [Math]::Max(0, $wAmp))
    $wSquash = [Math]::Min(0.6, [Math]::Max(0, $wSquash))
    $wSpeed = [Math]::Min(4, [Math]::Max(0.2, $wSpeed))

    # 作物摇晃
    foreach ($k in $script:plants.Keys) {
        $pl = $script:plants[$k]
        # 待机摇摆（游戏里 random_swing=true 的作物一直轻轻晃）
        $idle = 0.0
        $sq = 0.0
        if ($pl.swing) {
            $wave = [Math]::Sin($now / 10000000.0 * 1.047 * $wSpeed + $pl.phase)
            if ($wMode -eq 'left') { $idle = -[Math]::Abs($wave) * $wAmp }
            elseif ($wMode -eq 'right') { $idle = [Math]::Abs($wave) * $wAmp }
            elseif ($wMode -eq 'none') { $idle = 0.0 }
            else { $idle = $wave * $wAmp }
        }
        $sq = $wSquash * [Math]::Sin($now / 10000000.0 * 2.1 * $wSpeed)
        $pl.sc.ScaleX = 1.0 - 0.45 * $sq
        $pl.sc.ScaleY = 1.0 + $sq
        if ($DebugWobble) {
            $script:peakAngle = [Math]::Abs([Math]::Sin(($now / 10000000.0) * 2 * [Math]::PI * 0.8) * 35)
            $pl.rot.Angle = [Math]::Sin(($now / 10000000.0) * 2 * [Math]::PI * 0.8) * 35
            continue
        }
        $wUntil = $(if ($script:wobbleUntil.ContainsKey($k)) { [double]$script:wobbleUntil[$k] } else { 0 })
        $wAmp = $(if ($script:wobbleAmp.ContainsKey($k)) { [double]$script:wobbleAmp[$k] } else { 14 })
        if ($wUntil -gt $now) {
            $t = ($wUntil - $now) / 16000000.0
            $phase = ($now / 10000000.0) * 2 * [Math]::PI * 2.0
            $pl.rot.Angle = [Math]::Sin($phase) * $wAmp * [Math]::Max(0.12, $t)
            if ($pl.tf) { $pl.img.RenderTransform = $pl.tf }
            if ([Math]::Abs($pl.rot.Angle) -gt $script:peakAngle) { $script:peakAngle = [Math]::Abs($pl.rot.Angle) }
        } elseif ([Math]::Abs($pl.rot.Angle - $idle) -gt 0.01) {
            $pl.rot.Angle = $idle
            if ($pl.tf) { $pl.img.RenderTransform = $pl.tf }
            if ($script:wobbleUntil.ContainsKey($k)) { $script:wobbleUntil.Remove($k) }
        }
    }

    # 装饰摇摆：和作物共用天气参数
    if ($null -ne $script:decorEls) {
        foreach ($d in $script:decorEls) {
            $wave = [Math]::Sin($now / 10000000.0 * 1.047 * $wSpeed + $d.phase)
            if ($dMode -eq 'left') { $d.rot.Angle = -[Math]::Abs($wave) * $dAmp }
            elseif ($dMode -eq 'right') { $d.rot.Angle = [Math]::Abs($wave) * $dAmp }
            elseif ($dMode -eq 'none') { $d.rot.Angle = 0.0 }
            else { $d.rot.Angle = $wave * $dAmp }
            $sq = $wSquash * [Math]::Sin($now / 10000000.0 * 2.1 * $wSpeed)
            $d.sc.ScaleX = 1.0 - 0.35 * $sq
            $d.sc.ScaleY = 1.0 + $sq
        }
    }

    # 生长弹一下：0→1 的 260ms 里做一次 1.12 的过冲
    foreach ($k in @($script:plants.Keys)) {
        $pl = $script:plants[$k]
        if ($script:popUntil.ContainsKey($k) -and $script:popUntil[$k] -gt $now) {
            $t = 1.0 - (($script:popUntil[$k] - $now) / 2600000.0)
            $pl.sc.ScaleX = 1.0 + 0.12 * [Math]::Sin([Math]::PI * $t)
            $pl.sc.ScaleY = $pl.sc.ScaleX
        } elseif ($pl.sc.ScaleX -ne 1.0 -and $wSquash -le 0) {
            $pl.sc.ScaleX = 1.0; $pl.sc.ScaleY = 1.0
        }
    }

    # 天气最后统一压扁/拉伸，避免被生长弹跳或场景重建重置
    if ($wSquash -gt 0) {
        foreach ($k in @($script:plants.Keys)) {
            $pl = $script:plants[$k]
            $sq = $wSquash * [Math]::Sin($now / 10000000.0 * 2.1 * $wSpeed)
            $pl.sc.ScaleX = 1.0 - 0.45 * $sq
            $pl.sc.ScaleY = 1.0 + $sq
        }
        if ($null -ne $script:decorEls) {
            foreach ($d in $script:decorEls) {
                $sq = $wSquash * [Math]::Sin($now / 10000000.0 * 2.1 * $wSpeed)
                $d.sc.ScaleX = 1.0 - 0.35 * $sq
                $d.sc.ScaleY = 1.0 + $sq
            }
        }
    }

    # 粒子：抛物线 + 淡出
    $aliveP = @()
    foreach ($pt in $script:particles) {
        $age = ($now - $pt.born) / 10000.0
        if ($age -ge $pt.life) { $canvas.Children.Remove($pt.img); continue }
        $t = $age / 1000.0
        $px = $pt.x0 * $W + $pt.vx * 130 * $t
        $py = $pt.y0 + $pt.vy * 130 * $t + 320 * $t * $t
        $pt.img.Visibility = 'Visible'
        [System.Windows.Controls.Canvas]::SetLeft($pt.img, $px - $pt.size / 2)
        [System.Windows.Controls.Canvas]::SetTop($pt.img, $py - $pt.size / 2)
        $pt.img.Opacity = [Math]::Max(0.0, 1.0 - ($age / $pt.life))
        $aliveP += $pt
    }
    $script:particles = $aliveP

    # 水花 / 浇水水滴：逐帧播放
    $aliveS = @()
    foreach ($sp in $script:splashes) {
        $age = ($now - $sp.born) / 10000.0
        $idx = [int][Math]::Floor($age / $sp.per)
        if ($idx -ge $sp.frames.Count) { $canvas.Children.Remove($sp.img); continue }
        if ($idx -ne $sp.idx) {
            $sp.idx = $idx
            $img2 = Get-ImageFile $sp.frames[$idx]
            if ($img2) { $sp.img.Source = $img2 }
        }
        $aliveS += $sp
    }
    $script:splashes = $aliveS

    # 浇透的植株滴水：21 帧一轮，轮与轮之间停 4.5 秒（持续性湿润的暗示，不刷屏）
    if ($script:drips.Count -gt 0) {
        foreach ($k in @($script:drips.Keys)) {
            $d = $script:drips[$k]
            if ($null -eq $d.img) { continue }
            if ($d.pauseUntil -gt $now) { $d.img.Visibility = 'Hidden'; continue }
            if ($d.pauseUntil -gt 0) { $d.pauseUntil = 0; $d.at = $now; $d.idx = -1 }
            $idx = [int][Math]::Floor((($now - $d.at) / 10000.0) / $d.per)
            if ($idx -ge 21) {
                $d.pauseUntil = $now + 45000000   # 4.5 秒
                $d.at = $now
                $d.img.Visibility = 'Hidden'
                continue
            }
            if ($idx -ne $d.idx) {
                $d.idx = $idx
                $sp = Get-ImageFile ('water_drip' + $d.stage + '_' + $idx.ToString('00'))
                if ($sp) { $d.img.Source = $sp }
            }
            $d.img.Visibility = 'Visible'
        }
    }

    # 掉落物：先掉下来弹一下，再轻轻浮动
    foreach ($k in $script:drops.Keys) {
        $d = $script:drops[$k]
        $age = ($now - $d.born) / 10000000.0
        $d.img.Visibility = 'Visible'
        $x0 = $d.fromX * $W
        $x1 = $d.x * $W
        $restY = $ground - $d.size
        if ($age -lt 0.5) {
            # 收获的一瞬间：从植株中段往左/右弹出去，抛物线落地
            $t = $age / 0.5
            $px = $x0 + ($x1 - $x0) * $t
            $startY = $restY - 30
            $py = $startY + ($restY - $startY) * $t - 34 * [Math]::Sin([Math]::PI * $t)
        } else {
            # 落地后原地轻轻浮动，直到被捡走
            $px = $x1
            $py = $restY - 2 + [Math]::Sin(($age - 0.5) * 4.2) * 1.5
        }
        [System.Windows.Controls.Canvas]::SetLeft($d.img, $px - $d.size / 2)
        [System.Windows.Controls.Canvas]::SetTop($d.img, $py)
    }

    # 特效
    $alive = @()
    foreach ($fx in $script:fxItems) {
        $t = ($now - $fx.start) / ($fx.ms * 10000.0)
        if ($fx.kind -eq 'collect') {
            if ($t -ge 1) { foreach ($e in $fx.els) { $canvas.Children.Remove($e) }; continue }
            $e = $fx.els[0]
            $x0 = $fx.x * $W
            $x1 = $fx.toX * $W
            $curX = $x0 + ($x1 - $x0) * $t
            $arc = (-0.32 * $H) * [Math]::Sin([Math]::PI * $t)
            $size = $fx.size * (1 - 0.55 * $t)
            $e.Width = $size; $e.Height = $size
            [System.Windows.Controls.Canvas]::SetLeft($e, $curX - $size / 2)
            [System.Windows.Controls.Canvas]::SetTop($e, $ground - $size - 2 + $arc)
            $e.Opacity = 1 - 0.15 * $t
        } elseif ($fx.kind -eq 'water') {
            if ($t -ge 1) { foreach ($e in $fx.els) { $canvas.Children.Remove($e) }; continue }
            $i = 0
            foreach ($e in $fx.els) {
                $tt = [Math]::Min(1.0, [Math]::Max(0.0, $t - $i * 0.08))
                [System.Windows.Controls.Canvas]::SetTop($e, $H - 60 + $tt * 52)
                $e.Opacity = 1 - $tt
                $i++
            }
        }
        $alive += $fx
    }
    $script:fxItems = $alive

    # 定点快照
    if ($script:shotPlan.Count -gt 0) {
        $elapsedMs = ((Get-Date).Ticks - $script:startedTicks) / 10000.0
        foreach ($sh in $script:shotPlan) {
            if (-not $sh.done -and $elapsedMs -ge $sh.ms) {
                $sh.done = $true
                Save-Snapshot ('-' + [int]$sh.ms)
            }
        }
    }
}

function Process-Fx {
    # 特效（水花/碎屑/collect 图标）只属于背景层。前景层以前也会跑一遍，
    # 结果在桌宠身上多出一份掉落物图标 / 水花 —— 前景层只画上层野草/上层装饰，下层野草在背景层。
    if ($WeedsOnly) { return }
    # 启动时 state.fx 里全是历史（上次运行留下的收/浇水/收割）；
    # 重放它们会在旧位置冒出一串发光的作物图标，像"地板在发光"。只标记、不播。
    if ($script:skipFxHistory) {
        foreach ($f in @($script:state.fx)) { $script:playedFx[[int]$f.id] = 1 }
        $script:skipFxHistory = $false
        return
    }
    $groundY = $script:sceneH - $script:visibleGrass
    $fxList = @($script:state.fx)
    foreach ($f in $fxList) {
        $id = [int]$f.id
        if ($script:playedFx.ContainsKey($id)) { continue }
        $script:playedFx[$id] = 1
        $kind = [string]$f.kind
        $x = 0.0
        if ($null -ne $f.x) { $x = [double]$f.x }
        $toX = $x
        if ($null -ne $f.toX) { $toX = [double]$f.toX }
        if ($kind -eq 'collect') {
            $prefix = 'icon_item_' + [string]$f.item
            Add-Fx 'collect' $x $toX $prefix
        } elseif ($kind -eq 'water') {
            $plotId = 0
            if ($null -ne $f.plot) { $plotId = [int]$f.plot }
            $plantH = 0.0
            $plot = @($script:state.plots) | Where-Object { [int]$_.id -eq $plotId } | Select-Object -First 1
            if ($plot) {
                $pSprite = $null
                if ($plot.sprite) { $pSprite = Get-ImageFile ([string]$plot.sprite) }
                if (-not $pSprite) { $pSprite = Get-Sprite ([string]$plot.prefix) ([int]$plot.frame) }
                if ($pSprite) { $plantH = [Math]::Round($pSprite.PixelHeight * $Zoom) }
            }
            Start-WaterFx $x $plotId $plantH
        } elseif ($kind -eq 'harvest') {
            Spawn-Particles $x ($groundY - 0.42 * $script:sceneH) 10 1.2
            Spawn-Particles $x ($groundY - 0.10 * $script:sceneH) 4 0.8
        } elseif ($kind -eq 'weedBreak' -or $kind -eq 'pull') {
            Start-Smoke $x
        } elseif ($kind -eq 'plant') {
            Spawn-Particles $x ($groundY - 4) 6 0.7
        }
    }
    if ($script:playedFx.Count -gt 60) {
        $keep = @{}
        $ids = @($script:playedFx.Keys | Sort-Object | Select-Object -Last 40)
        foreach ($k in $ids) { $keep[$k] = 1 }
        $script:playedFx = $keep
    }
}

# ---------- 位置 ----------
$script:pos = $null
$script:screenKey = ''
function Write-ScreenInfo {
    # 给 World 用：实际工作区是 DIP，格宽/农田边界都按这个算，换电脑不用手改 2048。
    if (-not $StatePath) { return }
    $key = [string]$script:sceneW + 'x' + [string]$script:sceneH
    if ($key -eq $script:screenKey) { return }
    $script:screenKey = $key
    try {
        $dir = Split-Path -Parent $StatePath
        if (-not (Test-Path -LiteralPath $dir)) { return }
        $json = @{ width = [int]$script:sceneW; height = [int]$script:sceneH } | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText((Join-Path $dir 'screen.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
    } catch { Log ('screen.json failed: ' + $_.Exception.Message) }
}

function Update-Placement([IntPtr]$h) {
    # 多屏：优先跟随桌宠窗口所在屏幕；找不到桌宠时回退主屏。
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $pet = [FarmWin32]::FindPetWindow()
    if ($pet -ne [IntPtr]::Zero) {
        try {
            $s = [System.Windows.Forms.Screen]::FromHandle($pet)
            if ($null -ne $s) { $screen = $s }
        } catch { }
    }
    $wa = $screen.WorkingArea
    $b = $screen.Bounds
    # Screen API 返回物理像素，WPF Window 坐标是 DIP；125% 缩放时要换算。
    $dpi = 1.0
    try { $dpi = [System.Windows.Media.VisualTreeHelper]::GetDpi($win).DpiScaleX } catch { }
    if ($dpi -le 0) { $dpi = 1.0 }
    $waLeft = $wa.Left / $dpi; $waTop = $wa.Top / $dpi
    $waWidth = $wa.Width / $dpi; $waHeight = $wa.Height / $dpi
    $bLeft = $b.Left / $dpi; $bTop = $b.Top / $dpi
    $bRight = $b.Right / $dpi; $bBottom = $b.Bottom / $dpi
    $waRight = $wa.Right / $dpi; $waBottom = $wa.Bottom / $dpi
    $edge = -1
    if ($waTop -gt $bTop) { $edge = 1 }
    elseif ($waBottom -lt $bBottom) { $edge = 3 }
    elseif ($waLeft -gt $bLeft) { $edge = 0 }
    elseif ($waRight -lt $bRight) { $edge = 2 }
    $pl = Get-Placement -WorkLeft $waLeft -WorkTop $waTop -WorkWidth $waWidth -WorkHeight $waHeight -StripHeight $script:sceneH -TaskbarEdge $edge
    $key = [string]$pl.EdgeCode + '|' + $pl.Left + '|' + $pl.Top + '|' + $pl.Width + '|' + $pl.Ground
    if ($key -eq $script:pos) { return $false }
    $win.Left = $pl.Left; $win.Top = $pl.Top; $win.Width = $pl.Width; $win.Height = $pl.Height
    $script:sceneW = $pl.Width
    $script:pos = $key
    Write-ScreenInfo
    Log ('placement edge=' + $pl.Edge + ' win=' + $pl.Width + 'x' + $pl.Height + ' at ' + $pl.Left + ',' + $pl.Top + ' ground=' + $pl.Ground)
    if ($h -ne [IntPtr]::Zero) {
        [void][FarmWin32]::SetWindowPos($h, [IntPtr]::Zero, [int]$pl.Left, [int]$pl.Top, [int]$pl.Width, [int]$pl.Height,
            ([FarmWin32]::SWP_NOZORDER -bor [FarmWin32]::SWP_NOACTIVATE))
    }
    return $true
}

# ---------- 快照 ----------
# 默认不写：以前每次 state.json 变化（World 每 5 秒写一次）就重写一张 PNG，
# 一天能白写几百 MB，日志也被 snapshot 行刷满。要取证时加 -Snapshot 或 -Shots。
function Save-Snapshot([string]$tag = '', [switch]$Always) {
    if (-not $Always -and -not $Snapshot -and $Shots.Count -eq 0) { return }
    try {
        $content = $win.Content
        if (-not $content) { return }
        $content.UpdateLayout()
        $w = [int][Math]::Ceiling($content.ActualWidth)
        $h = [int][Math]::Ceiling($content.ActualHeight)
        if ($w -lt 2 -or $h -lt 2) { return }
        $rtb = [System.Windows.Media.Imaging.RenderTargetBitmap]::new($w, $h, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
        $rtb.Render($content)
        $enc = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
        $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($rtb))
        $path = Join-Path $script:rt ('overlay-snapshot-' + $script:kind + $tag + '.png')
        $fs2 = [System.IO.File]::Create($path)
        try { $enc.Save($fs2) } finally { $fs2.Dispose() }
        Log ('snapshot -> ' + $path + ' (' + $w + 'x' + $h + ')')
    } catch { Log ('snapshot failed: ' + $_.Exception.Message) }
}

# ---------- 启动绘制 ----------
$script:hwnd = [IntPtr]::Zero
Update-Placement ([IntPtr]::Zero)
Render-Scene
Process-Fx
Log ('scene ' + $script:sceneW + 'x' + $script:sceneH + ' plants=' + $script:plants.Count)

$script:anchorState = 'pending'
$script:anchoredOnce = $false
# 跟着桌宠的显示状态走：桌宠被隐藏 / 退出，图层也隐藏 / 停掉
$script:policyHidden = $false
$script:shellHidden = $false   # 任务栏溢出/开始菜单等系统 UI 在前台时临时隐藏，别盖住它们
$script:sawPet = $false
$script:petGoneAt = $null

function Update-PetVisibility {
    $st = [FarmWin32]::PetWindowState()   # 0=没了 1=被隐藏 2=看得见
    if ($st -eq 2) {
        $script:sawPet = $true
        $script:petGoneAt = $null
        if ($script:policyHidden) {
            $script:policyHidden = $false
            if ($script:shellHidden) { Log 'pet visible but shell ui -> stay hidden' }
            else { Show-Overlay 'pet visible' }
        }
    } else {
        if ($st -eq 0) {
            if ($null -eq $script:petGoneAt) { $script:petGoneAt = Get-Date }
        } else {
            $script:petGoneAt = $null
        }
        if (-not $script:policyHidden) {
            $script:policyHidden = $true
            Hide-Overlay ('pet ' + $(if ($st -eq 0) { 'gone' } else { 'hidden' }))
        }
    }
}

function Show-Overlay([string]$why) {
    try {
        $win.ShowActivated = $false
        $win.Show()
    } catch { Log ('show failed: ' + $_.Exception.Message) }
    try { Apply-Styles $script:hwnd } catch { }
    $script:anchoredOnce = $false
    try { Anchor-BelowPet $script:hwnd } catch { }
    if ($NoAnchor) { try { Owned-ByPet $script:hwnd } catch { } }
    try { $animTimer.Start() } catch { }
    Log ($why + ' -> overlay shown')
}

function Hide-Overlay([string]$why) {
    try { $win.Hide() } catch { Log ('hide failed: ' + $_.Exception.Message) }
    try { $animTimer.Stop() } catch { }
    Log ($why + ' -> overlay hidden')
}

# 任务栏溢出（Win11 TopLevelWindowForOverflowXamlIsland / Win10 NotifyIconOverflowWindow）、
# 右键菜单、任务视图、开始菜单等系统 UI 都在最上层；图层 Hide 掉，等它们消失再回来。
function Test-ShellForeground {
    $fg = [FarmWin32]::GetForegroundWindow()
    if ($fg -eq [IntPtr]::Zero) { return $false }
    $sb = [System.Text.StringBuilder]::new(256)
    [void][FarmWin32]::GetClassNameW($fg, $sb, 256)
    $cls = $sb.ToString()
    $shell = @(
        'TopLevelWindowForOverflowXamlIsland',
        'NotifyIconOverflowWindow',
        '#32768',
        'XamlExplorerHostIslandWindow_WASDK',
        'TaskListThumbnailWnd',
        'MultitaskingViewFrame'
    )
    if ($shell -contains $cls) { return $true }
    if ($cls -eq 'Windows.UI.Core.CoreWindow') {
        $procId = 0
        [void][FarmWin32]::GetWindowThreadProcessId($fg, [ref]$procId)
        try {
            $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName
        } catch { return $false }
        return ($name -eq 'StartMenuExperienceHost' -or $name -eq 'ShellExperienceHost')
    }
    return $false
}

function Update-ShellVisibility {
    if ($script:hwnd -eq [IntPtr]::Zero) { return }
    $shell = Test-ShellForeground
    if ($shell -eq $script:shellHidden) { return }
    $script:shellHidden = $shell
    if ($shell) {
        if (-not $script:policyHidden) { Hide-Overlay 'shell ui' }
        else { Log 'shell ui (already hidden)' }
    } else {
        if (-not $script:policyHidden) { Show-Overlay 'shell ui gone' }
    }
}

function Apply-Styles([IntPtr]$h) {
    $ex = [FarmWin32]::GetWindowLong($h, [FarmWin32]::GWL_EXSTYLE)
    if ($Clickable) {
        $new = ($ex -bor [FarmWin32]::WS_EX_LAYERED -bor [FarmWin32]::WS_EX_TOOLWINDOW) -band (-bnot [FarmWin32]::WS_EX_TRANSPARENT)
    } else {
        $new = $ex -bor [FarmWin32]::WS_EX_TRANSPARENT -bor [FarmWin32]::WS_EX_LAYERED -bor [FarmWin32]::WS_EX_TOOLWINDOW -bor [FarmWin32]::WS_EX_NOACTIVATE
    }
    [void][FarmWin32]::SetWindowLong($h, [FarmWin32]::GWL_EXSTYLE, $new)
    Log ('exstyle 0x{0:X8} -> 0x{1:X8}' -f $ex, [FarmWin32]::GetWindowLong($h, [FarmWin32]::GWL_EXSTYLE))
}

function Owned-ByPet([IntPtr]$h) {
    if ($h -eq [IntPtr]::Zero) { return }
    $pet = [FarmWin32]::FindPetWindow()
    if ($pet -eq [IntPtr]::Zero) { return }
    if ($script:ownedBy -eq $pet) { return }
    $old = [FarmWin32]::SetWindowLongPtr($h, [FarmWin32]::GWLP_HWNDPARENT, $pet)
    $script:ownedBy = $pet
    Log ('owned by pet: ' + $pet)
}

function Anchor-BelowPet([IntPtr]$h) {
    if ($h -eq [IntPtr]::Zero) { return }
    $flags = [FarmWin32]::SWP_NOMOVE -bor [FarmWin32]::SWP_NOSIZE -bor [FarmWin32]::SWP_NOACTIVATE
    $pet = [IntPtr]::Zero
    if (-not $NoAnchor) { $pet = [FarmWin32]::FindPetWindow() }
    if ($pet -ne [IntPtr]::Zero) {
        [void][FarmWin32]::SetWindowPos($h, $pet, 0, 0, 0, 0, $flags)
        $s = 'below-pet:' + $pet
        $script:anchoredOnce = $true
    } elseif ($script:anchoredOnce) {
        # 桌宠窗口偶尔会重建，FindPetWindow 会短暂找不到。
        # 以前这时会把自己改成 topmost → 盖住桌宠的脚，2 秒后又弹回来，来回闪。
        # 已经锚定过就什么都不做，等下一次找到桌宠。
        return
    } else {
        # 第一次还没见过桌宠：先置顶保证能看见（桌宠起来后 2 秒内会改回 below-pet）
        [void][FarmWin32]::SetWindowPos($h, [FarmWin32]::HWND_TOPMOST, 0, 0, 0, 0, $flags)
        $s = 'topmost-only'
    }
    if ($script:anchorState -ne $s) { Log ('anchor -> ' + $s) }
    $script:anchorState = $s
}

$win.Add_SourceInitialized({
    $helper = [System.Windows.Interop.WindowInteropHelper]::new($win)
    $script:hwnd = $helper.Handle
    Log ('sourceinitialized hwnd=' + $script:hwnd)
    Apply-Styles $script:hwnd
    Anchor-BelowPet $script:hwnd
    # 桌宠还没起来 / 被藏起来：图层一开始就别露头
    try { Update-PetVisibility } catch { }
})
$win.Add_Loaded({
    try { Update-PetVisibility } catch { }
})
$win.Add_ContentRendered({
    Log 'contentrendered'
    Save-Snapshot '' -Always
    try { Update-PetVisibility } catch { }
})

# 动画 30fps
$animTimer = [System.Windows.Threading.DispatcherTimer]::new()
$animTimer.Interval = [TimeSpan]::FromMilliseconds(16)
$script:lastAnimErr = ''
$script:lastFollowErr = ''
$animTimer.Add_Tick({
    try { Update-Anim } catch {
        $m = $_.Exception.Message
        if ($m -ne $script:lastAnimErr) { $script:lastAnimErr = $m; Log ('anim err: ' + $m) }
    }
})
$animTimer.Start()

# 定点快照（验证动画用，由动画器按时间触发，避免闭包问题）
$script:shotPlan = @()
foreach ($ms in $Shots) { $script:shotPlan += @{ ms = [double]$ms; done = $false } }
$script:startedTicks = (Get-Date).Ticks
Log ('shot plan=' + $script:shotPlan.Count + ' shots=' + $Shots.Count)

# 桌宠位置
try { [FarmPetWatch]::Start($PetApi, 400); Log ('pet watch -> ' + $PetApi) } catch { Log ('pet watch failed: ' + $_.Exception.Message) }

# 锚点 2s
$anchorTimer = [System.Windows.Threading.DispatcherTimer]::new()
$anchorTimer.Interval = [TimeSpan]::FromSeconds(2)
$anchorTimer.Add_Tick({
    if ($script:policyHidden) { return }
    Anchor-BelowPet $script:hwnd
    # 前景层：把自己设成桌宠的"从属窗口"（owned window）。
    # Windows 保证从属窗口永远在宿主之上，所以不用每 2 秒去抢 z 序，也不会被桌宠压下去。
    if ($NoAnchor) { Owned-ByPet $script:hwnd }
})
$anchorTimer.Start()

# 跟随桌宠 1s：桌宠被 hide() / 退出 → 自己也藏起来；回来 → 立刻显示
$followTimer = [System.Windows.Threading.DispatcherTimer]::new()
$followTimer.Interval = [TimeSpan]::FromMilliseconds(1000)
$followTimer.Add_Tick({
    try { Update-PetVisibility } catch {
        $m = $_.Exception.Message
        if ($m -ne $script:lastFollowErr) { $script:lastFollowErr = $m; Log ('follow err: ' + $m) }
    }
})
$followTimer.Start()

# 任务栏系统 UI 250ms：托盘溢出/开始菜单/右键菜单在前台时，图层先 Hide，别盖住它们
$shellTimer = [System.Windows.Threading.DispatcherTimer]::new()
$shellTimer.Interval = [TimeSpan]::FromMilliseconds(250)
$shellTimer.Add_Tick({
    try { Update-ShellVisibility } catch {
        $m = $_.Exception.Message
        if ($m -ne $script:lastShellErr) { $script:lastShellErr = $m; Log ('shell watch err: ' + $m) }
    }
})
$shellTimer.Start()

# 布局 1.5s
$script:placeTick = 0
$placeTimer = [System.Windows.Threading.DispatcherTimer]::new()
$placeTimer.Interval = [TimeSpan]::FromMilliseconds(1500)
$placeTimer.Add_Tick({
    $script:placeTick++
    if (Update-Placement $script:hwnd) { Render-Scene; Process-Fx; Save-Snapshot }
    elseif ($script:placeTick % 200 -eq 0) { Log ('placement steady #' + $script:placeTick + ' ' + $script:pos) }
})
$placeTimer.Start()

# 状态 1s
if ($StatePath) {
    $script:stateStamp = [DateTime]::MinValue
    try { $script:stateStamp = (Get-Item -LiteralPath $StatePath).LastWriteTimeUtc } catch { }
    $stateTimer = [System.Windows.Threading.DispatcherTimer]::new()
    $stateTimer.Interval = [TimeSpan]::FromSeconds(1)
    $stateTimer.Add_Tick({
        if (-not (Test-Path -LiteralPath $StatePath)) { return }
        try {
            $stamp = (Get-Item -LiteralPath $StatePath).LastWriteTimeUtc
            if ($stamp -eq $script:stateStamp) { return }
            $script:stateStamp = $stamp
            $script:state = Get-Content -LiteralPath $StatePath -Raw -Encoding utf8 | ConvertFrom-Json
            if ($null -ne $script:state.stripHeight) {
                $newH = [Math]::Min(800, [Math]::Max(120, [int]$script:state.stripHeight))
                if ($newH -ne $script:sceneH) {
                    $script:sceneH = $newH
                    $script:screenKey = ''
                    [void](Update-Placement $script:hwnd)
                }
            }
            Render-Scene
            Process-Fx
            if ($Snapshot) { Save-Snapshot }
        } catch { Log ('state tick failed: ' + $_.Exception.Message) }
    })
    $stateTimer.Start()
}

if ($Seconds -gt 0) {
    $exitTimer = [System.Windows.Threading.DispatcherTimer]::new()
    $exitTimer.Interval = [TimeSpan]::FromSeconds($Seconds)
    $exitTimer.Add_Tick({
        Log ('auto exit after ' + $Seconds + 's')
        $anchorTimer.Stop(); $placeTimer.Stop(); $animTimer.Stop(); [FarmPetWatch]::Stop()
        $win.Close()
    })
    $exitTimer.Start()
}

$win.Add_Closed({
    Log 'closed'
    try { [FarmPetWatch]::Stop() } catch { }
    try {
        if (Test-Path -LiteralPath $script:selfPidFile) {
            if ((Get-Content -LiteralPath $script:selfPidFile -Raw).Trim() -eq [string]$PID) { Remove-Item -LiteralPath $script:selfPidFile -Force }
        }
    } catch { }
})

Log 'app.run entering'
$app = [System.Windows.Application]::new()
[void]$app.Run($win)
Log 'app.run returned'
exit 0

} catch {
    Log ('CAUGHT ' + $_.Exception.ToString())
    Log ('POS ' + $_.InvocationInfo.PositionMessage)
    exit 8
}
