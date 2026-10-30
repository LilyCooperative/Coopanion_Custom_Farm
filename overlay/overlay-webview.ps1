# WebView2 host for the farm overlay.
# It renders the same overlay-electron/renderer.html + renderer.js as the
# Electron layer, so WPF fallback has the same geometry, sprites and effects.
param(
    [Parameter(Mandatory = $true)][string]$StatePath,
    [Parameter(Mandatory = $true)][string]$HomeDir,
    [Parameter(Mandatory = $true)][string]$AssetsDir,
    [string]$PidPath = '',
    [string]$LogPath = '',
    [int]$StripHeight = 320,
    [int]$LeaseSeconds = 20,
    [ValidateSet('bg', 'mid', 'top')][string]$Layer = 'bg',
    [ValidateSet('off', 'auto', 'on')][string]$Throttle = 'off'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function Write-Log([string]$s) {
    if (-not $LogPath) { return }
    try {
        $line = (Get-Date).ToString('o') + ' [webview] ' + $s
        Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    } catch { }
}
function Read-State {
    try { return Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}
function Write-Pid {
    if (-not $PidPath) { return }
    try {
        $dir = Split-Path -Parent $PidPath
        if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Set-Content -LiteralPath $PidPath -Value $PID -Encoding ascii
    } catch { }
}
function Clear-Pid {
    if (-not $PidPath) { return }
    try {
        if ((Get-Content -LiteralPath $PidPath -Raw -ErrorAction SilentlyContinue).Trim() -eq [string]$PID) {
            Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
        }
    } catch { }
}

$here = Split-Path -Parent $PSCommandPath
$dllDir = Join-Path $here 'webview2'
$env:PATH = $dllDir + ';' + $env:PATH
Add-Type -Path (Join-Path $dllDir 'Microsoft.Web.WebView2.Core.dll')
Add-Type -Path (Join-Path $dllDir 'Microsoft.Web.WebView2.Wpf.dll')

if (-not (Test-Path -LiteralPath $AssetsDir)) { throw ('assets dir not found: ' + $AssetsDir) }
if (-not (Test-Path -LiteralPath $StatePath)) { throw ('state not found: ' + $StatePath) }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FarmWebViewWin32 {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    public const uint GW_HWNDPREV = 3;
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr value);
    public const int GWLP_HWNDPARENT = -8;
    public static IntPtr FindPet(bool visibleOnly) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            if (visibleOnly && !IsWindowVisible(h)) return true;
            var sb = new System.Text.StringBuilder(512);
            GetWindowTextW(h, sb, 512);
            if (sb.ToString().IndexOf("桌宠") < 0) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            try {
                if (System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.StartsWith("Coopanion")) { found = h; return false; }
            } catch { }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static IntPtr FindTitle(string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            var sb = new System.Text.StringBuilder(512);
            GetWindowTextW(h, sb, 512);
            if (sb.ToString() == title) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public const uint SWP_NOSIZE = 0x1;
    public const uint SWP_NOMOVE = 0x2;
    public const uint SWP_NOACTIVATE = 0x10;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TRANSPARENT = 0x20;
    public static bool TopMost(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return false;
        return SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | 0x40);
    }
    public static void MakeClickThrough(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return;
        int ex = GetWindowLong(hWnd, GWL_EXSTYLE);
        SetWindowLong(hWnd, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT);
        EnumChildWindows(hWnd, (h, l) => {
            int e = GetWindowLong(h, GWL_EXSTYLE);
            SetWindowLong(h, GWL_EXSTYLE, e | WS_EX_TRANSPARENT);
            return true;
        }, IntPtr.Zero);
    }
}
'@

$script:owner = [IntPtr]::Zero
$script:bgPet = [IntPtr]::Zero
$script:midPet = [IntPtr]::Zero
function Update-PetZOrder {
    try {
        $h = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
        if ($h -eq [IntPtr]::Zero) { return }
        $pet = [FarmWebViewWin32]::FindPet($false)
        if ($pet -eq [IntPtr]::Zero) { return }
        if ($Layer -eq 'top') {
            if ($script:owner -ne $pet) {
                [void][FarmWebViewWin32]::SetWindowLongPtr($h, [FarmWebViewWin32]::GWLP_HWNDPARENT, $pet)
                $script:owner = $pet
            }
        } elseif ($Layer -eq 'mid') {
            if ($script:midPet -ne $pet -or [FarmWebViewWin32]::GetWindow($h, [FarmWebViewWin32]::GW_HWNDPREV) -ne $pet) {
                [void][FarmWebViewWin32]::SetWindowPos($h, $pet, 0, 0, 0, 0,
                    ([FarmWebViewWin32]::SWP_NOMOVE -bor [FarmWebViewWin32]::SWP_NOSIZE -bor [FarmWebViewWin32]::SWP_NOACTIVATE))
                $script:midPet = $pet
            }
        } else {
            $mid = [FarmWebViewWin32]::FindTitle('CoopanionFarm-mid')
            $target = if ($mid -ne [IntPtr]::Zero) { $mid } else { $pet }
            if ($script:bgPet -ne $target -or [FarmWebViewWin32]::GetWindow($h, [FarmWebViewWin32]::GW_HWNDPREV) -ne $target) {
                [void][FarmWebViewWin32]::SetWindowPos($h, $target, 0, 0, 0, 0,
                    ([FarmWebViewWin32]::SWP_NOMOVE -bor [FarmWebViewWin32]::SWP_NOSIZE -bor [FarmWebViewWin32]::SWP_NOACTIVATE))
                $script:bgPet = $target
            }
        }
    } catch { }
}

$state = Read-State
$h = [Math]::Min(800, [Math]::Max(120, $(if ($null -ne $state.stripHeight) { [int]$state.stripHeight } else { $StripHeight })))
$wa = [System.Windows.SystemParameters]::WorkArea

$win = New-Object System.Windows.Window
$win.Width = [Math]::Max(1, $wa.Width)
$win.Height = $h
$win.Left = $wa.Left
$win.Top = $wa.Top + $wa.Height - $h
$win.WindowStyle = 'None'
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.Topmost = $true
$win.ShowInTaskbar = $false
$win.Title = 'CoopanionFarm-' + $Layer
$win.ResizeMode = 'NoResize'
$win.Focusable = $false

$wv = New-Object Microsoft.Web.WebView2.Wpf.WebView2
$wv.DefaultBackgroundColor = [System.Drawing.Color]::Transparent
$props = New-Object Microsoft.Web.WebView2.Wpf.CoreWebView2CreationProperties
$ud = Join-Path (Split-Path -Parent $StatePath) ('webview2-' + $Layer)
New-Item -ItemType Directory -Path $ud -Force | Out-Null
$props.UserDataFolder = $ud
if ($Throttle -eq 'off') {
    $props.AdditionalBrowserArguments = '--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion'
}
$wv.CreationProperties = $props
$win.Content = $wv

$wv.add_NavigationCompleted({
    param($s, $e)
    Write-Log ('navigation completed success=' + $e.IsSuccess + ' status=' + $e.WebErrorStatus)
})
$wv.add_CoreWebView2InitializationCompleted({
    param($s, $e)
    Write-Log ('core initialized success=' + $e.IsSuccess)
    if ($e.IsSuccess) {
        try { $wv.CoreWebView2.add_ConsoleMessageReceived({ param($cs, $ce) Write-Log ('console: ' + $ce.Message) }) } catch { }
    }
})

Write-Pid
$win.Show()

$script:coreTask = $null
$script:navigated = $false
$script:lastMtime = 0
$script:lastHeight = $h
$script:lastLease = Get-Date
$script:lastStateMtime = (Get-Item -LiteralPath $StatePath).LastWriteTimeUtc
$script:bootApply = 30
$script:zTick = 0

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(100)
$timer.add_Tick({
    try {
        if ($null -eq $script:coreTask) {
            $script:coreTask = $wv.EnsureCoreWebView2Async()
            Write-Log 'initializing'
            return
        }
        if ($script:coreTask.Status -eq 'Faulted') {
            Write-Log ('init failed: ' + $script:coreTask.Exception.InnerException.Message)
            $win.Close()
            [System.Windows.Threading.Dispatcher]::ExitAllFrames()
            return
        }
        if ($script:coreTask.Status -ne 'RanToCompletion') { return }
        if (-not $script:navigated) {
            $script:navigated = $true
            $wv.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
            $wv.CoreWebView2.Settings.AreDevToolsEnabled = $false
            $wv.CoreWebView2.SetVirtualHostNameToFolderMapping('farm.local', $HomeDir, [Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind]::Allow)
            $wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("window.__farmHost=true;window.__farmAssetsBase='https://farm.local/assets/sprites/';") | Out-Null
            $wv.Source = [Uri]('https://farm.local/overlay-electron/renderer.html?layer=' + $Layer)
            $hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
            [FarmWebViewWin32]::MakeClickThrough($hwnd)
            $top = [FarmWebViewWin32]::TopMost($hwnd)
            Update-PetZOrder
            Write-Log ('navigating layer=' + $Layer + ' hwnd=' + $hwnd + ' top=' + $top + ' visible=' + $win.IsVisible + ' top=' + $win.Top + ' left=' + $win.Left + ' w=' + $win.ActualWidth + ' h=' + $win.ActualHeight)
            $rc = New-Object FarmWebViewWin32+RECT
            if ([FarmWebViewWin32]::GetWindowRect($hwnd, [ref]$rc)) {
                Write-Log ('window rect ' + $rc.Left + ',' + $rc.Top + ' ' + ($rc.Right - $rc.Left) + 'x' + ($rc.Bottom - $rc.Top))
            }
            return
        }

        $script:zTick++
        if (($script:zTick % 5) -eq 0) { Update-PetZOrder }
        $mtime = (Get-Item -LiteralPath $StatePath).LastWriteTimeUtc
        $force = $script:bootApply -gt 0
        if ($force) { $script:bootApply-- }
        if ($force -or $mtime -ne $script:lastStateMtime) {
            $script:lastStateMtime = $mtime
            $json = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8
            if ($json) { $wv.CoreWebView2.ExecuteScriptAsync('window.__farmApplyState(' + $json + ');') | Out-Null }
            $st = Read-State
            $nh = [Math]::Min(800, [Math]::Max(120, $(if ($null -ne $st.stripHeight) { [int]$st.stripHeight } else { $StripHeight })))
            if ($nh -ne $script:lastHeight) {
                $script:lastHeight = $nh
                $win.Height = $nh
                $win.Top = $wa.Top + $wa.Height - $nh
            }
        }        if (((Get-Date) - $script:lastLease).TotalSeconds -ge 5) {
            $script:lastLease = Get-Date
            if ($LeaseSeconds -gt 0 -and ((([DateTime]::UtcNow) - $mtime).TotalSeconds -gt $LeaseSeconds)) {
                Write-Log 'state lease expired'
                $win.Close()
                [System.Windows.Threading.Dispatcher]::ExitAllFrames()
                return
            }
            $hwnd2 = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
            [FarmWebViewWin32]::MakeClickThrough($hwnd2)
            if ($Layer -eq 'top') { [void][FarmWebViewWin32]::TopMost($hwnd2) }
            Update-PetZOrder
        }
    } catch {
        Write-Log ('tick failed: ' + $_.Exception.Message)
        try { $win.Close() } catch { }
        [System.Windows.Threading.Dispatcher]::ExitAllFrames()
    }
})
$win.add_Closed({
    $timer.Stop()
    Clear-Pid
    [System.Windows.Threading.Dispatcher]::ExitAllFrames()
})
$timer.Start()
[System.Windows.Threading.Dispatcher]::Run()


