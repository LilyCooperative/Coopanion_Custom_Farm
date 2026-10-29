# Keep the two Electron farm windows in the same z-order relationship as the
# old WPF layers:
#   bg  -> directly below the pet window
#   top -> owned by the pet window (Windows keeps an owned window above its owner)
param(
    [Parameter(Mandatory = $true)][string]$Bg,
    [Parameter(Mandatory = $true)][string]$Top
)

$ErrorActionPreference = 'SilentlyContinue'
$bgPtr = [IntPtr]([Int64]$Bg)
$topPtr = [IntPtr]([Int64]$Top)
$script:owner = [IntPtr]::Zero

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

while ([FarmZ]::IsWindow($bgPtr) -and [FarmZ]::IsWindow($topPtr)) {
    $pet = [FarmZ]::FindPet($false)
    if ($pet -ne [IntPtr]::Zero) {
        if ($script:owner -ne $pet) {
            [void][FarmZ]::SetWindowLongPtr($topPtr, [FarmZ]::GWLP_HWNDPARENT, $pet)
            $script:owner = $pet
        }
        [void][FarmZ]::SetWindowPos($bgPtr, $pet, 0, 0, 0, 0,
            ([FarmZ]::SWP_NOMOVE -bor [FarmZ]::SWP_NOSIZE -bor [FarmZ]::SWP_NOACTIVATE))
    }
    Start-Sleep -Milliseconds 500
}



