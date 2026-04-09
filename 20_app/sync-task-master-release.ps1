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
    [bool]$StopRunningCotaska = $true
)

$ErrorActionPreference = "Stop"

function Ensure-RestartManagerTypes {
    if ("Cotaska.RestartManager" -as [type]) {
        return
    }

    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Cotaska {
    public static class RestartManager {
        public const int CCH_RM_MAX_APP_NAME = 255;
        public const int CCH_RM_MAX_SVC_NAME = 63;

        [StructLayout(LayoutKind.Sequential)]
        public struct RM_UNIQUE_PROCESS {
            public int dwProcessId;
            public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
        }

        public enum RM_APP_TYPE {
            RmUnknownApp = 0,
            RmMainWindow = 1,
            RmOtherWindow = 2,
            RmService = 3,
            RmExplorer = 4,
            RmConsole = 5,
            RmCritical = 1000
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct RM_PROCESS_INFO {
            public RM_UNIQUE_PROCESS Process;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]
            public string strAppName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]
            public string strServiceShortName;
            public RM_APP_TYPE ApplicationType;
            public uint AppStatus;
            public uint TSSessionId;
            [MarshalAs(UnmanagedType.Bool)]
            public bool bRestartable;
        }

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

        [DllImport("rstrtmgr.dll")]
        public static extern int RmEndSession(uint pSessionHandle);

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
    }
}
"@
}

function Get-LockingProcesses {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    Ensure-RestartManagerTypes

    $sessionKey = [Guid]::NewGuid().ToString()
    $handle = 0
    $startResult = [Cotaska.RestartManager]::RmStartSession([ref]$handle, 0, $sessionKey)
    if ($startResult -ne 0) {
        return @()
    }

    try {
        $registerResult = [Cotaska.RestartManager]::RmRegisterResources($handle, 1, @($Path), 0, $null, 0, $null)
        if ($registerResult -ne 0) {
            return @()
        }

        $needed = 0
        $count = 0
        $rebootReasons = 0
        $result = [Cotaska.RestartManager]::RmGetList($handle, [ref]$needed, [ref]$count, $null, [ref]$rebootReasons)
        if ($result -ne 234) {
            return @()
        }

        $infos = New-Object Cotaska.RestartManager+RM_PROCESS_INFO[] $needed
        $count = $needed
        $result = [Cotaska.RestartManager]::RmGetList($handle, [ref]$needed, [ref]$count, $infos, [ref]$rebootReasons)
        if ($result -ne 0) {
            return @()
        }

        return $infos | ForEach-Object {
            [pscustomobject]@{
                ProcessId = $_.Process.dwProcessId
                AppName = $_.strAppName
                AppType = $_.ApplicationType.ToString()
            }
        }
    }
    finally {
        [Cotaska.RestartManager]::RmEndSession($handle) | Out-Null
    }
}

function Remove-PathWithLockHint {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    for ($try = 1; $try -le 3; $try++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force
            return
        }
        catch {
            if ($try -lt 3) {
                Start-Sleep -Milliseconds 700
                continue
            }

            $lockedFile = Join-Path $Path "resources\app.asar"
            $lockers = @()
            if (Test-Path -LiteralPath $lockedFile) {
                $lockers = Get-LockingProcesses -Path $lockedFile
            }

            if ($lockers.Count -gt 0) {
                Write-Host "[LOCK] app.asar is still in use:" -ForegroundColor Yellow
                $lockers | Format-Table -AutoSize | Out-String | Write-Host
                throw "Failed to replace _app because app.asar is locked. Close the listed process(es) and retry."
            }

            throw
        }
    }
}

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
    Get-Process -Name "Cotaska", "CotaskaCore", "electron", "crashpad_handler" -ErrorAction SilentlyContinue |
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
    Remove-PathWithLockHint -Path $dstApp
}
Copy-Item -LiteralPath $srcApp -Destination $dstApp -Recurse -Force

Write-Host ""
Write-Host "Done"
Write-Host "Backup: $backupRoot"
Write-Host "Updated: $taskMasterRoot"
