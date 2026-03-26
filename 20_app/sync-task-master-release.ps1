# sync-task-master-release.ps1
# 目的:
# 1) タスクマスター配布フォルダをタイムスタンプ付きでバックアップ
# 2) 最新リリース出力から Cotaska.exe を差し替え
# 3) 最新リリース出力から _app フォルダを差し替え
#
# 使い方:
#   cd 20_app
#   .\sync-task-master-release.ps1

param(
    [switch]$StopRunningCotaska = $true
)

$ErrorActionPreference = "Stop"

function Assert-PathExists {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label not found: $Path"
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

$releaseRoot = Join-Path $scriptDir "release\Cotaska-0.1.0-dist"
$taskMasterRoot = Join-Path $repoRoot "00_mgmt\10_task\Cotaska-0.1.0-dist"

$srcExe = Join-Path $releaseRoot "Cotaska.exe"
$srcApp = Join-Path $releaseRoot "_app"

$dstExe = Join-Path $taskMasterRoot "Cotaska.exe"
$dstApp = Join-Path $taskMasterRoot "_app"

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path (Split-Path $taskMasterRoot) "backup"
if (-not (Test-Path -LiteralPath $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
$backupRoot = Join-Path $backupDir "Cotaska-0.1.0-dist_$timestamp"

if ($StopRunningCotaska) {
    Write-Host "[1/5] Stopping related processes..."
    Get-Process -Name "Cotaska", "electron", "crashpad_handler" -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Write-Host "[2/5] Validating source/target paths..."
Assert-PathExists -Path $releaseRoot -Label "Release root"
Assert-PathExists -Path $taskMasterRoot -Label "Task-master root"
Assert-PathExists -Path $srcExe -Label "Release Cotaska.exe"
Assert-PathExists -Path $srcApp -Label "Release _app folder"

Write-Host "[3/5] Creating backup: $backupRoot"
Copy-Item -LiteralPath $taskMasterRoot -Destination $backupRoot -Recurse -Force

Write-Host "[4/5] Replacing Cotaska.exe"
Copy-Item -LiteralPath $srcExe -Destination $dstExe -Force

Write-Host "[5/5] Replacing _app folder"
if (Test-Path -LiteralPath $dstApp) {
    Remove-Item -LiteralPath $dstApp -Recurse -Force
}
Copy-Item -LiteralPath $srcApp -Destination $dstApp -Recurse -Force

Write-Host ""
Write-Host "Done"
Write-Host "Backup: $backupRoot"
Write-Host "Updated: $taskMasterRoot"
