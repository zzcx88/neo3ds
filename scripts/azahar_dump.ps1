# Holds L and R together in Azahar (Q + W), which makes the engine write sdmc:/neo3ds/vdump_NN.bin
# (in %APPDATA%\Azahar\sdmc\neo3ds). Convert it with scripts/vdump_png.py.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class K2 {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$p = Get-Process azahar -ErrorAction Stop
[K2]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 300
[K2]::keybd_event([byte][char]'Q', 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 100
[K2]::keybd_event([byte][char]'W', 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 200
[K2]::keybd_event([byte][char]'W', 0, 2, [UIntPtr]::Zero)
[K2]::keybd_event([byte][char]'Q', 0, 2, [UIntPtr]::Zero)
