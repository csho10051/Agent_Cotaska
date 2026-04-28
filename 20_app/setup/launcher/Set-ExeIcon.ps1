param(
	[Parameter(Mandatory = $true)]
	[string]$ExePath,

	[Parameter(Mandatory = $true)]
	[string]$IconPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ExePath)) {
	throw "Exe not found: $ExePath"
}

if (-not (Test-Path $IconPath)) {
	throw "Icon not found: $IconPath"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Resolve-Path (Join-Path $scriptDir "..\..")
$nodeDir = Resolve-Path (Join-Path $appDir "..\..\v22.14.0")
$env:PATH = "$nodeDir;$env:PATH"

$tempDir = Join-Path $env:TEMP "cotaska-rcedit"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

$pkgJson = Join-Path $tempDir "package.json"
if (-not (Test-Path $pkgJson)) {
	'{"name":"cotaska-rcedit-temp","private":true}' | Set-Content -Path $pkgJson -Encoding UTF8
}

Push-Location $tempDir
try {
	& "C:\WorkDevelop\Agent_Cotaska\v22.14.0\npm.cmd" install rcedit --no-save --silent | Out-Null
	if ($LASTEXITCODE -ne 0) {
		throw "Failed to install rcedit"
	}

	$rceditModule = Join-Path $tempDir "node_modules\rcedit\lib\index.js"
	if (-not (Test-Path $rceditModule)) {
		throw "rcedit module not found: $rceditModule"
	}

		$rceditModuleUrl = ([System.Uri]$rceditModule).AbsoluteUri

		$nodeScript = @"
import { rcedit } from '$rceditModuleUrl';

await rcedit('$($ExePath.Replace('\', '/'))', {
  icon: '$($IconPath.Replace('\', '/'))'
});
"@

	$tmpScript = Join-Path $tempDir "run-rcedit.mjs"
	[System.IO.File]::WriteAllText($tmpScript, $nodeScript, (New-Object System.Text.UTF8Encoding($false)))

	& "C:\WorkDevelop\Agent_Cotaska\v22.14.0\node.exe" $tmpScript
	if ($LASTEXITCODE -ne 0) {
		throw "rcedit failed with exit code $LASTEXITCODE"
	}
}
finally {
	Pop-Location
}

Write-Host "EXE icon updated: $ExePath" -ForegroundColor Green
