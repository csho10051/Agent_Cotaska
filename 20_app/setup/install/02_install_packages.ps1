<#
.SYNOPSIS
    Cotaska の npm パッケージをインストールする
.PARAMETER Proxy
    プロキシURL（例: http://proxygate2.nic.nec.co.jp:8080）
.EXAMPLE
    .\02_install_packages.ps1
    .\02_install_packages.ps1 -Proxy "http://your-proxy:8080"
#>
param(
    [string]$Proxy
)

$ErrorActionPreference = "Stop"
$SetupDir = Resolve-Path (Join-Path $PSScriptRoot "..")

Write-Host "=== Cotaska: npm パッケージインストール ===" -ForegroundColor Cyan

# --- Node.js 確認 ---
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[ERROR] Node.js が見つかりません。先に 01_setup_nodejs.ps1 を実行してください。" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js $(node -v) 検出" -ForegroundColor Green

# --- プロキシ設定 ---
if ($Proxy) {
    Write-Host "[INFO] npm プロキシ設定: $Proxy"
    npm config set proxy $Proxy
    npm config set https-proxy $Proxy
    $env:HTTP_PROXY = $Proxy
    $env:HTTPS_PROXY = $Proxy
}

# --- setup ディレクトリに移動 ---
Push-Location $SetupDir
Write-Host "[INFO] 作業ディレクトリ: $SetupDir"

# --- package.json が無ければ作成 ---
if (-not (Test-Path "package.json")) {
    Write-Host "[INFO] package.json を初期化..."
    npm init -y
}

# --- sql.js インストール ---
Write-Host "[INFO] sql.js をインストール中..."
npm install sql.js --save

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install に失敗しました。" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host ""
Write-Host "=== インストール結果 ===" -ForegroundColor Cyan
Write-Host "  パッケージ: sql.js (pure JavaScript SQLite)"
Write-Host ""
Write-Host "[OK] npm パッケージインストール完了" -ForegroundColor Green

Pop-Location
