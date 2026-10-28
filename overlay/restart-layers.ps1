<#
  桌面图层宿主 —— 唯一入口（v5.1 · 2026-10-26）

    .\restart-layers.ps1                确保两层在跑（幂等：健康的进程绝不动）
    .\restart-layers.ps1 -Restart       先停再起
    .\restart-layers.ps1 -Check         只检查：退出码 0 = 两层都在 + 野草层在桌宠之上
    .\restart-layers.ps1 -Stop          全停（守护 + 两块图层）
    .\restart-layers.ps1 -Supervise     内部用：常驻守护（隐藏进程，别手动跑）

  为什么重写成"单守护"：
    旧版有三个入口（World 启动、90 秒巡检、登录快捷方式）各自拉起 / 杀掉图层，
    它们会互相打断：巡检按 pid 文件杀进程 → 背景层在 35 秒到 2 分钟后无声消失，
    日志停在 "snapshot ->"，因为是被 Stop-Process 杀的，来不及写 closed。
    现在：
      * 只有一个守护进程负责生命周期，World / 快捷方式只调 -Ensure，开机和启动都幂等；
      * 每 1.5 秒检查两块窗口，缺哪块只补哪块，绝不重启健康的那块；
      * 每块图层写自己的 pid 文件（bg.pid / weeds.pid），不再共用 overlay.pid；
      * 所有子进程用 CreateNoWindow 启动 —— 永远不会弹出 PowerShell 黑窗。

  跟着桌宠（v5.1）：
    * 桌宠隐藏  → 图层自己隐藏（overlay.ps1 的 followTimer）；
    * 桌宠窗口没了（托盘"关闭"）→ 4 秒后停掉两块图层进程，守护继续等；
      桌宠窗口回来 → 自动重新拉起；
    * App 退出（World.stop 调 -Stop）→ 立刻全停；
    * App 崩溃（没走 stop）→ 桌宠窗口没了 + state.json 30 秒不更新 → 守护退出。
      只看 state.json 不够：电脑睡眠时 World 的定时器也会停，但桌宠窗口还在。
#>
param(
    [switch]$Ensure,
    [switch]$Restart,
    [switch]$Stop,
    [switch]$Check,
    [switch]$Supervise,
    [switch]$Quiet,
    [int]$WaitSec = 20,
    # 桌宠窗口消失多久后停掉图层进程（秒）；守护继续等它回来
    [int]$PetGoneSec = 4,
    # state.json 多久没更新就认定 App 已经退出（秒）
    [int]$AppGoneSec = 30,
    # 兼容旧调用（老版本 World 会传这个），已经没用了
    [switch]$SpawnWeedsLayer
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$rt = Join-Path $here 'runtime'
New-Item -ItemType Directory -Force -Path $rt | Out-Null

$script:scriptPath = Join-Path $here 'restart-layers.ps1'
$overlayScript = Join-Path $here 'overlay.ps1'
$statePath = Join-Path $rt 'state.json'
$logFile = Join-Path $rt 'layers.log'
$supFile = Join-Path $rt 'supervisor.json'
$stopFile = Join-Path $rt 'supervisor.stop'

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $psExe)) { $psExe = (Get-Process -Id $PID).Path }

$script:spawnAt = @{}

# 日志：超过 4 MB 就滚到 .old，避免无限增长（旧日志曾经 2 MB+）
try {
    if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 4MB) {
        Move-Item -LiteralPath $logFile -Destination ($logFile + '.old') -Force
    }
} catch { }
function Log([string]$m) {
    try {
        Add-Content -LiteralPath $logFile -Encoding utf8 -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff') + ' [' + $PID + '] ' + $m)
    } catch { }
}

# ---------- Win32：枚举窗口（含隐藏窗口，按 z 序从上到下） ----------
if (-not ('FarmLayersWin' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class FarmLayersWin {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    public static string[] Rows() {
        var list = new List<string>();
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            var s = new StringBuilder(512);
            GetWindowTextW(h, s, 512);
            uint pid; GetWindowThreadProcessId(h, out pid);
            RECT r; GetWindowRect(h, out r);
            list.Add(((long)h) + "|" + pid + "|" + (IsWindowVisible(h) ? "1" : "0") + "|" +
                     s.ToString() + "|" + r.L + "|" + r.T + "|" + r.R + "|" + r.B);
            return true;
        }, IntPtr.Zero);
        return list.ToArray();
    }
}
"@
}

