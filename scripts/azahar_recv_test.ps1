# Azahar test of the launcher's receive screen (issue #256): builds the launcher with
# NEO3DS_RECV_TEST (the address comes from sdmc:/3ds/neo3ds/recv_url.txt instead of a QR code),
# serves a game file with scripts/recv_test_server.py and presses the buttons in Azahar.
#
# usage: pwsh scripts/azahar_recv_test.ps1 -Pack <file.neo3ds> [-Converter <folder with Neo3dsConverter.exe>]
#        [-Scenarios ok,404,...] [-SkipBuild]
# Results: out/recvtest/results.txt and one screenshot per scenario. The test file goes in Azahar's
# SD card folder as recvtest.neo3ds and is deleted at the end; launcher.txt is put back.
param(
    [Parameter(Mandatory)] [string] $Pack,
    [string] $Converter = "out/conv141",
    [string[]] $Scenarios = @("badurl", "404", "405", "redirect", "nolength", "chunked", "twolengths", "truncheader", "huge", "nospace", "short", "corrupt", "ok", "replace-no", "replace-yes", "cancel", "spacename", "empty"),
    [switch] $SkipBuild
)
$ErrorActionPreference = "Stop"
$Scenarios = $Scenarios -split "," # powershell -File passes "a,b" as one string
$root =Split-Path $PSScriptRoot -Parent
$out = Join-Path $root "out/recvtest"
$sd = Join-Path $env:APPDATA "Azahar/sdmc"
$games = Join-Path $sd "neo3ds/games"
$cfg = Join-Path $sd "3ds/neo3ds"
$target = Join-Path $games "recvtest.neo3ds"
$log = Join-Path $cfg "receive.log"
$azahar = Join-Path $root "tools/azahar/azahar-windows-msvc-2126.2/azahar.exe"
$py = (Get-Command py).Source
$server = Join-Path $root "scripts/recv_test_server.py"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

