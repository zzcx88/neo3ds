#Requires -Version 5.1
<#
.SYNOPSIS
  neo3ds converter release zip builder (Windows GUI / Linux and macOS Desktop).
.DESCRIPTION
  Publishes self-contained releases under one top-level folder per RID.
  Windows keeps neo3ds-converter.zip and its existing GUI/tools layout.
  Unix zips ship the Desktop single binary (GUI when run bare, CLI with args),
  with native libraries and executable Unix permissions.
  macOS additionally bundles a .app (ditto zip preserves permissions).
  Prerequisites: engine built (docs/build.md 1), Windows tools (2), or Unix
  tools built by scripts/build_unix_tools.sh under tools/{rid}/.
.EXAMPLE
  powershell -File scripts/package_release.ps1 -WithLauncher
.EXAMPLE
  .\scripts\package_release.ps1 -Runtimes win-x64,linux-x64,osx-arm64
.EXAMPLE
  powershell -File scripts/package_release.ps1 -FrameworkDependent
  # Windows only: smaller zip, requires the .NET 10 runtime
#>
param(
  [string]$Configuration = "Release",
  [ValidateSet("win-x64", "linux-x64", "osx-arm64")]
  [string[]]$Runtimes = @("win-x64"),
  [switch]$FrameworkDependent,
  [switch]$WithLauncher,
  [string]$LauncherCia = "",
  [string]$OutDir = "dist",
  [string]$VersionOverride = ""
)
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
if ($Runtimes.Count -eq 0) { throw "Specify at least one runtime." }

# 1. Version comes from converter/Directory.Build.props (single source of truth for all projects).
$props = Join-Path $root 'converter' 'Directory.Build.props'
[xml]$xml = Get-Content $props
$version = ($xml.Project.PropertyGroup | ForEach-Object { $_.Version } |
  Where-Object { $_ } | Select-Object -First 1)
if ($VersionOverride) { $version = $VersionOverride }
if (-not $version) { throw "Version not found in $props" }

