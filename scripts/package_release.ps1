#Requires -Version 5.1
<#
.SYNOPSIS
  neo3ds converter release zip builder (Windows only).
.DESCRIPTION
  Publishes the converter as a self-contained single exe (no .NET runtime
  needed, matches README), verifies the tools\ payload, stamps the version
  into README.txt, and zips everything under one top-level folder so the
  exe and tools\ never get separated on unzip:
    neo3ds-converter.zip
    +- neo3ds-converter\
       +- Neo3dsConverter.exe
       +- tools\ (engine.elf, makerom.exe, bannertool.exe, neo3ds.rsf)
       +- README.txt, LICENSE.txt, THIRD_PARTY_NOTICES.md
       +- neo3ds-launcher.cia   (only with -WithLauncher)
  Prerequisites: engine built (docs/build.md 1), makerom/bannertool placed
  under tools\ (2). Output: dist\neo3ds-converter.zip
  (and dist\neo3ds-launcher.cia with -WithLauncher, for a separate release asset)
.EXAMPLE
  powershell -File scripts/package_release.ps1 -WithLauncher
.EXAMPLE
  powershell -File scripts/package_release.ps1 -FrameworkDependent
  # smaller zip, but the user must install the .NET 10 runtime
#>
param(
  [string]$Configuration = "Release",
  [string]$Runtime = "win-x64",
  [switch]$FrameworkDependent,
  [switch]$WithLauncher,
  [string]$OutDir = "dist"
)
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent

# 1. Version comes from the csproj (single source of truth).
$csproj = Join-Path $root "converter\Neo3dsConverter\Neo3dsConverter.csproj"
[xml]$xml = Get-Content $csproj
$version = ($xml.Project.PropertyGroup | ForEach-Object { $_.Version } |
  Where-Object { $_ } | Select-Object -First 1)
if (-not $version) { throw "Version not found in $csproj" }

# 2. Fail early on missing payload instead of a half-built zip.
foreach ($src in @(
  "engine\engine.elf",
  "tools\makerom\makerom.exe",
  "tools\bannertool\windows-x86_64\bannertool.exe",
  "converter\assets\neo3ds.rsf",
  "converter\assets\README.txt",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md"
)) {
  if (-not (Test-Path (Join-Path $root $src))) {
    throw "$src is missing. See docs/build.md 1-2 (prerequisites)."
  }
}

# 3. Publish: single exe. Self-contained by default (README promises no runtime install).
$publishDir = Join-Path $root "out\publish-tmp"
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
$sc = if ($FrameworkDependent) { "false" } else { "true" }
dotnet publish (Join-Path $root "converter\Neo3dsConverter") `
  -c $Configuration -r $Runtime --self-contained $sc -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed (code $LASTEXITCODE)" }

foreach ($t in @("tools\makerom.exe", "tools\bannertool.exe", "tools\engine.elf", "tools\neo3ds.rsf")) {
  if (-not (Test-Path (Join-Path $publishDir $t))) { throw "$t missing from the publish output" }
}

# 4. Stage under one top-level folder, stamp version into README.txt.
$stage = Join-Path $root "$OutDir\stage\neo3ds-converter"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item $stage -ItemType Directory | Out-Null
Copy-Item (Join-Path $publishDir "Neo3dsConverter.exe") $stage
Copy-Item (Join-Path $publishDir "tools") (Join-Path $stage "tools") -Recurse
$readme = (Get-Content (Join-Path $root "converter\assets\README.txt") -Raw -Encoding UTF8).Replace("{VERSION}", $version)
Set-Content (Join-Path $stage "README.txt") $readme -Encoding UTF8
Copy-Item (Join-Path $root "LICENSE") (Join-Path $stage "LICENSE.txt")
Copy-Item (Join-Path $root "THIRD_PARTY_NOTICES.md") $stage

# 5. Optional: the launcher CIA, built by the exe just published (same engine).
if ($WithLauncher) {
  $exe = Join-Path $stage "Neo3dsConverter.exe"
  $p = Start-Process $exe -ArgumentList "--launcher", "`"$stage`"" -Wait -PassThru -WindowStyle Hidden
  $cia = Join-Path $stage "neo3ds-launcher.cia"
  if ($p.ExitCode -ne 0 -or -not (Test-Path $cia)) { throw "launcher CIA build failed (code $($p.ExitCode))" }
  Copy-Item $cia (Join-Path $root "$OutDir\neo3ds-launcher.cia") -Force
}

# 6. Zip (Optimal). Asset name stays fixed: README/site link to latest/download/neo3ds-converter.zip.
#    Entries are added one by one with "/" names: Compress-Archive and ZipFile.CreateFromDirectory on PS 5.1
#    write "tools\x", which non-Windows unzippers keep as a file name.
$zip = Join-Path $root "$OutDir\neo3ds-converter.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$base = Split-Path $stage -Parent
$z = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
foreach ($f in Get-ChildItem $stage -Recurse -File) {
  $name = $f.FullName.Substring($base.Length + 1).Replace('\', '/')
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $f.FullName, $name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
$z.Dispose()
$z = [IO.Compression.ZipFile]::OpenRead($zip)
$bad = @($z.Entries | Where-Object { $_.FullName.Contains('\') }).Count
$z.Dispose()
if ($bad) { throw "$bad zip entries use backslashes" }
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "OK v$version self-contained=$(-not $FrameworkDependent) launcher=$WithLauncher -> $zip ($mb MB)"
