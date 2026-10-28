<#
  验证桌面图层三项性质，并留证据截图。
    A 置顶      WS_EX_TOPMOST 置位，且在 z 序上高于所有普通窗口
    B 桌宠在上  桌宠窗口（Cortico 桌宠）在 z 序上高于图层
    C 点击穿透  WindowFromPoint 落在图层范围内时，返回的不是图层自己
  另外附带：不进 Alt-Tab / 不占任务栏 / 不抢焦点 / 渲染快照
  用法：.\verify-overlay.ps1 [-Expect]   -Expect Clickable 时断言"能挡住鼠标"
#>
param(
    [ValidateSet('PassThrough', 'Clickable')]
    [string]$Expect = 'PassThrough',
    [string]$OutDir = '',
    [switch]$NoAnchor
)
$ErrorActionPreference = 'Continue'

$rt = Join-Path $PSScriptRoot 'runtime'
if (-not $OutDir) { $OutDir = $rt }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class V {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowLongW(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, Rt, B; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);

    public static readonly int GWL_EXSTYLE = -20;
    public static readonly uint WS_EX_TRANSPARENT = 0x20;
    public static readonly uint WS_EX_TOPMOST = 0x8;
    public static readonly uint WS_EX_LAYERED = 0x80000;
    public static readonly uint WS_EX_TOOLWINDOW = 0x80;
    public static readonly uint WS_EX_APPWINDOW = 0x40000;
    public static readonly uint WS_EX_NOACTIVATE = 0x8000000;

    public static string[] ZOrder() {
        List<string> res = new List<string>();
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            StringBuilder t = new StringBuilder(512); GetWindowTextW(h, t, 512);
            StringBuilder c = new StringBuilder(256); GetClassNameW(h, c, 256);
            uint pid; GetWindowThreadProcessId(h, out pid);
            RECT r; GetWindowRect(h, out r);
            res.Add(string.Join("\u0001", new string[] {
                h.ToInt64().ToString(), pid.ToString(), IsWindowVisible(h) ? "1" : "0",
                GetWindowLongW(h, -20).ToString("X8"), c.ToString(),
                r.L.ToString(), r.T.ToString(), r.Rt.ToString(), r.B.ToString(), t.ToString() }));
            return true;
        }, IntPtr.Zero);
        return res.ToArray();
    }
}
"@

$sep = [char]1
$z = @{}
$index = 0
$rows = @()
foreach ($line in [V]::ZOrder()) {
    $f = $line -split $sep
    $index++
    $o = [pscustomobject]@{
        z = $index; hwnd = [IntPtr][int64]$f[0]; pid = [int]$f[1]; vis = ($f[2] -eq '1')
        ex = [Convert]::ToUInt32($f[3], 16); cls = $f[4]
        l = [int]$f[5]; t = [int]$f[6]; r = [int]$f[7]; b = [int]$f[8]; title = $f[9]
    }
    $rows += $o
    $z[[int64]$o.hwnd] = $o
}

# ---- 找图层窗口 ----
# 现在有两块：背景层（bg.pid，在桌宠下面）+ 野草前景层（weeds.pid，owned，在桌宠上面）。
# 这个脚本验证的是背景层：点击穿透、置顶、桌宠在它上面。
$overlay = $null
$pidFile = Join-Path $rt 'bg.pid'
if (Test-Path -LiteralPath $pidFile) {
    $v = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($v -match '^\d+$') {
        $overlay = $rows | Where-Object { $_.pid -eq [int]$v -and $_.title -eq 'FarmOverlay' } | Select-Object -First 1
    }
}
if (-not $overlay) { $overlay = $rows | Where-Object { $_.title -eq 'FarmOverlay' } | Select-Object -Last 1 }

$pet = $rows | Where-Object { $_.vis -and $_.title -match '桌宠' } | Select-Object -First 1

# ---- 结果表 ----
$results = New-Object System.Collections.Generic.List[object]
function Check([string]$name, [bool]$ok, [string]$detail) {
    $results.Add([pscustomobject]@{ 项 = $name; 结果 = $(if ($ok) { 'PASS' } else { 'FAIL' }); 说明 = $detail }) | Out-Null
}

if (-not $overlay) {
    Write-Host '!! 没找到 overlay 窗口（先跑 .\restart-layers.ps1 -Ensure）'
    exit 1
}

$ex = $overlay.ex
Check '窗口存在且可见' ($overlay.vis) ('hwnd=' + $overlay.hwnd + ' pid=' + $overlay.pid)
Check 'A 置顶 WS_EX_TOPMOST' (($ex -band [V]::WS_EX_TOPMOST) -ne 0) ('exstyle=0x{0:X8}' -f $ex)
Check '分层窗口 WS_EX_LAYERED' (($ex -band [V]::WS_EX_LAYERED) -ne 0) '允许逐像素透明'

# A: z 序高于所有可见的普通（非 topmost）窗口
$normalAbove = @($rows | Where-Object { $_.vis -and $_.hwnd -ne $overlay.hwnd -and $_.z -lt $overlay.z -and (($_.ex -band [V]::WS_EX_TOPMOST) -eq 0) -and $_.title -ne '' })
Check 'A 在所有普通窗口之上' ($normalAbove.Count -eq 0) ('其上有 ' + $normalAbove.Count + ' 个普通窗口' + $(if ($normalAbove.Count) { '：' + (($normalAbove | ForEach-Object { $_.title }) -join ' / ') } else { '' }))

