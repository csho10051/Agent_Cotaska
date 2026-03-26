# Cotaska 起動スクリプト（本番モード）
# 使い方: 20_app ディレクトリでこのファイルを実行してください。

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = (Resolve-Path (Join-Path $scriptDir "..\..\v22.14.0\node.exe")).Path
$electronCli = Join-Path $scriptDir "node_modules\electron\cli.js"

$env:NODE_ENV = "production"
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

Set-Location $scriptDir

Write-Host "Starting Cotaska in production mode..." -ForegroundColor Cyan
& $nodeExe $electronCli "."
Write-Host "Cotaska exited." -ForegroundColor Cyan