function Get-Rows {
    $res = New-Object System.Collections.Generic.List[object]
    foreach ($line in [FarmLayersWin]::Rows()) {
        $f = $line -split '\|'
        if ($f.Count -lt 8) { continue }
        $n = $f.Count
        $res.Add([pscustomobject]@{
            hwnd  = [int64]$f[0]
            pid   = [int]$f[1]
            vis   = ($f[2] -eq '1')
            # 标题里可能带 |，只从两端取固定字段，中间整段都算标题
            title = (($f[3..($n - 5)]) -join '|')
            l = [int]$f[$n - 4]; t = [int]$f[$n - 3]; r = [int]$f[$n - 2]; b = [int]$f[$n - 1]
        })
    }
    return $res.ToArray()
}

function Test-PetPid([int]$procId) {
    try {
        $p = Get-Process -Id $procId -ErrorAction Stop
        return $p.ProcessName.StartsWith('Coopanion')
    } catch { return $false }
}
function Get-OverlayRows {
    return @(Get-Rows | Where-Object { $_.title -eq 'FarmOverlay' })
}

# ---------- 进程身份 ----------
# 只认"命令行同时含这些片段"的进程，避免 pid 复用误杀别的 powershell
function Test-MyProcess([int]$procId, [string[]]$needles) {
    if ($procId -le 0) { return $false }
    try {
        $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $procId) -ErrorAction Stop
        if (-not $p) { return $false }
        $cmd = [string]$p.CommandLine
        if (-not $cmd) { return $false }
        foreach ($n in $needles) {
            if ($cmd.IndexOf($n, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
        }
        return $true
    } catch { return $false }
}

function Get-LayerNeedles([string]$kind) {
    if ($kind -eq 'weeds') { return @('overlay.ps1', '-WeedsOnly') }
    return @('overlay.ps1', '-NoWeeds')
}

function Get-PidFile([string]$kind) { return (Join-Path $rt ($kind + '.pid')) }

function Get-LayerPid([string]$kind) {
    $f = Get-PidFile $kind
    if (-not (Test-Path -LiteralPath $f)) { return 0 }
    $v = Get-Content -LiteralPath $f -Raw -ErrorAction SilentlyContinue
    if ($null -eq $v) { return 0 }
    $v = ([string]$v).Trim()
    if ($v -notmatch '^\d+$') {
        Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
        return 0
    }
    $n = [int]$v
    if (-not (Test-MyProcess $n (Get-LayerNeedles $kind))) {
        Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
        return 0
    }
    return $n
}

function Get-LayerWindow([string]$kind) {
    $n = Get-LayerPid $kind
    if ($n -le 0) { return $null }
    $w = @(Get-OverlayRows | Where-Object { $_.pid -eq $n }) | Select-Object -First 1
    if ($w) { return $w }
    return $null
}

function Get-SupervisorPid {
    if (-not (Test-Path -LiteralPath $supFile)) { return 0 }
    try {
        $j = Get-Content -LiteralPath $supFile -Raw -Encoding utf8 | ConvertFrom-Json
        $n = [int]$j.pid
    } catch { return 0 }
    if (-not (Test-MyProcess $n @('restart-layers.ps1', '-Supervise'))) { return 0 }
    return $n
}

# ---------- 启动子进程：CREATE_NO_WINDOW + 只继承 NUL 句柄 ----------
# 两个要求一起满足：
#   1. 不创建控制台窗口（CREATE_NO_WINDOW）——用户永远看不到 PowerShell 黑窗；
#   2. 不继承调用方的 stdout/stderr 句柄——否则常驻守护会一直攥着调用者的管道，
#      任何"捕获 restart-layers.ps1 输出"的脚本都会永远等不到 EOF（实测会挂死）。
function Quote-Arg([string]$s) {
    if ($null -eq $s) { return '""' }
    if ($s -match '[\s"]') { return '"' + $s.Replace('"', '\"') + '"' }
    return $s
}

if (-not ('FarmHiddenSpawn' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class FarmHiddenSpawn {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit,
        uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr ret);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const uint STARTF_USESTDHANDLES = 0x00000100;
    const int PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;

    public static int Start(string cmdLine, string cwd) {
        // NUL 句柄必须可继承，否则 PROC_THREAD_ATTRIBUTE_HANDLE_LIST 会报 ERROR_INVALID_PARAMETER
        var sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        sa.bInheritHandle = true;
        IntPtr saPtr = Marshal.AllocHGlobal(sa.nLength);
        Marshal.StructureToPtr(sa, saPtr, false);
        IntPtr nul;
        try {
            nul = CreateFile("NUL", 0xC0000000, 3, saPtr, 3, 0x80, IntPtr.Zero);
        } finally {
            Marshal.FreeHGlobal(saPtr);
        }
        if (nul == IntPtr.Zero || nul == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr attrs = IntPtr.Zero;
        IntPtr handleArray = IntPtr.Zero;
        try {
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            if (size == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            attrs = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attrs, 1, 0, ref size)) throw new Win32Exception(Marshal.GetLastWin32Error());
            handleArray = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(handleArray, nul);
            if (!UpdateProcThreadAttribute(attrs, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_HANDLE_LIST),
                    handleArray, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            var si = new STARTUPINFOEX();
            si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            si.StartupInfo.dwFlags = (int)STARTF_USESTDHANDLES;
            si.StartupInfo.hStdInput = nul;
            si.StartupInfo.hStdOutput = nul;
            si.StartupInfo.hStdError = nul;
            si.lpAttributeList = attrs;

            PROCESS_INFORMATION pi;
            uint flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
            bool ok = CreateProcess(null, cmdLine, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, cwd, ref si, out pi);
            int err = Marshal.GetLastWin32Error();
            if (!ok) throw new Win32Exception(err);
            int id = pi.dwProcessId;
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            return id;
        } finally {
            if (handleArray != IntPtr.Zero) Marshal.FreeHGlobal(handleArray);
            if (attrs != IntPtr.Zero) { DeleteProcThreadAttributeList(attrs); Marshal.FreeHGlobal(attrs); }
            CloseHandle(nul);
        }
    }
}
"@
}

function Start-Hidden([string[]]$argList) {
    $cmdLine = (Quote-Arg $psExe) + ' ' + (($argList | ForEach-Object { Quote-Arg $_ }) -join ' ')
    return [FarmHiddenSpawn]::Start($cmdLine, $here)
}

function Start-Layer([string]$kind) {
    $logName = $(if ($kind -eq 'weeds') { 'weeds.log' } else { 'bg.log' })
    $flags = $(if ($kind -eq 'weeds') { @('-WeedsOnly', '-NoAnchor') } else { @('-NoWeeds') })
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoLogo', '-File', $overlayScript,
                 '-StatePath', $statePath, '-LogPath', (Join-Path $rt $logName)) + $flags
    $procId = Start-Hidden $argList
    # 先把 pid 记下来（overlay.ps1 起来后也会写同一份，值相同）
    try { Set-Content -LiteralPath (Get-PidFile $kind) -Value $procId -Encoding ascii -ErrorAction Stop } catch { }
    $script:spawnAt[$kind] = Get-Date
    Log ('拉起 ' + $kind + ' pid=' + $procId)
    return $procId
}

# 起一块并等它的窗口出现；返回 $true = 窗口在
function Start-LayerAndWait([string]$kind, [int]$timeoutSec = 10) {
    $procId = Start-Layer $kind
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
            Log ($kind + ' 启动后立刻退出（pid=' + $procId + '）——看 runtime\' + $kind + '.log；若是立刻退出且日志为空，多半是 .ps1 丢了 UTF-8 BOM')
            return $false
        }
        if (Get-LayerWindow $kind) { return $true }
    }
    return [bool](Get-LayerWindow $kind)
}

