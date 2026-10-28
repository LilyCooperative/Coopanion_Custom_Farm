<#
  Regression test for the desktop layers (ASCII only on purpose, so it can
  never be broken by the BOM problem it is meant to catch).

  Covers:
    1. -Restart brings up exactly two FarmOverlay windows
    2. both stay up for 10 s (the old "background vanishes after ~35 s" bug)
    3. kill the background layer  -> supervisor restarts it, background only
    4. kill the weeds layer       -> supervisor restarts it
    5. kill the supervisor        -> layers survive; -Ensure starts a new
                                     supervisor that adopts the running layers
    6. no console window is ever created for the layers / supervisor
    7. -Stop leaves nothing behind, -Check returns 1

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\test-layers.ps1
    ... -KeepRunning        leave the layers running at the end (default: yes)
#>
param(
    [switch]$NoKeepRunning,
    [int]$StabilitySec = 10
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$layers = Join-Path $root 'restart-layers.ps1'
$rt = Join-Path $root 'runtime'
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

$script:fails = 0
function Pass([string]$m) { Write-Host ('  PASS  ' + $m) -ForegroundColor Green }
function Fail([string]$m) { Write-Host ('  FAIL  ' + $m) -ForegroundColor Red; $script:fails++ }
function Info([string]$m) { Write-Host ('        ' + $m) -ForegroundColor DarkGray }

function Run-Layers {
    param([string[]]$LayersArgs)
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $layers @LayersArgs | Out-Null
    return $LASTEXITCODE
}

function Get-PidFrom([string]$kind) {
    $f = Join-Path $rt ($kind + '.pid')
    if (-not (Test-Path -LiteralPath $f)) { return 0 }
    $v = ((Get-Content -LiteralPath $f -Raw) -as [string])
    if ($null -eq $v) { return 0 }
    $v = $v.Trim()
    if ($v -notmatch '^\d+$') { return 0 }
    return [int]$v
}

function Test-Alive([int]$procId) {
    if ($procId -le 0) { return $false }
    return [bool](Get-Process -Id $procId -ErrorAction SilentlyContinue)
}

function Wait-Check([int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if ((Run-Layers @('-Check', '-Quiet')) -eq 0) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Wait-NewPid([string]$kind, [int]$oldPid, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $n = Get-PidFrom $kind
        if ($n -gt 0 -and $n -ne $oldPid -and (Test-Alive $n)) { return $n }
        Start-Sleep -Milliseconds 500
    }
    return 0
}

function Get-SupPid {
    $f = Join-Path $rt 'supervisor.json'
    if (-not (Test-Path -LiteralPath $f)) { return 0 }
    try { return [int](Get-Content -LiteralPath $f -Raw | ConvertFrom-Json).pid } catch { return 0 }
}

function Wait-SupPid([int]$notThis, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $n = Get-SupPid
        if ($n -gt 0 -and $n -ne $notThis -and (Test-Alive $n)) { return $n }
        Start-Sleep -Milliseconds 300
    }
    return 0
}

# ---- console-window probe ----
if (-not ('LayerTestWin' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class LayerTestWin {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowTextW(IntPtr h, string s);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    public static string[] ConsolesFor(string pidsCsv) {
        var want = new HashSet<string>(pidsCsv.Split(','));
        var res = new List<string>();
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (!want.Contains(pid.ToString())) return true;
            var c = new StringBuilder(256); GetClassNameW(h, c, 256);
            string cls = c.ToString();
            if (cls == "ConsoleWindowClass" || cls == "PseudoConsoleWindow") {
                res.Add(pid + "|" + cls);
            }
            return true;
        }, IntPtr.Zero);
        return res.ToArray();
    }
    // pet window title contains U+684C U+5BA0 ("\u684C\u5BA0"); kept as escapes so this file stays ASCII
    public static IntPtr PetHwnd() {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            var s = new StringBuilder(512); GetWindowTextW(h, s, 512);
            if (s.ToString().IndexOf("\u684C\u5BA0") < 0) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            try {
                if (!System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.StartsWith("Coopanion")) return true;
            } catch { return true; }
            found = h; return false;
        }, IntPtr.Zero);
        return found;
    }
    public static string WindowTitle(IntPtr h) { var s = new StringBuilder(512); GetWindowTextW(h, s, 512); return s.ToString(); }
    public static bool SetTitle(IntPtr h, string s) { return SetWindowTextW(h, s); }
    public static bool IsVisible(IntPtr h) { return IsWindowVisible(h); }
    public static bool Show(IntPtr h, int cmd) { return ShowWindow(h, cmd); }
    public static int VisibleOverlays() {
        int n = 0;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            var s = new StringBuilder(512); GetWindowTextW(h, s, 512);
            if (s.ToString() == "FarmOverlay" && IsWindowVisible(h)) n++;
            return true;
        }, IntPtr.Zero);
        return n;
    }
}
"@
}

