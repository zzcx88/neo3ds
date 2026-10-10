# Clicks inside the Azahar window (a touch-screen tap when the point is on the bottom screen).
# usage: azahar_tap.ps1 -X 640 -Y 420   (coordinates relative to the window, as in azahar_shot.ps1 captures)
param([int]$X, [int]$Y)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class M {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
}
"@
$p = Get-Process azahar -ErrorAction Stop
[M]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
$r = New-Object M+RECT
[M]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
Start-Sleep -Milliseconds 200
[M]::SetCursorPos($r.L + $X, $r.T + $Y) | Out-Null
[M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 150
[M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