# 出错退避：同一块连续失败时不要每 1.5 秒就开一个新进程
$script:failCount = @{}
$script:failAt = @{}
function Get-BackoffSec([string]$kind) {
    $n = 0
    if ($script:failCount.ContainsKey($kind)) { $n = [int]$script:failCount[$kind] }
    if ($n -le 0) { return 0 }
    return [Math]::Min(60, 5 * $n)
}

function Ensure-Layer([string]$kind) {
    if (Get-LayerWindow $kind) {
        $script:failCount[$kind] = 0
        return $true
    }

    $last = $script:failAt[$kind]
    if ($null -ne $last -and ((Get-Date) - $last).TotalSeconds -lt (Get-BackoffSec $kind)) {
        return $false
    }

    $old = Get-LayerPid $kind
    if ($old -gt 0) {
        $age = 999.0
        try { $age = ((Get-Date) - (Get-Process -Id $old -ErrorAction Stop).StartTime).TotalSeconds } catch { }
        if ($age -lt 12) { return $false }   # 刚起来，再等等
        Log ($kind + ' 进程在但窗口没了（' + [int]$age + 's），重启它')
        Stop-Process -Id $old -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath (Get-PidFile $kind) -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
    }

    $ok = Start-LayerAndWait $kind
    if ($ok) {
        $script:failCount[$kind] = 0
        return $true
    }
    $n = 0
    if ($script:failCount.ContainsKey($kind)) { $n = [int]$script:failCount[$kind] }
    $script:failCount[$kind] = $n + 1
    $script:failAt[$kind] = Get-Date
    Log ($kind + ' 第 ' + ($n + 1) + ' 次失败，退避 ' + (Get-BackoffSec $kind) + ' 秒')
    return $false
}

