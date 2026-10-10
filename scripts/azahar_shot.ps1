# Captures the main window of a process (or the whole screen) to a PNG.
param([int]$ProcessId = 0, [string]$Out = "$env:TEMP\claude\s\shot.png")
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[Win]::SetProcessDPIAware() | Out-Null
$rect = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($ProcessId -ne 0) {
  $p = Get-Process -Id $ProcessId -ErrorAction Stop
  $h = $p.MainWindowHandle
  if ($h -ne [IntPtr]::Zero) {
    [Win]::SetForegroundWindow($h) | Out-Null
    Start-Sleep -Milliseconds 300
    $r = New-Object Win+RECT
    [Win]::GetWindowRect($h, [ref]$r) | Out-Null
    $rect = New-Object System.Drawing.Rectangle $r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T)
  }
}
$bmp = New-Object System.Drawing.Bitmap $rect.Width, $rect.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Location, [System.Drawing.Point]::Empty, $rect.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"$Out $($rect.Width)x$($rect.Height)"
