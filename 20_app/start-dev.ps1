# Cotaska startup script (production mode)
# Usage: run this file in 20_app directory.

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

