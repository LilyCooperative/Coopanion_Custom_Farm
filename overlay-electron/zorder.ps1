# Keep the three Electron farm windows in the same z-order relationship as the
# old WPF layers:
#   top -> owned by the pet window (Windows keeps an owned window above its owner)
#   mid -> directly behind the pet window
#   bg  -> directly behind mid
param(
    [Parameter(Mandatory = $true)][string]$Bg,
    [Parameter(Mandatory = $true)][string]$Mid,
    [Parameter(Mandatory = $true)][string]$Top
)

$ErrorActionPreference = 'SilentlyContinue'
$bgPtr = [IntPtr]([Int64]$Bg)
$midPtr = [IntPtr]([Int64]$Mid)
$topPtr = [IntPtr]([Int64]$Top)
$script:owner = [IntPtr]::Zero
$script:bgPet = [IntPtr]::Zero
$script:fullscreen = $false
$script:midPet = [IntPtr]::Zero

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FarmZ {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr h, int n, IntPtr v);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFO info);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct MONITORINFO {
        public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    }
    public const int GWL_STYLE = -16;
    public const int WS_CAPTION = 0x00C00000;
    public const int SW_HIDE = 0;
    public const int SW_SHOWNOACTIVATE = 4;
    public const uint MONITOR_DEFAULTTONEAREST = 2;
    /** 返回目标窗口所在显示器上是否有前台全屏窗口（排除本图层自己的句柄）。 */
    public static bool HasFullscreen(IntPtr overlay, IntPtr bg, IntPtr mid, IntPtr top) {
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero || fg == overlay || fg == bg || fg == mid || fg == top) return false;
        IntPtr mon = MonitorFromWindow(overlay, MONITOR_DEFAULTTONEAREST);
        if (MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST) != mon) return false;
        MONITORINFO mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(mon, ref mi)) return false;
        RECT r;
        if (!GetWindowRect(fg, out r)) return false;
        if (r.Left > mi.rcMonitor.Left + 2 || r.Top > mi.rcMonitor.Top + 2 ||
            r.Right < mi.rcMonitor.Right - 2 || r.Bottom < mi.rcMonitor.Bottom - 2) return false;
        // 普通最大化窗口仍带标题栏；全屏游戏/视频通常没有 WS_CAPTION。
        if (IsZoomed(fg) && (GetWindowLong(fg, GWL_STYLE) & WS_CAPTION) == WS_CAPTION) return false;
        return true;
    }
    public const uint GW_HWNDPREV = 3;
    public const uint GW_OWNER = 4;
    public const int GWLP_HWNDPARENT = -8;
    public const uint SWP_NOSIZE = 0x1;
    public const uint SWP_NOMOVE = 0x2;
    public const uint SWP_NOACTIVATE = 0x10;
    public static IntPtr FindPet(bool visibleOnly) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            if (visibleOnly && !IsWindowVisible(h)) return true;
            StringBuilder sb = new StringBuilder(512);
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
}
'@

while ([FarmZ]::IsWindow($bgPtr) -and [FarmZ]::IsWindow($midPtr) -and [FarmZ]::IsWindow($topPtr)) {
    $full = [FarmZ]::HasFullscreen($bgPtr, $bgPtr, $midPtr, $topPtr)
    if ($full -ne $script:fullscreen) {
        $script:fullscreen = $full
        foreach ($h in @($bgPtr, $midPtr, $topPtr)) {
            [void][FarmZ]::ShowWindow($h, $(if ($full) { [FarmZ]::SW_HIDE } else { [FarmZ]::SW_SHOWNOACTIVATE }))
        }
        # 重新显示后强制跑一次 owner / z-order 校正。
        if (-not $full) {
            $script:owner = [IntPtr]::Zero
            $script:midPet = [IntPtr]::Zero
            $script:bgPet = [IntPtr]::Zero
        }
    }
    if ($full) {
        Start-Sleep -Milliseconds 500
        continue
    }
    $pet = [FarmZ]::FindPet($false)
    if ($pet -ne [IntPtr]::Zero) {
        if ($script:owner -ne $pet -or [FarmZ]::GetWindow($topPtr, [FarmZ]::GW_OWNER) -ne $pet) {
            [void][FarmZ]::SetWindowLongPtr($topPtr, [FarmZ]::GWLP_HWNDPARENT, $pet)
            $script:owner = $pet
        }
        if ($script:midPet -ne $pet -or [FarmZ]::GetWindow($midPtr, [FarmZ]::GW_HWNDPREV) -ne $pet) {
            [void][FarmZ]::SetWindowPos($midPtr, $pet, 0, 0, 0, 0,
                ([FarmZ]::SWP_NOMOVE -bor [FarmZ]::SWP_NOSIZE -bor [FarmZ]::SWP_NOACTIVATE))
            $script:midPet = $pet
        }
        if ($script:bgPet -ne $pet -or [FarmZ]::GetWindow($bgPtr, [FarmZ]::GW_HWNDPREV) -ne $midPtr) {
            [void][FarmZ]::SetWindowPos($bgPtr, $midPtr, 0, 0, 0, 0,
                ([FarmZ]::SWP_NOMOVE -bor [FarmZ]::SWP_NOSIZE -bor [FarmZ]::SWP_NOACTIVATE))
            $script:bgPet = $pet
        }
    }
    Start-Sleep -Milliseconds 500
}