# ---------- 检查 ----------
function Get-Status {
    $rows = @(Get-Rows)
    $overlays = @($rows | Where-Object { $_.title -eq 'FarmOverlay' })
    $petIdx = -1
    for ($i = 0; $i -lt $rows.Count; $i++) {
        if ($rows[$i].title -match '桌宠' -and (Test-PetPid $rows[$i].pid)) { $petIdx = $i; break }
    }
    $topOverlay = -1
    for ($i = 0; $i -lt $rows.Count; $i++) {
        if ($rows[$i].title -eq 'FarmOverlay') { $topOverlay = $i; break }
    }
    $above = ($topOverlay -ge 0 -and $petIdx -ge 0 -and $topOverlay -lt $petIdx)
    [pscustomobject]@{
        count   = $overlays.Count
        visible = @($overlays | Where-Object { $_.vis }).Count
        above   = $above
        pet     = $petIdx
        ok      = ($overlays.Count -ge 2 -and $above)
        order   = (($rows | Where-Object { $_.title -eq 'FarmOverlay' -or $_.title -match '桌宠' } |
                    ForEach-Object { $_.title + '(' + $_.pid + ')' }) -join ' > ')
    }
}

function Write-Status([object]$st) {
    if ($Quiet) { return }
    Write-Host ('图层窗口数=' + $st.count + '（可见 ' + $st.visible + '）')
    Write-Host ('窗口 z 序（上→下）: ' + $st.order)
    Write-Host ('前景层在桌宠之上: ' + $(if ($st.above) { '是' } else { '否' }))
}

