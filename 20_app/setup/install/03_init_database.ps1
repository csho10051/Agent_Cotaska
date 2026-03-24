<#
.SYNOPSIS
    init_db.js を実行して SQLite データベースファイルを生成する
.EXAMPLE
    .\03_init_database.ps1
#>

$ErrorActionPreference = "Stop"
$SetupDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$InitScript = Join-Path $SetupDir "init_db.js"

Write-Host "=== Cotaska: データベース初期化 ===" -ForegroundColor Cyan

# --- Node.js 確認 ---
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[ERROR] Node.js が見つかりません。先に 01_setup_nodejs.ps1 を実行してください。" -ForegroundColor Red
    exit 1
}

# --- sql.js 確認 ---
$sqlJsDir = Join-Path $SetupDir "node_modules\sql.js"
if (-not (Test-Path $sqlJsDir)) {
    Write-Host "[ERROR] sql.js が見つかりません。先に 02_install_packages.ps1 を実行してください。" -ForegroundColor Red
    exit 1
}

# --- init_db.js 確認 ---
if (-not (Test-Path $InitScript)) {
    Write-Host "[ERROR] init_db.js が見つかりません: $InitScript" -ForegroundColor Red
    exit 1
}

# --- 実行 ---
Write-Host "[INFO] データベース初期化を実行中..."
Push-Location $SetupDir
node init_db.js

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] データベース初期化に失敗しました。" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host ""
Write-Host "[OK] データベース初期化完了" -ForegroundColor Green
Pop-Location