# 2. Check every requested RID before publishing any release. Segment arrays stay
# OS-agnostic; Join-Path applies the platform separator (backslashes break Unix).
$commonFiles = @(
  ,@('engine', 'engine.elf'),
  ,@('converter', 'assets', 'neo3ds.rsf'),
  ,@('converter', 'assets', 'README.txt'),
  ,@('LICENSE'),
  ,@('THIRD_PARTY_NOTICES.md')
)
foreach ($runtime in ($Runtimes | Select-Object -Unique)) {
  $required = if ($runtime -eq 'win-x64') {
    @(
      ,@('converter', 'Neo3dsConverter', 'Neo3dsConverter.csproj'),
      ,@('tools', 'makerom', 'makerom.exe'),
      ,@('tools', 'bannertool', 'windows-x86_64', 'bannertool.exe')
    )
  } else {
    @(
      ,@('converter', 'Neo3dsConverter.Desktop', 'Neo3dsConverter.Desktop.csproj'),
      ,@('tools', $runtime, 'makerom'),
      ,@('tools', $runtime, 'bannertool')
    )
  }
  foreach ($segments in ($commonFiles + $required)) {
    $rel = $segments -join '/'
    $path = $root
    foreach ($seg in $segments) { $path = Join-Path $path $seg }
    if (-not (Test-Path $path -PathType Leaf)) {
      throw "$rel is missing for $runtime. See docs/build.md 1-2 or scripts/build_unix_tools.sh."
    }
  }
}

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
foreach ($runtime in ($Runtimes | Select-Object -Unique)) {
  $isWindowsRid = $runtime -eq "win-x64"
  $packageName = if ($isWindowsRid) { "neo3ds-converter" } else { "neo3ds-converter-$runtime" }
  $project = if ($isWindowsRid) { "Neo3dsConverter" } else { "Neo3dsConverter.Desktop" }
  $binary = if ($isWindowsRid) { "Neo3dsConverter.exe" } else { "neo3ds-converter" }
  $selfContained = -not ($isWindowsRid -and $FrameworkDependent)
  if (-not $isWindowsRid -and $WithLauncher) {
    Write-Warning "${runtime}: -WithLauncher skipped; the launcher CIA is built once on win-x64 and injected."
  }
  if (-not $isWindowsRid -and $FrameworkDependent) {
    Write-Warning "${runtime}: -FrameworkDependent ignored; Unix releases are self-contained."
  }

  # 3. Publish separately per RID so outputs cannot leak between packages.
  $publishDir = Join-Path $root 'out' 'publish-tmp' $runtime
  if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
  $sc = if ($selfContained) { "true" } else { "false" }
  dotnet publish (Join-Path $root 'converter' $project) `
    -c $Configuration -r $runtime --self-contained $sc -o $publishDir
  if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed for $runtime (code $LASTEXITCODE)" }
  if (-not (Test-Path (Join-Path $publishDir $binary) -PathType Leaf)) {
    throw "$binary missing from the $runtime publish output"
  }

  # CLI None/Link items normally supply tools; fill any missing items here.
  if (-not $isWindowsRid) {
    $toolsDir = Join-Path $publishDir 'tools'
    New-Item $toolsDir -ItemType Directory -Force | Out-Null
    $payload = @{
      'makerom' = @('tools', $runtime, 'makerom')
      'bannertool' = @('tools', $runtime, 'bannertool')
      'engine.elf' = @('engine', 'engine.elf')
      'neo3ds.rsf' = @('converter', 'assets', 'neo3ds.rsf')
    }
    foreach ($name in $payload.Keys) {
      $destination = Join-Path $toolsDir $name
      if (-not (Test-Path $destination -PathType Leaf)) {
        $src = $root
        foreach ($seg in $payload[$name]) { $src = Join-Path $src $seg }
        Copy-Item $src $destination
      }
    }
  }
  $toolNames = if ($isWindowsRid) { @('makerom.exe', 'bannertool.exe') } else { @('makerom', 'bannertool') }
  foreach ($name in ($toolNames + @('engine.elf', 'neo3ds.rsf'))) {
    if (-not (Test-Path (Join-Path $publishDir 'tools' $name) -PathType Leaf)) {
      throw "tools/$name missing from the $runtime publish output"
    }
  }

  # 4. Keep the Windows layout; Unix also needs published native libraries.
  $stage = Join-Path $root $OutDir 'stage' $packageName
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item $stage -ItemType Directory -Force | Out-Null
  if ($isWindowsRid) {
    Copy-Item (Join-Path $publishDir $binary) $stage
    Copy-Item (Join-Path $publishDir 'tools') (Join-Path $stage 'tools') -Recurse
  } elseif ($runtime -eq 'osx-arm64') {
    # .app only (§4b below); no flat publish copy (avoids 2x size).
  } else {
    Get-ChildItem $publishDir -Force | Copy-Item -Destination $stage -Recurse -Force
  }
  $readmeTemplate = Join-Path $root 'converter' 'assets' 'README.txt'
  $readme = (Get-Content $readmeTemplate -Raw -Encoding UTF8).Replace('{VERSION}', $version)
  Set-Content (Join-Path $stage 'README.txt') $readme -Encoding UTF8
  Copy-Item (Join-Path $root 'LICENSE') (Join-Path $stage 'LICENSE.txt') -Force
  Copy-Item (Join-Path $root 'THIRD_PARTY_NOTICES.md') $stage -Force

  # 4b. macOS: bundle the publish output as neo3ds-converter.app (D10).
  # The .app lives inside the package folder (Q3); ditto re-zips it on the macOS runner.
  $isMacRid = $runtime -eq 'osx-arm64'
  if ($isMacRid) {
    $app = Join-Path $stage 'neo3ds-converter.app' 'Contents'
    New-Item (Join-Path $app 'MacOS') -ItemType Directory -Force | Out-Null
    New-Item (Join-Path $app 'Resources') -ItemType Directory -Force | Out-Null
    Get-ChildItem $publishDir -Force | Copy-Item -Destination (Join-Path $app 'MacOS') -Recurse -Force
    $plist = @"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>neo3ds-converter</string>
  <key>CFBundleName</key><string>neo3ds-converter</string>
  <key>CFBundleDisplayName</key><string>neo3ds-converter</string>
  <key>CFBundleIdentifier</key><string>io.github.zzcx88.neo3ds-converter</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict>
</plist>
"@
    Set-Content (Join-Path $app 'Info.plist') $plist -Encoding UTF8
  }
  # 5. Windows builds the launcher CIA once (D6); Unix zips get the same file injected.
  $includeLauncher = $isWindowsRid -and $WithLauncher
  if ($includeLauncher) {
    $exe = Join-Path $stage 'Neo3dsConverter.exe'
    $p = Start-Process $exe -ArgumentList '--launcher', "`"$stage`"" -Wait -PassThru -WindowStyle Hidden
    $cia = Join-Path $stage 'neo3ds-launcher.cia'
    if ($p.ExitCode -ne 0 -or -not (Test-Path $cia)) { throw "launcher CIA build failed (code $($p.ExitCode))" }
    Copy-Item $cia (Join-Path $root $OutDir 'neo3ds-launcher.cia') -Force
  }
  if (-not $isWindowsRid -and $LauncherCia) {
    if (-not (Test-Path $LauncherCia -PathType Leaf)) { throw "LauncherCia not found: $LauncherCia" }
    Copy-Item $LauncherCia (Join-Path $stage 'neo3ds-launcher.cia') -Force
  }

  # 6. Slash-separated entries; Windows asset name protects latest/download links.
  $zip = Join-Path $root $OutDir "$packageName.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  $base = Split-Path $stage -Parent
  # Programs get 0100755, data 0100644, including the runtime-specific tool copies the converter
  # prefers (tools/<rid>/…) — a 0644 makerom/bannertool would only run if the converter could chmod
  # it at run time, which fails on read-only media (#179).
  $programs = @($binary, "tools/$($toolNames[0])", "tools/$($toolNames[1])",
    "tools/$runtime/$($toolNames[0])", "tools/$runtime/$($toolNames[1])")
  if ($isMacRid) {
    $appMac = 'neo3ds-converter.app/Contents/MacOS'
    $appPrograms = $programs | ForEach-Object { "$appMac/$_" }
    $programs += $appPrograms
  }
  # 0100755 for programs, 0100644 for data (Unix zips only).
  $modeProgram = 33261
  $modeData = 33188
  $z = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($f in Get-ChildItem $stage -Recurse -File) {
      $name = $f.FullName.Substring($base.Length + 1).Replace('\', '/')
      $entry = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $f.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
      if (-not $isWindowsRid) {
        $relative = $name.Substring($packageName.Length + 1)
        $mode = if ($relative -in $programs -or $relative -match '\.(so(\.[0-9]+)*|dylib)$') { $modeProgram } else { $modeData }
        $entry.ExternalAttributes = $mode -shl 16
      }
    }
  } finally {
    $z.Dispose()
  }
  $z = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $bad = @($z.Entries | Where-Object { $_.FullName.Contains('\') }).Count
  } finally {
    $z.Dispose()
  }
  if ($bad) { throw "$bad zip entries use backslashes" }
  $mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
  Write-Host "OK v$version runtime=$runtime self-contained=$selfContained launcher=$includeLauncher -> $zip ($mb MB)"
}
