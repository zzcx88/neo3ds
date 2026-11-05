# Sends held key presses to Azahar. usage: keys.ps1 "M:200,wait:1500,A:150"
param([string]$Seq)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class K {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$p = Get-Process azahar -ErrorAction Stop
[K]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 300
foreach ($step in $Seq.Split(",")) {
  $k, $ms = $step.Split(":")
  if ($k -eq "wait") { Start-Sleep -Milliseconds ([int]$ms); continue }
  # The keys go to whichever window is in front: never to anything but Azahar
  if ([K]::GetForegroundWindow() -ne $p.MainWindowHandle) { throw "Azahar is not the window in front: no key sent" }
  $vk = [byte][char]$k.ToUpper()
  [K]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds ([int]$ms)
  [K]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 150
}