Write-Host ''
Write-Host '=== farm layers regression ===' -ForegroundColor Cyan

# 1) restart
$rc = Run-Layers @('-Restart', '-Quiet', '-WaitSec', '25')
if ($rc -eq 0) { Pass '-Restart: two layers up, weeds above pet' } else { Fail ('-Restart exit=' + $rc) }
$bg1 = Get-PidFrom 'bg'
$wd1 = Get-PidFrom 'weeds'
if ((Test-Alive $bg1) -and (Test-Alive $wd1)) { Pass ('both layer processes alive (bg=' + $bg1 + ' weeds=' + $wd1 + ')') }
else { Fail ('layer processes not alive (bg=' + $bg1 + ' weeds=' + $wd1 + ')') }
$sup1 = 0
$supFile = Join-Path $rt 'supervisor.json'
if (Test-Path -LiteralPath $supFile) {
    try { $sup1 = [int](Get-Content -LiteralPath $supFile -Raw | ConvertFrom-Json).pid } catch { }
}
if (Test-Alive $sup1) { Pass ('supervisor alive (pid=' + $sup1 + ')') } else { Fail 'supervisor not alive' }

# 2) stability
Start-Sleep -Seconds $StabilitySec
if ((Run-Layers @('-Check', '-Quiet')) -eq 0) { Pass ('still two layers after ' + $StabilitySec + 's') }
else { Fail ('layers lost within ' + $StabilitySec + 's') }
if ((Get-PidFrom 'bg') -eq $bg1 -and (Get-PidFrom 'weeds') -eq $wd1) { Pass 'no restart churn while healthy' }
else { Fail 'layer pids changed while healthy' }

# 3) background self-heal
Stop-Process -Id $bg1 -Force -ErrorAction SilentlyContinue
$bg2 = Wait-NewPid 'bg' $bg1 20
if ($bg2 -gt 0 -and (Wait-Check 10)) { Pass ('background layer self-healed (new pid=' + $bg2 + ')') }
else { Fail 'background layer did not self-heal' }

# 4) weeds self-heal
Stop-Process -Id $wd1 -Force -ErrorAction SilentlyContinue
$wd2 = Wait-NewPid 'weeds' $wd1 20
if ($wd2 -gt 0 -and (Wait-Check 10)) { Pass ('weeds layer self-healed (new pid=' + $wd2 + ')') }
else { Fail 'weeds layer did not self-heal' }

