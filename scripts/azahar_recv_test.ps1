# Azahar test of the launcher's receive screen (issue #256): builds the launcher with
# NEO3DS_RECV_TEST (the address comes from sdmc:/3ds/neo3ds/recv_url.txt instead of a QR code),
# serves a game file with scripts/recv_test_server.py and presses the buttons in Azahar.
#
# The cam-* scenarios use Azahar's still image camera (its config is put back) and need pip for the
# qrcode package.
#
# usage: pwsh scripts/azahar_recv_test.ps1 -Pack <file.neo3ds> [-Converter <folder with Neo3dsConverter.exe>]
#        [-Scenarios ok,404,...] [-SkipBuild]
# Results: out/recvtest/results.txt and one screenshot per scenario. The test file goes in Azahar's
# SD card folder as recvtest.neo3ds and is deleted at the end; launcher.txt is put back.
param(
    [Parameter(Mandatory)] [string] $Pack,
    [string] $Converter = "out/conv141",
    [string[]] $Scenarios = @("badurl", "404", "405", "redirect", "nolength", "chunked", "twolengths", "truncheader", "huge", "nospace", "short", "corrupt", "ok", "replace-no", "replace-yes", "cancel", "spacename", "empty", "cam-ok", "cam-wrong", "cam-none", "home", "home-cam", "badwrite", "noserver", "recover", "logcap", "b-ok3", "b-six", "b-corrupt", "b-short", "b-404", "b-headdiff", "b-cancel", "b-home", "b-replace", "b-nospace", "b-bad", "cam-six", "snap"),
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
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

# The test build takes a button from this file: Azahar needs no focus and the PC stays usable.
function Press([string] $key) {
    $file = Join-Path $cfg "recv_key.txt"
    [IO.File]::WriteAllText($file, $key)
    for ($i = 0; $i -lt 30 -and (Test-Path $file); $i++) { Start-Sleep -Milliseconds 100 }
    if (Test-Path $file) { Remove-Item $file; throw "the launcher did not take the key $key" }
    Start-Sleep -Milliseconds 300
}
$KeyA = "A"; $KeyB = "B"; $KeyY = "Y"; $KeyDown = "D"

function Shot([string] $name) {
    $p = Get-Process azahar
    $r = New-Object Win+RECT
    [Win]::GetWindowRect($p.MainWindowHandle, [ref] $r) | Out-Null
    $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $dc = $g.GetHdc()
    [Win]::PrintWindow($p.MainWindowHandle, $dc, 2) | Out-Null # 2: also what the GPU drew
    $g.ReleaseHdc($dc)
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
# Azahar's still image camera reads one picture, chosen in its config, when the game starts.
$ini = Join-Path $env:APPDATA "Azahar/config/qt-config.ini"
$iniBackup = [IO.File]::ReadAllText($ini)
$pydeps = Join-Path $out "pydeps"
function StartWithPicture([string] $picture) {
    Stop-Process -Name azahar -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $text = $iniBackup
    $text = $text -replace "(?m)^camera_outer_right_name\\default=.*$", "camera_outer_right_name\default=false"
    $text = $text -replace "(?m)^camera_outer_right_name=.*$", "camera_outer_right_name=image"
    $text = $text -replace "(?m)^camera_outer_right_config\\default=.*$", "camera_outer_right_config\default=false"
    $text = $text -replace "(?m)^camera_outer_right_config=.*$", ("camera_outer_right_config=" + ($picture -replace "\\", "/"))
    [IO.File]::WriteAllText($ini, $text)
    Start-Process $azahar -ArgumentList "`"$cxi`""
    Start-Sleep -Seconds 8
}
function Restart {
    Stop-Process -Name azahar -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-Process $azahar -ArgumentList "`"$cxi`""
    Start-Sleep -Seconds 8
}
function Report([string] $name, [bool] $ok, [string] $note) {
    $script:results += "$name : $(if ($ok) { 'PASS' } else { 'FAIL' }) $note | $(LastLog)"
    $script:results[-1]
}
function SleepState {
    $file = Join-Path $cfg "recv_state.txt"
    Remove-Item $file -ErrorAction SilentlyContinue
    Press "S"
    for ($i = 0; $i -lt 20 -and -not (Test-Path $file); $i++) { Start-Sleep -Milliseconds 100 }
    if (Test-Path $file) { (Get-Content $file) -join "" } else { "(no state)" }
}
function StartServer([string] $name, [string[]] $more = @()) {
    $urlFile = Join-Path $cfg "recv_url.txt"
    $a = @("-I", $server, $Pack, "--name", $name, "--url-file", $urlFile) + $more
    $script:srv = Start-Process $py -ArgumentList $a -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out "server-last.log")
    Start-Sleep -Seconds 1
}
function LogCount { if (Test-Path $log) { (Get-Content $log).Count } else { 0 } }
# Batches: files named recvb1.neo3ds, recvb2.neo3ds...
function BatchFile([int] $i) { Join-Path $games "recvb$i.neo3ds" }
function CleanBatch { 1..6 | ForEach-Object { $f = BatchFile $_; Remove-Item $f, "$f.part", "$f.bak" -ErrorAction SilentlyContinue } }
function StartBatch([string[]] $scenarios, [string] $urlFile = (Join-Path $cfg "recv_url.txt")) {
    $list = @()
    for ($i = 0; $i -lt $scenarios.Count; $i++) { $list += "recvb$($i + 1).neo3ds:$($scenarios[$i])" }
    $a = @("-I", "-u", $server, $Pack, "--url-file", $urlFile, "--batch") + $list
    $script:srv = Start-Process $py -ArgumentList $a -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out "server-last.log")
    Start-Sleep -Seconds 1
}
function StopServer { Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300 }
function WaitLine([string] $pattern, [int] $before, [int] $seconds) {
    for ($i = 0; $i -lt $seconds * 2; $i++) {
        if (Test-Path $log) {
            $new = @(Get-Content $log) | Select-Object -Skip $before
            if ($new -match $pattern) { return $true }
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}
function GoodFile([int] $i) { $f = BatchFile $i; (Test-Path $f) -and (Get-FileHash $f).Hash -eq $hash }
function NoBatchLeftovers { -not (Get-ChildItem $games -Filter "recvb*.part") -and -not (Get-ChildItem $games -Filter "recvb*.bak") }
function ServerLog { Get-Content (Join-Path $out "server-last.log") -Raw }
function MakeQr([string] $text, [string] $path, [string] $module = "") {
    if (-not (Test-Path $pydeps)) { & $py -m pip install -q --target $pydeps qrcode | Out-Null }
    $env:PYTHONPATH = $pydeps
    if ($module) { & $py (Join-Path $root "scripts/recv_test_qr.py") $text $path $module }
    else { & $py (Join-Path $root "scripts/recv_test_qr.py") $text $path }
    Remove-Item Env:PYTHONPATH
}
try {
    foreach ($s in $Scenarios) {
        if ($s -in "b-ok3", "b-six", "b-corrupt", "b-short", "b-headdiff", "b-replace") {
            CleanBatch
            $list = switch ($s) {
                "b-ok3" { "ok", "ok", "ok" }
                "b-six" { "ok", "ok", "ok", "ok", "ok", "ok" }
                "b-corrupt" { "ok", "corrupt", "ok" }
                "b-short" { "ok", "short", "ok" }
                "b-headdiff" { "ok", "headdiff", "ok" }
                "b-replace" { "ok", "ok" }
            }
            if ($s -eq "b-replace") { [IO.File]::WriteAllText((BatchFile 1), "the old game") }
            StartBatch $list
            $before = LogCount
            Press $KeyY
            Start-Sleep -Seconds 2
            Shot "$s-ask"
            Press $KeyA
            $done = WaitLine " summary " $before 180
            Start-Sleep -Seconds 1
            Shot "$s-results"
            Press $KeyA
            Start-Sleep -Seconds 1
            Shot "$s-list"
            $want = switch ($s) {
                "b-ok3" { 1, 2, 3 }
                "b-six" { 1, 2, 3, 4, 5, 6 }
                "b-corrupt" { 1, 3 }
                "b-short" { , 1 }
                "b-headdiff" { , 1 }
                "b-replace" { 1, 2 }
            }
            $files = $true
            1..6 | ForEach-Object { if ((GoodFile $_) -ne ($want -contains $_)) { $files = $false } }
            $third = (ServerLog) -match "GET recvb3"
            $thirdOk = if ($s -in "b-short", "b-headdiff") { -not $third } else { $true }
            Report $s ($done -and $files -and $thirdOk -and (NoBatchLeftovers)) "files=$files third-requested=$third"
            StopServer
            CleanBatch
            Remove-Item (Join-Path $cfg "recv_url.txt") -ErrorAction SilentlyContinue
            continue
        }
        if ($s -in "b-404", "b-nospace") {
            # Refused before any file is asked for
            CleanBatch
            if ($s -eq "b-nospace") { [IO.File]::WriteAllText((Join-Path $cfg "recv_free.txt"), "15`n") }
            StartBatch $(if ($s -eq "b-404") { "ok", "404", "ok" } else { "ok", "ok" })
            $before = LogCount
            Press $KeyY
            $done = WaitLine " failed " $before 20
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyA
            $none = -not (Get-ChildItem $games -Filter "recvb*")
            Report $s ($done -and $none -and -not ((ServerLog) -match "GET ")) "no file, no GET"
            StopServer
            Remove-Item (Join-Path $cfg "recv_url.txt"), (Join-Path $cfg "recv_free.txt") -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "b-cancel") {
            CleanBatch
            StartBatch "ok", "ok"
            $before = LogCount
            Press $KeyY
            Start-Sleep -Seconds 2
            Press $KeyB
            Start-Sleep -Seconds 1
            Shot "$s-list"
            $none = -not (Get-ChildItem $games -Filter "recvb*")
            Report $s ($none -and -not ((ServerLog) -match "GET ") -and (LogCount) -eq $before) "nothing fetched"
            StopServer
            Remove-Item (Join-Path $cfg "recv_url.txt") -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "b-home") {
            # HOME in the second file: the first stays, the second leaves nothing
            CleanBatch
            StartBatch "ok", "slow", "ok"
            $before = LogCount
            Press $KeyY
            Start-Sleep -Seconds 2
            Press $KeyA
            WaitLine " saved " $before 60 | Out-Null
            Start-Sleep -Seconds 3
            Press "H"
            $done = WaitLine " summary " $before 15
            Start-Sleep -Seconds 1
            Shot "$s-results"
            Press $KeyA
            Start-Sleep -Seconds 1
            $state = SleepState
            Report $s ($done -and (GoodFile 1) -and -not (Test-Path (BatchFile 2)) -and -not (Test-Path (BatchFile 3)) -and (NoBatchLeftovers) -and $state -eq "sleep=1") "after=$state"
            StopServer
            CleanBatch
            Remove-Item (Join-Path $cfg "recv_url.txt") -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "b-bad") {
            $u = "http://192.0.2.1:80/0123456789abcdef"
            $lists = @{
                "seven" = (1..7 | ForEach-Object { "$u/g$_.neo3ds" }) -join "`n"
                "origin" = "$u/g1.neo3ds`nhttp://192.0.2.2:80/0123456789abcdef/g2.neo3ds"
                "port" = "$u/g1.neo3ds`nhttp://192.0.2.1:81/0123456789abcdef/g2.neo3ds"
                "twice" = "$u/g1.neo3ds`n$u/G1.NEO3DS"
                "cia" = "$u/g1.neo3ds`n$u/g2.cia"
                "blank" = "$u/g1.neo3ds`n`n$u/g2.neo3ds"
                "cr" = "$u/g1.neo3ds`r`n$u/g2.neo3ds"
            }
            foreach ($k in $lists.Keys) {
                $before = LogCount
                [IO.File]::WriteAllText((Join-Path $cfg "recv_url.txt"), $lists[$k])
                Press $KeyY
                $done = WaitLine " refused " $before 5
                Press $KeyA
                Report "b-bad-$k" $done ""
            }
            Remove-Item (Join-Path $cfg "recv_url.txt") -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "cam-six") {
            # Six addresses in one code, read by the camera
            CleanBatch
            Remove-Item (Join-Path $cfg "recv_url.txt") -ErrorAction SilentlyContinue
            $urlFile = Join-Path $out "url.txt"
            StartBatch ("ok", "ok", "ok", "ok", "ok", "ok") $urlFile
            $picture = Join-Path $out "$s.png"
            MakeQr ([IO.File]::ReadAllText($urlFile).TrimEnd("`n")) $picture "6" # 3 pixels a module on the camera
            StartWithPicture $picture
            $before = LogCount
            Press $KeyY
            Start-Sleep -Seconds 5
            Shot "$s-ask"
            Press $KeyA
            $done = WaitLine " summary " $before 180
            Start-Sleep -Seconds 1
            Shot "$s-results"
            Press $KeyA
            $files = $true
            1..6 | ForEach-Object { if (-not (GoodFile $_)) { $files = $false } }
            Report $s ($done -and $files) "six files"
            StopServer
            CleanBatch
            continue
        }
        if ($s -eq "snap") {
            # Pictures for the list: the first game in it, on leaving, by hand, and kept
            $snaps = Join-Path $cfg "snaps"
            $first = Join-Path $snaps "sonicwi3.bin"
            Remove-Item $first -ErrorAction SilentlyContinue
            Restart
            Shot "$s-none"
            Press $KeyA
            Start-Sleep -Seconds 25
            Press "L" # Azahar does not start a CXI again by itself: the list comes from a restart
            Start-Sleep -Seconds 3
            Restart
            Shot "$s-auto"
            $auto = (Test-Path $first) -and (Get-Item $first).Length -eq 192008
            $autoHash = if (Test-Path $first) { (Get-FileHash $first).Hash } else { "" }
            Press $KeyDown
            Start-Sleep -Seconds 1
            Shot "$s-other"
            Restart
            Press $KeyA
            Start-Sleep -Seconds 15
            Press "P"
            Start-Sleep -Seconds 3
            Shot "$s-game"
            $manualHash = if (Test-Path $first) { (Get-FileHash $first).Hash } else { "" }
            Start-Sleep -Seconds 5
            Press "L"
            Start-Sleep -Seconds 3
            Restart
            Shot "$s-manual"
            $kept = (Test-Path $first) -and (Get-FileHash $first).Hash -eq $manualHash
            Report $s ($auto -and $manualHash -ne $autoHash -and $kept) "auto=$auto manual-kept=$kept"
            Remove-Item $first -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "home") {
            # A transfer stopped by the HOME menu: nothing left, sleep back, and it works again
            Remove-Item $target, "$target.part" -ErrorAction SilentlyContinue
            StartServer "recvtest.neo3ds" @("--slow-kbps", "256")
            $before = LogCount
            $idle = SleepState
            Press $KeyY
            Start-Sleep -Seconds 3
            $during = SleepState
            $partSeen = Test-Path "$target.part"
            Press "H"
            WaitLog $before 10 | Out-Null
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyA
            $after = SleepState
            $clean = -not (Test-Path "$target.part") -and -not (Test-Path $target)
            Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue
            StartServer "recvtest.neo3ds"
            $before = LogCount
            Press $KeyY
            $again = WaitLog $before 60
            Start-Sleep -Seconds 1
            Press $KeyA
            $saved = $again -and (Test-Path $target) -and (Get-FileHash $target).Hash -eq $hash
            Report $s ($partSeen -and $clean -and $saved -and $idle -eq "sleep=1" -and $during -eq "sleep=0" -and $after -eq "sleep=1") "idle=$idle during=$during after=$after clean=$clean retried=$saved"
            Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue
            Remove-Item $target, (Join-Path $cfg "recv_url.txt") -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "home-cam") {
            # HOME during the scan goes back to the list and the camera starts again afterwards
            Remove-Item (Join-Path $cfg "recv_url.txt") -ErrorAction SilentlyContinue
            $picture = Join-Path $out "$s.png"
            MakeQr "--blank" $picture
            StartWithPicture $picture
            Press $KeyY
            Start-Sleep -Seconds 2
            Shot "$s-scanning"
            Press "H"
            Start-Sleep -Seconds 1
            Shot "$s-list"
            Press $KeyY
            Start-Sleep -Seconds 2
            Shot "$s-again"
            Press $KeyB
            Start-Sleep -Seconds 1
            Report $s ([bool](Get-Process azahar -ErrorAction SilentlyContinue)) "see the $s screenshots"
            continue
        }
        if ($s -eq "badwrite") {
            # A failed write replaces nothing
            Restart
            [IO.File]::WriteAllText($target, "the old game")
            StartServer "recvtest.neo3ds"
            $before = LogCount
            Press "W"
            Press $KeyY
            Start-Sleep -Seconds 1
            Press $KeyA # replace it
            $done = WaitLog $before 60
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyA
            $old = (Test-Path $target) -and (Get-Content $target) -eq "the old game"
            Report $s ($done -and $old -and -not (Test-Path "$target.part") -and -not (Test-Path "$target.bak") -and (LastLog) -match "failed") "old file kept=$old"
            Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue
            Remove-Item $target, (Join-Path $cfg "recv_url.txt") -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "noserver") {
            StartServer "recvtest.neo3ds"
            Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
            $before = LogCount
            Press $KeyY
            $done = WaitLog $before 15
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyA
            Report $s ($done -and (LastLog) -match "failed" -and (LastLog) -match "error") ""
            Remove-Item (Join-Path $cfg "recv_url.txt") -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "recover") {
            Stop-Process -Name azahar -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            $part = Join-Path $games "recvcut.neo3ds.part"
            $backBak = Join-Path $games "recvback.neo3ds.bak"
            $backFinal = Join-Path $games "recvback.neo3ds"
            $newFinal = Join-Path $games "recvnew.neo3ds"
            $newBak = Join-Path $games "recvnew.neo3ds.bak"
            [IO.File]::WriteAllText($part, "half a file")
            Copy-Item $Pack $backBak
            Copy-Item $Pack $newFinal
            [IO.File]::WriteAllText($newBak, "the old game")
            Start-Process $azahar -ArgumentList "`"$cxi`""
            Start-Sleep -Seconds 8
            Shot $s
            $ok = -not (Test-Path $part) -and -not (Test-Path $backBak) -and (Test-Path $backFinal) -and (Test-Path $newFinal) -and -not (Test-Path $newBak)
            Report $s $ok "part removed, old game back, stale backup removed"
            Stop-Process -Name azahar -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            Remove-Item $part, $backBak, $backFinal, $newFinal, $newBak -ErrorAction SilentlyContinue
            Start-Process $azahar -ArgumentList "`"$cxi`""
            Start-Sleep -Seconds 8
            continue
        }
        if ($s -eq "logcap") {
            # An attempt at a full log starts a new one; the old one is kept once
            [IO.File]::WriteAllText($log, ("x" * 79 + "`n") * 500)
            [IO.File]::WriteAllText("$log.old", "the older log`n")
            [IO.File]::WriteAllText((Join-Path $cfg "recv_url.txt"), "http://127.0.0.1:80/x/a.neo3ds`n")
            Press $KeyY
            Start-Sleep -Seconds 2
            Press $KeyA
            $newSize = (Get-Item $log).Length
            $oldSize = (Get-Item "$log.old").Length
            Report $s ($newSize -lt 1000 -and $oldSize -eq 40000) "new=$newSize old=$oldSize"
            Remove-Item "$log.old", (Join-Path $cfg "recv_url.txt") -ErrorAction SilentlyContinue
            continue
        }
        if ($s -like "cam-*") {
            # The camera path: a fixed port so the picture can be made first
            Remove-Item (Join-Path $cfg "recv_url.txt"), $target -ErrorAction SilentlyContinue
            $urlFile = Join-Path $out "url.txt"
            $srv = Start-Process $py -ArgumentList @("-I", $server, $Pack, "--name", "recvtest.neo3ds", "--port", "50123", "--url-file", "`"$urlFile`"") -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out "server-$s.log")
            Start-Sleep -Seconds 1
            $picture = Join-Path $out "$s.png"
            if ($s -eq "cam-ok") { MakeQr (Get-Content $urlFile) $picture }
            if ($s -eq "cam-wrong") { MakeQr "http://192.0.2.1:80/0123456789abcdef/game.cia" $picture }
            if ($s -eq "cam-none") { MakeQr "--blank" $picture }
            StartWithPicture $picture
            $before = if (Test-Path $log) { (Get-Content $log).Count } else { 0 }
            Press $KeyY
            if ($s -eq "cam-ok") {
                $finished = WaitLog $before 120
                Start-Sleep -Seconds 1
                Shot "$s-done"
                Press $KeyA
                Start-Sleep -Seconds 1
                Shot "$s-list"
                $ok = $finished -and (Test-Path $target) -and (Get-FileHash $target).Hash -eq $hash
                $results += "$s : $(if ($ok) { 'PASS' } else { 'FAIL' }) | $(LastLog)"
            } else {
                Start-Sleep -Seconds 4
                Shot "$s-scanning"
                $still = (Get-Content $log -ErrorAction SilentlyContinue).Count -eq $before
                Press $KeyB # leaves the camera
                Start-Sleep -Seconds 1
                Shot "$s-back"
                Press $KeyY # and again: the camera must start a second time
                Start-Sleep -Seconds 3
                Shot "$s-again"
                Press $KeyB
                Start-Sleep -Seconds 1
                Shot "$s-list"
                $ok = $still -and -not (Test-Path $target) -and (Get-Process azahar -ErrorAction SilentlyContinue)
                $results += "$s : $(if ($ok) { 'PASS' } else { 'FAIL' }) stayed on the camera, left, came back"
            }
            $results[-1]
            Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue
            continue
        }
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
    if ($srv) { Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue }
    $results | Set-Content (Join-Path $out "results.txt")
    Stop-Process -Name azahar -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    [IO.File]::WriteAllText($ini, $iniBackup)
    CleanBatch
    Remove-Item (Join-Path $cfg "snaps/sonicwi3.bin") -ErrorAction SilentlyContinue
    if ($moved) {
        Remove-Item -Recurse -Force $games -ErrorAction SilentlyContinue
        Rename-Item (Join-Path (Split-Path $games) "games.keep") "games"
    }
    Remove-Item $target, "$target.part", "$target.bak", (Join-Path $cfg "recv_url.txt"), (Join-Path $cfg "recv_free.txt"), (Join-Path $cfg "recv_state.txt"), "$log.old" -ErrorAction SilentlyContinue
    if ($null -ne $configBackup) { [IO.File]::WriteAllText("$cfg/launcher.txt", $configBackup) }
    else { Remove-Item "$cfg/launcher.txt" -ErrorAction SilentlyContinue }
}