function Press([byte] $vk) {
    $p = Get-Process azahar
    [Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 200
    # The keys go to whichever window is in front: never to anything but Azahar
    if ([Win]::GetForegroundWindow() -ne $p.MainWindowHandle) { throw "Azahar is not the window in front" }
    [Win]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 150
    [Win]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 300
}
# Azahar's default keys: A = A, B = S, Y = X, D-pad down = G
$KeyA = 0x41; $KeyB = 0x53; $KeyY = 0x58; $KeyDown = 0x47

function Shot([string] $name) {
    $p = Get-Process azahar
    $r = New-Object Win+RECT
    [Win]::GetWindowRect($p.MainWindowHandle, [ref] $r) | Out-Null
    $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
    $bmp.Save((Join-Path $out "$name.png"))
    $g.Dispose(); $bmp.Dispose()
}

function LastLog {
    if (Test-Path $log) { (Get-Content $log -Tail 1) } else { "(no log)" }
}

function WaitLog([int] $before, [int] $seconds) {
    for ($i = 0; $i -lt $seconds * 2; $i++) {
        if ((Test-Path $log) -and (Get-Content $log).Count -gt $before) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

New-Item -ItemType Directory -Force $out | Out-Null
if (-not $SkipBuild) {
    $ErrorActionPreference = "Continue" # the compiler's warnings arrive on stderr
    & "C:\devkitPro\msys2\usr\bin\bash.exe" -lc "cd '$($root -replace '\\','/')/engine' && export DEVKITPRO=/opt/devkitpro DEVKITARM=/opt/devkitpro/devkitARM && LANG=C make BUILD=build_recv TARGET=engine_recv EXTRA_CFLAGS=-DNEO3DS_RECV_TEST" *> (Join-Path $out "build.log")
    $built = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($built) { throw "engine build failed: see out/recvtest/build.log" }
    $conv = Join-Path $out "conv"
    if (Test-Path $conv) { Remove-Item -Recurse -Force $conv }
    Copy-Item -Recurse (Join-Path $root $Converter) $conv
    Copy-Item (Join-Path $root "engine/engine_recv.elf") (Join-Path $conv "tools/engine.elf") -Force
    $env:NEO3DS_CXI = "1"
    & (Join-Path $conv "Neo3dsConverter.exe") --launcher $out | Select-Object -Last 1
}
$cxi = Join-Path $out "neo3ds-launcher.cxi"
if (-not (Test-Path $cxi)) { throw "no $cxi" }

New-Item -ItemType Directory -Force $games, $cfg | Out-Null
$configBackup = $null
if (Test-Path "$cfg/launcher.txt") { $configBackup = Get-Content -Raw "$cfg/launcher.txt" }
[IO.File]::WriteAllText("$cfg/launcher.txt", "tab=0`nfav=kof98.neo3ds`n")
Remove-Item $target, "$target.part", "$target.bak" -ErrorAction SilentlyContinue
if (Test-Path $log) { Remove-Item $log }

Stop-Process -Name azahar -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-Process $azahar -ArgumentList "`"$cxi`""
Start-Sleep -Seconds 8

$results = @()
$hash = (Get-FileHash $Pack).Hash
$badUrls = @(
    "https://192.0.2.1:80/x/a.neo3ds",        # not http
    "http://example.com:80/x/a.neo3ds",       # not IPv4 numbers
    "http://192.0.2.1/x/a.neo3ds",            # no port
    "http://127.0.0.1:80/x/a.neo3ds",         # this 3DS
    "http://224.0.0.1:80/x/a.neo3ds",         # multicast
    "http://0.0.0.0:80/x/a.neo3ds",           # no one
    "http://192.0.2.1:80/x/a.cia",            # not a game file
    "http://192.0.2.1:80/x/..%2Fa.neo3ds",    # a folder in the name
    "http://192.0.2.1:80/x/a%00.neo3ds",      # NUL
    "http://192.0.2.1:80/x/a%2.neo3ds",       # bad escape
    "http://192.0.2.1:80/x/a%3A.neo3ds",      # a character FAT refuses
    "http://192.0.2.1:80/x/$('a' * 100).neo3ds" # 107 bytes: .part would not fit
)
try {
    foreach ($s in $Scenarios) {
        if ($s -eq "badurl") {
            foreach ($u in $badUrls) {
                $before = if (Test-Path $log) { (Get-Content $log).Count } else { 0 }
                [IO.File]::WriteAllText((Join-Path $cfg "recv_url.txt"), "$u`n")
                Press $KeyY
                $finished = WaitLog $before 5
                Shot $s
                Press $KeyA
                $ok = $finished -and (LastLog) -match " refused "
                $results += "badurl $($u.Substring(0, [Math]::Min(44, $u.Length))) : $(if ($ok) { 'PASS' } else { 'FAIL' }) | $(LastLog)"
                $results[-1]
            }
            continue
        }
        if ($s -eq "spacename") {
            $spaced = Join-Path $games "recv test.neo3ds"
            $urlFile = Join-Path $cfg "recv_url.txt"
            $srv = Start-Process $py -ArgumentList @("-I", $server, $Pack, "--name", "`"recv test.neo3ds`"", "--url-file", $urlFile) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out "server-$s.log")
            Start-Sleep -Seconds 1
            $before = (Get-Content $log).Count
            Press $KeyY
            $finished = WaitLog $before 120
            Start-Sleep -Seconds 1
            Press $KeyA
            $ok = $finished -and (Test-Path $spaced) -and (Get-FileHash $spaced).Hash -eq $hash
            $results += "$s : $(if ($ok) { 'PASS' } else { 'FAIL' }) | $(LastLog)"
            $results[-1]
            Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue
            Remove-Item $spaced -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "empty") {
            # no game folder at all: the first game comes over the network
            Stop-Process -Name azahar -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            Rename-Item $games "games.keep"
            $moved = $true
            Start-Process $azahar -ArgumentList "`"$cxi`""
            Start-Sleep -Seconds 8
            Shot "$s-before"
            $urlFile = Join-Path $cfg "recv_url.txt"
            $srv = Start-Process $py -ArgumentList @("-I", $server, $Pack, "--name", "recvtest.neo3ds", "--url-file", $urlFile) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out "server-$s.log")
            Start-Sleep -Seconds 1
            $before = (Get-Content $log).Count
            Press $KeyY
            $finished = WaitLog $before 120
            Start-Sleep -Seconds 1
            Press $KeyA
            Start-Sleep -Seconds 1
            Shot "$s-after"
            $ok = $finished -and (Test-Path $target) -and (Get-FileHash $target).Hash -eq $hash
            $results += "$s : $(if ($ok) { 'PASS' } else { 'FAIL' }) | $(LastLog)"
            $results[-1]
            Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue
            Stop-Process -Name azahar -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            Remove-Item -Recurse -Force $games
            Rename-Item (Join-Path (Split-Path $games) "games.keep") "games"
            $moved = $false
            continue
        }
        $mode = $s
        $slow = 0
        if ($s -eq "nospace") { $mode = "ok"; [IO.File]::WriteAllText((Join-Path $cfg "recv_free.txt"), "5`n") }
        if ($s -like "replace-*") { $mode = "ok" }
        if ($s -eq "cancel") { $mode = "ok"; $slow = 256 }
        $urlFile = Join-Path $cfg "recv_url.txt"
        $serverArgs = @("-I", $server, $Pack, "--scenario", $mode, "--name", "recvtest.neo3ds", "--url-file", $urlFile)
        if ($slow) { $serverArgs += @("--slow-kbps", "$slow") }
        if ($s -notin "ok", "replace-no", "replace-yes", "cancel") { Remove-Item $target -ErrorAction SilentlyContinue }
        $srv = Start-Process $py -ArgumentList $serverArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out "server-$s.log")
        Start-Sleep -Seconds 1
        $before = if (Test-Path $log) { (Get-Content $log).Count } else { 0 }

        if ($s -eq "cancel") { Remove-Item $target -ErrorAction SilentlyContinue }
        if ($s -eq "ok") { 1..3 | ForEach-Object { Press $KeyDown }; Shot "$s-before" } # the cursor must stay
        Press $KeyY
        if ($s -eq "replace-no") {
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyB
            Start-Sleep -Seconds 1
            $ok = (Test-Path $target) -and (Get-FileHash $target).Hash -eq $hash -and (Get-Content $log).Count -eq $before
            $results += "$s : $(if ($ok) { 'PASS' } else { 'FAIL' }) no download, old file kept"
        } elseif ($s -eq "cancel") {
            Start-Sleep -Seconds 4
            Shot "$s-running"
            $partSeen = Test-Path "$target.part"
            Press $KeyB
            WaitLog $before 10 | Out-Null
            Start-Sleep -Seconds 1
            $ok = $partSeen -and -not (Test-Path "$target.part") -and -not (Test-Path $target)
            $results += "$s : $(if ($ok) { 'PASS' } else { 'FAIL' }) part seen=$partSeen, then removed | $(LastLog)"
        } else {
            if ($s -eq "replace-yes") { Start-Sleep -Seconds 1; Shot "$s-ask"; Press $KeyA }
            $finished = WaitLog $before 120
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyA
            Start-Sleep -Seconds 1
            $saved = (Test-Path $target) -and (Get-FileHash $target).Hash -eq $hash
            $part = Test-Path "$target.part"
            $bak = Test-Path "$target.bak"
            $want = $s -in "ok", "replace-yes"
            $ok = $finished -and ($saved -eq $want) -and -not $part -and -not $bak
            $results += "$s : $(if ($ok) { 'PASS' } else { 'FAIL' }) saved=$saved part=$part bak=$bak | $(LastLog)"
        }
        Shot "$s-list"
        Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $cfg "recv_free.txt") -ErrorAction SilentlyContinue
        $results[-1]
    }
} finally {
    $results | Set-Content (Join-Path $out "results.txt")
    Stop-Process -Name azahar -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    if ($moved) {
        Remove-Item -Recurse -Force $games -ErrorAction SilentlyContinue
        Rename-Item (Join-Path (Split-Path $games) "games.keep") "games"
    }
    Remove-Item $target, "$target.part", "$target.bak", (Join-Path $cfg "recv_url.txt"), (Join-Path $cfg "recv_free.txt") -ErrorAction SilentlyContinue
    if ($null -ne $configBackup) { [IO.File]::WriteAllText("$cfg/launcher.txt", $configBackup) }
    else { Remove-Item "$cfg/launcher.txt" -ErrorAction SilentlyContinue }
}