# 5) supervisor restart adopts surviving layers
if (Test-Alive $sup1) { Stop-Process -Id $sup1 -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800
$aliveBefore = ((Test-Alive (Get-PidFrom 'bg')) -and (Test-Alive (Get-PidFrom 'weeds')))
if ($aliveBefore) { Pass 'layers survive supervisor kill' } else { Fail 'layers died with supervisor' }
$rc = Run-Layers @('-Ensure', '-Quiet', '-WaitSec', '20')
$sup2 = Wait-SupPid $sup1 15
if ($rc -eq 0 -and $sup2 -gt 0 -and $sup2 -ne $sup1) { Pass ('new supervisor adopted layers (pid=' + $sup2 + ')') }
else { Fail ('ensure after supervisor kill failed (rc=' + $rc + ' sup=' + $sup2 + ')') }
if ((Get-PidFrom 'bg') -eq $bg2 -and (Get-PidFrom 'weeds') -eq $wd2) { Pass 'adoption did not restart healthy layers' }
else { Fail 'adoption restarted healthy layers' }

# 6) pet hidden -> overlays hidden; pet shown -> overlays visible
$pet = [LayerTestWin]::PetHwnd()
if ($pet -eq [IntPtr]::Zero) {
    Fail 'pet window not found (Coopanion must be running for this test)'
} else {
    [void][LayerTestWin]::Show($pet, 0)   # SW_HIDE
    try {
        Start-Sleep -Seconds 3
        $vis = [LayerTestWin]::VisibleOverlays()
        if ($vis -eq 0) { Pass 'overlays hidden when pet is hidden' } else { Fail ('overlays still visible (' + $vis + ') while pet hidden') }
    } finally {
        [void][LayerTestWin]::Show($pet, 4)   # SW_SHOWNOACTIVATE (always restore)
    }
    Start-Sleep -Seconds 3
    $vis = [LayerTestWin]::VisibleOverlays()
    if ($vis -eq 2) { Pass 'overlays shown when pet is shown' } else { Fail ('overlays not visible (' + $vis + ') after pet shown') }
}

# 7) pet window gone (tray "close") -> layers stop; pet back -> layers return
$pet = [LayerTestWin]::PetHwnd()
if ($pet -ne [IntPtr]::Zero) {
    $title = [LayerTestWin]::WindowTitle($pet)
    try {
        $sw7 = [Diagnostics.Stopwatch]::StartNew()
        while ($sw7.Elapsed.TotalSeconds -lt 8) {
            [void][LayerTestWin]::SetTitle($pet, 'Cortico-GONE-TEST')
            Start-Sleep -Milliseconds 200
        }
        $rc = Run-Layers @('-Check', '-Quiet')
        if ($rc -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $rt 'bg.pid'))) { Pass 'layers stopped when pet window went away' }
        else { Fail ('layers still up when pet gone (check=' + $rc + ')') }
    } finally {
        [void][LayerTestWin]::SetTitle($pet, $title)
    }
    $ok = $false
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        if ((Run-Layers @('-Check', '-Quiet')) -eq 0) { $ok = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if ($ok) { Pass 'layers came back when pet window returned' } else { Fail 'layers did not come back after pet returned' }
}

# 8) no console windows
Start-Sleep -Milliseconds 500
$sup3 = Get-SupPid
$all = @((Get-PidFrom 'bg'), (Get-PidFrom 'weeds'), $sup3) | Where-Object { $_ -gt 0 }
$consoles = @([LayerTestWin]::ConsolesFor(($all -join ',')))
if ($consoles.Count -eq 0) { Pass 'no console window on any layer process' }
else { Fail ('console windows found: ' + ($consoles -join ', ')) }

# 9) stop
$rc = Run-Layers @('-Stop', '-Quiet')
if ($rc -eq 0) { Pass '-Stop exit=0' } else { Fail ('-Stop exit=' + $rc) }
Start-Sleep -Seconds 1
if ((Run-Layers @('-Check', '-Quiet')) -eq 1) { Pass '-Check returns 1 when stopped' } else { Fail '-Check should return 1 when stopped' }

# 10) leave it running
if (-not $NoKeepRunning) {
    $rc = Run-Layers @('-Ensure', '-Quiet', '-WaitSec', '25')
    if ($rc -eq 0) { Pass 'layers left running' } else { Fail 'could not restart layers at the end' }
}

Write-Host ''
if ($script:fails -eq 0) {
    Write-Host 'ALL PASS' -ForegroundColor Green
    exit 0
}
Write-Host ('' + $script:fails + ' FAILED') -ForegroundColor Red
exit 1