# ---------- 停止 ----------
# 只停两块图层，不动守护自己（守护内部退出时用）
function Stop-Layers {
    foreach ($kind in 'bg', 'weeds') {
        $n = Get-LayerPid $kind
        if ($n -gt 0) {
            Log ('停 ' + $kind + ' pid=' + $n)
            Stop-Process -Id $n -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath (Get-PidFile $kind) -Force -ErrorAction SilentlyContinue
    }
    # 老版本留下的文件，清掉免得别的脚本误杀（注意：weeds.pid 现在是我们自己在用）
    foreach ($f in 'overlay.pid', 'layer-bg.pid', 'layer-weeds.pid') {
        Remove-Item -LiteralPath (Join-Path $rt $f) -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 300
}

function Stop-All {
    Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue

    $sup = Get-SupervisorPid
    if ($sup -gt 0) {
        Log ('停守护 pid=' + $sup)
        Stop-Process -Id $sup -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
    Remove-Item -LiteralPath $supFile -Force -ErrorAction SilentlyContinue
    Stop-Layers
}

# ---------- 桌宠 / App 存活 ----------
# 返回 0=桌宠窗口没了，1=有但被 hide() 藏起来了，2=看得见
function Get-PetPresence {
    $rows = @(Get-Rows)
    $pet = @($rows | Where-Object { $_.title -match '桌宠' -and (Test-PetPid $_.pid) }) | Select-Object -First 1
    if (-not $pet) { return 0 }
    if ($pet.vis) { return 2 }
    return 1
}

# World 每 5 秒写一次 state.json；这个时间戳就是 App 的"心跳"
function Get-WorldAgeSec {
    if (-not (Test-Path -LiteralPath $statePath)) { return 99999 }
    try {
        return ((Get-Date).ToUniversalTime() - (Get-Item -LiteralPath $statePath).LastWriteTimeUtc).TotalSeconds
    } catch { return 99999 }
}

# ---------- 编码 / 语法预检 ----------
# PowerShell 5.1 读 .ps1 的规则：有 UTF-8 BOM 就按 UTF-8；没有就按系统 ANSI（这里是 GBK）。
# 源码里有中文且丢了 BOM 时，进程会在写第一行日志前就静默退出 —— 表现就是"图层消失"。
# 这里用和 -File 完全一样的读取方式做预检，把这种问题变成一条看得见的日志。
function Test-ScriptEncoded([string]$path) {
    try {
        $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::Default)
        $errs = $null
        [void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$errs)
        if ($errs -and $errs.Count -gt 0) {
            return ('语法错误 第' + $errs[0].Extent.StartLineNumber + '行: ' + $errs[0].Message)
        }
        return ''
    } catch { return $_.Exception.Message }
}

# ---------- 守护循环 ----------
function Invoke-Supervise {
    $mutex = $null
    $owned = $false
    try {
        $mutex = New-Object System.Threading.Mutex($false, 'Local\CoopanionFarmLayersHost')
        try { $owned = $mutex.WaitOne(0) }
        catch [System.Threading.AbandonedMutexException] { $owned = $true }
    } catch { $owned = $true }   # 拿不到互斥体就靠 supervisor.json 兜底
    if (-not $owned) { Log '另一个守护进程已经在跑，本进程退出'; return }

    try {
        @{
            pid       = $PID
            startedAt = (Get-Date).ToString('o')
            script    = $script:scriptPath
            exe       = $psExe
        } | ConvertTo-Json | Set-Content -LiteralPath $supFile -Encoding utf8
        Log ('守护启动 pid=' + $PID)

        $bad = Test-ScriptEncoded $overlayScript
        if ($bad) { Log ('!! overlay.ps1 预检失败：' + $bad + '（多半是文件丢了 UTF-8 BOM）') }
        else { Log 'overlay.ps1 预检通过' }

        $lastFail = @{}
        $petSeen = $false
        $goneAt = $null
        $layersStopped = $false
        $lastAgeLog = Get-Date
        while (-not (Test-Path -LiteralPath $stopFile)) {
            if ($bad) {
                # 源码本身坏了，怎么重启都没用；等它被修好
                Start-Sleep -Seconds 5
                $bad = Test-ScriptEncoded $overlayScript
                continue
            }

            # 1) 桌宠窗口：看得见 / 被藏起来 / 没了
            $presence = Get-PetPresence
            if ($presence -ne 0) {
                $petSeen = $true
                $goneAt = $null
            } elseif ($null -eq $goneAt) {
                $goneAt = Get-Date
            }
            $goneSec = 0.0
            if ($null -ne $goneAt) { $goneSec = ((Get-Date) - $goneAt).TotalSeconds }

            # 2) 桌宠没了 + World 也不再写 state.json = App 退出了。
            #    只看 state.json 不够：电脑睡眠时 World 的定时器也会停，但桌宠窗口还在，
            #    那种情况不能把图层收掉。
            if ($presence -eq 0) {
                $worldAge = Get-WorldAgeSec
                if ($worldAge -gt $AppGoneSec) {
                    Log ('桌宠不在，World 也 ' + [int]$worldAge + ' 秒没写 state.json（App 退出了），停止图层并退出守护')
                    Stop-Layers
                    break
                }
            }

            # 3) 桌宠曾经在、现在窗口没了（托盘"关闭"或 App 正在退）：
            #    先把两块图层停掉省资源；守护继续等 —— 桌宠再出现就自动拉起来。
            if ($presence -eq 0 -and $petSeen -and $goneSec -ge $PetGoneSec) {
                if (-not $layersStopped) {
                    Log ('桌宠窗口没了 ' + [int]$goneSec + ' 秒，停掉两块图层（守护继续等它回来）')
                    Stop-Layers
                    $layersStopped = $true
                }
                Start-Sleep -Milliseconds 1000
                continue
            }

            if ($presence -ne 0 -and $layersStopped) {
                Log '桌宠回来了，重新拉起两块图层'
                $layersStopped = $false
            }

            # 桌宠"曾经在、现在没了"：别补层（补了也会因为 owned window 失效再死一次），
            # 等它回来或者等 App 退出的判断生效。启动阶段"还没见过桌宠"时允许先把层起好（隐藏待命）。
            if ($presence -eq 0 -and $petSeen) {
                Start-Sleep -Milliseconds 800
                continue
            }

            # 4) 正常：缺哪块补哪块。桌宠只是被隐藏（presence=1）时也保持进程，
            #    图层自己会跟着隐藏/显示，回来是瞬间的。
            foreach ($kind in 'bg', 'weeds') {
                if (Test-Path -LiteralPath $stopFile) { break }
                try {
                    if (-not (Ensure-Layer $kind)) {
                        $now = Get-Date
                        if (-not $lastFail.ContainsKey($kind) -or ($now - $lastFail[$kind]).TotalSeconds -gt 60) {
                            $lastFail[$kind] = $now
                            Log ($kind + ' 暂时起不来（已退避，稍后重试）')
                        }
                    } elseif ($lastFail.ContainsKey($kind)) {
                        $lastFail.Remove($kind)
                    }
                } catch {
                    Log ($kind + ' 守护出错: ' + $_.Exception.Message)
                }
            }
            Start-Sleep -Milliseconds 1500
        }
        Log '收到 stop，守护退出'
    } finally {
        try { Remove-Item -LiteralPath $supFile -Force -ErrorAction SilentlyContinue } catch { }
        try { if ($mutex) { $mutex.ReleaseMutex() } } catch { }
    }
}

# ---------- 主入口 ----------
if ($Check) {
    $st = Get-Status
    Write-Status $st
    if ($st.ok) { exit 0 }
    exit 1
}

if ($Stop) {
    Stop-All
    if (-not $Quiet) { Write-Host '两块图层已停止' }
    exit 0
}

if ($Supervise) {
    Invoke-Supervise
    exit 0
}

if ($Restart) {
    if (-not $Quiet) { Write-Host '停止旧图层…' }
    Stop-All
}

# 源码预检：中文源码丢了 BOM 时 PowerShell 5.1 会静默起不来，先在这里说清楚
$bad = Test-ScriptEncoded $overlayScript
if ($bad) {
    Log ('overlay.ps1 预检失败：' + $bad)
    Write-Host ('!! overlay.ps1 预检失败：' + $bad)
    Write-Host '   把 .ps1 存成 UTF-8 with BOM 再试（tools\fix-encoding.ps1 可以一键修）'
    exit 1
}

# 默认 / -Ensure：幂等确保。绝不因为"已经在跑"而重启。
$supPid = Get-SupervisorPid
if ($supPid -le 0) {
    Remove-Item -LiteralPath $supFile -Force -ErrorAction SilentlyContinue
    $newSup = Start-Hidden @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoLogo', '-File', $script:scriptPath, '-Supervise')
    Log ('拉起守护 pid=' + $newSup)
    if (-not $Quiet) { Write-Host ('守护进程已拉起 pid=' + $newSup) }
} elseif (-not $Quiet) {
    Write-Host ('守护进程在跑 pid=' + $supPid + '（只补缺的，不重启）')
}

$deadline = (Get-Date).AddSeconds($WaitSec)
$st = Get-Status
while ((Get-Date) -lt $deadline) {
    if ($st.ok) { break }
    Start-Sleep -Milliseconds 400
    $st = Get-Status
}

Write-Status $st
if ($st.ok) { exit 0 }
exit 1
