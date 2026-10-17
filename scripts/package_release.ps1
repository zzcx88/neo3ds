<#Requires -Version 5.1
<#
.SYNOPSIS
  neo3ds converter release zip builder (Windows only).
.DESCRIPTION
  Publishes the converter as a self-contained single exe (no .NET runtime
  needed, matches README), verifies the tools\ payload, stamps the version
  into usage notes, and zips everything under one top-level folder so the
  exe and tools\ never get separated on unzip:
    neo3ds-converter.zip
    └─ neo3ds-converter\
       ├─ Neo3dsConverter.exe
       ├─ tools\ (engine.elf, makerom.exe, bannertool.exe, neo3ds.rsf)
       └─ 사용법.txt
  Prerequisites: engine built (docs/build.md §1), makerom/bannertool placed
  under tools\ (§2). Output: dist\neo3ds-converter.zip
.EXAMPLE
  powershell scripts/package_release.ps1
.EXAMPLE
  powershell scripts/package_release.ps1 -FrameworkDependent
  # smaller zip, but the user must install the .NET 10 runtime
#>
param(
  [string]$Configuration = "Release",
  [string]$Runtime = "win-x64",
  [switch]$FrameworkDependent,
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
  "converter\assets\사용법.txt"
)) {
  if (-not (Test-Path (Join-Path $root $src))) {
    throw "$src 없음. docs/build.md §1-2 선행 준비를 확인하세요."
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
  if (-not (Test-Path (Join-Path $publishDir $t))) { throw "publish 산출물에 $t 없음" }
}

# 4. Stage under one top-level folder, stamp version into the usage notes.
$stage = Join-Path $root "$OutDir\stage\neo3ds-converter"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item $stage -ItemType Directory | Out-Null
Copy-Item (Join-Path $publishDir "Neo3dsConverter.exe") $stage
Copy-Item (Join-Path $publishDir "tools") (Join-Path $stage "tools") -Recurse
$usage = (Get-Content (Join-Path $root "converter\assets\사용법.txt") -Raw -Encoding UTF8).Replace("{VERSION}", $version)
Set-Content (Join-Path $stage "사용법.txt") $usage -Encoding UTF8

# 5. Zip (Optimal). Asset name stays fixed: README/site link to latest/download/neo3ds-converter.zip.
$zip = Join-Path $root "$OutDir\neo3ds-converter.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "OK v$version self-contained=$(-not $FrameworkDependent) -> $zip ($mb MB)"