# B: 桌宠在上
if ($NoAnchor) {
    $results.Add([pscustomobject]@{ 项 = 'B 桌宠压在图层上面'; 结果 = 'SKIP'; 说明 = '这次用 -NoAnchor 起的，故意压过桌宠，不检查该项' }) | Out-Null
} elseif ($pet) {
    Check 'B 桌宠压在图层上面' ($pet.z -lt $overlay.z) ('桌宠 z=' + $pet.z + ' 图层 z=' + $overlay.z + ' title=' + $pet.title)
} else {
    Check 'B 桌宠压在图层上面' $false '没找到桌宠窗口'
}

# C: 点击穿透
$cx = [int](($overlay.l + $overlay.r) / 2)
$cy = [int](($overlay.t + $overlay.b) / 2)
$samples = @(
    @($cx, $cy),
    @(($overlay.l + 60), ($overlay.t + 60)),
    @(($overlay.r - 60), ($overlay.b - 60)),
    @(($overlay.l + 20), ($overlay.b - 20)),
    @(($overlay.r - 20), ($overlay.t + 20))
)
$hits = @()
foreach ($s in $samples) {
    $pt = New-Object V+POINT
    $pt.X = $s[0]; $pt.Y = $s[1]
    $h = [V]::WindowFromPoint($pt)
    $desc = 'x=' + $s[0] + ',y=' + $s[1] + ' -> hwnd=' + $h
    if ($z.ContainsKey([int64]$h)) { $desc += ' [' + $z[[int64]$h].title + ']' }
    $hits += $desc
    if ($Expect -eq 'PassThrough') {
        if ($h -eq $overlay.hwnd) { Check 'C 点击穿透' $false ('点在图层上被图层吃掉了：' + $desc); $blocked = $true }
    } else {
        if ($h -ne $overlay.hwnd) { Check 'C 能够挡住鼠标' $false ('点穿过去了：' + $desc) }
    }
}
if ($Expect -eq 'PassThrough') {
    $blocked = $false
    foreach ($s in $samples) {
        $pt = New-Object V+POINT; $pt.X = $s[0]; $pt.Y = $s[1]
        if ([V]::WindowFromPoint($pt) -eq $overlay.hwnd) { $blocked = $true }
    }
    Check 'C 点击穿透' (-not $blocked) ('5 个采样点都没有命中图层自身')
} else {
    $pt = New-Object V+POINT; $pt.X = $cx; $pt.Y = $cy
    Check 'C 能够挡住鼠标' ([V]::WindowFromPoint($pt) -eq $overlay.hwnd) ('中心点 hwnd=' + [V]::WindowFromPoint($pt))
}

Check '不进任务栏 / Alt-Tab' ((($ex -band [V]::WS_EX_TOOLWINDOW) -ne 0) -and (($ex -band [V]::WS_EX_APPWINDOW) -eq 0)) 'WS_EX_TOOLWINDOW'
Check '不抢焦点' ([V]::GetForegroundWindow() -ne $overlay.hwnd) ('前台窗口 hwnd=' + [V]::GetForegroundWindow())

Write-Host ''
Write-Host '==== 桌面图层验证 ===='
$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
Write-Host ('窗口范围: ' + $overlay.l + ',' + $overlay.t + ' - ' + $overlay.r + ',' + $overlay.b + '   (' + ($overlay.r - $overlay.l) + 'x' + ($overlay.b - $overlay.t) + ')')
Write-Host ''
Write-Host '命中测试明细：'
$hits | ForEach-Object { Write-Host ('  ' + $_) }

# ---- 渲染快照 ----
Add-Type -AssemblyName System.Drawing

# 1) 图层自己渲染的 1:1 真值（overlay.ps1 在 ContentRendered 时写出，每层一张）
$appShot = Join-Path $rt 'overlay-snapshot-bg.png'
if (-not (Test-Path -LiteralPath $appShot)) { $appShot = Join-Path $rt 'overlay-snapshot.png' }
if (Test-Path -LiteralPath $appShot) {
    $b = [System.Drawing.Bitmap]::FromFile($appShot)
    $colors = @{}
    for ($y = 0; $y -lt $b.Height; $y += 4) { for ($x = 0; $x -lt $b.Width; $x += 4) { $colors[$b.GetPixel($x, $y).ToArgb()] = 1 } }
    Write-Host ''
    Write-Host ('渲染快照（WPF 自渲染，1:1）: ' + $appShot + '  ' + $b.Width + 'x' + $b.Height + '  采样颜色数=' + $colors.Count)
    $b.Dispose()
} else {
    Write-Host ''
    Write-Host ('!! 没有 ' + $appShot + '（用 -Seconds 0 正常启动时会在 ContentRendered 时写一张）')
}

# 2) PrintWindow 交叉参考（对本窗口有缩放偏差，仅作"确实画了东西"的旁证）
$w = $overlay.r - $overlay.l
$h = $overlay.b - $overlay.t
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [V]::PrintWindow($overlay.hwnd, $hdc, 2)
$g.ReleaseHdc($hdc); $g.Dispose()
$shot = Join-Path $OutDir 'evidence-printwindow.png'
$bmp.Save($shot, [System.Drawing.Imaging.ImageFormat]::Png)
$colors2 = @{}
for ($y = 0; $y -lt $bmp.Height; $y += 4) { for ($x = 0; $x -lt $bmp.Width; $x += 4) { $colors2[$bmp.GetPixel($x, $y).ToArgb()] = 1 } }
$bmp.Dispose()
Write-Host ('PrintWindow 旁证: ' + $shot + '  (ok=' + $ok + ', 采样颜色数=' + $colors2.Count + ')')

$fail = @($results | Where-Object { $_.结果 -eq 'FAIL' })
if ($fail.Count -gt 0) { Write-Host ('结论: 有 ' + $fail.Count + ' 项失败'); exit 1 }
Write-Host '结论: 全部通过'
exit 0
