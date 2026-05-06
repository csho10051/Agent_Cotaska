# Remove obsolete task_file_path fields from Cotaska task data.
#
# Usage:
#   .\remove-task-file-path.ps1
#   .\remove-task-file-path.ps1 -TasksDir "D:\Cotaska\data\tasks"
#   .\remove-task-file-path.ps1 -TasksDir "D:\Cotaska\data\tasks" -ArchiveDir "D:\Cotaska\data\archive"
#   .\remove-task-file-path.ps1 -WhatIf
#
# Scope:
#   - Removes task_file_path only from Markdown frontmatter.
#   - Removes task_file_path entries from _index.yaml.
#   - Does not remove body text that merely mentions task_file_path.

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$TasksDir = "",
    [string]$ArchiveDir = "",
    [string]$IndexPath = "",
    [bool]$IncludeArchive = $true
)

$ErrorActionPreference = "Stop"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Resolve-DefaultTasksDir {
    $candidates = @(
        # Release layout: Cotaska-0.1.0-dist\tools\remove-task-file-path.ps1
        (Join-Path $PSScriptRoot "..\data\tasks"),
        # Repository layout: Cotaska\20_app\scripts\remove-task-file-path.ps1
        (Join-Path $PSScriptRoot "..\..\00_mgmt\10_task\Cotaska-0.1.0-dist\data\tasks"),
        (Join-Path $PSScriptRoot "..\..\data\tasks")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "TasksDir was not specified and no default data\tasks folder was found."
}

function Resolve-DefaultArchiveDir {
    param(
        [Parameter(Mandatory = $true)][string]$ResolvedTasksDir
    )

    $candidate = Join-Path (Split-Path -Parent $ResolvedTasksDir) "archive"
    if (Test-Path -LiteralPath $candidate) {
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    return ""
}

function Remove-TaskFilePathFromFrontmatter {
    param(
        [Parameter(Mandatory = $true)][string]$Text
    )

    if (-not $Text.StartsWith("---")) {
        return @{ Text = $Text; Changed = $false }
    }

    $newlineMatch = [regex]::Match($Text, "\r\n|\n")
    $newline = if ($newlineMatch.Success) { $newlineMatch.Value } else { "`n" }
    $frontmatterEndPattern = "(?s)^---\r?\n(.*?)\r?\n---"
    $match = [regex]::Match($Text, $frontmatterEndPattern)
    if (-not $match.Success) {
        return @{ Text = $Text; Changed = $false }
    }

    $frontmatterBody = $match.Groups[1].Value
    $updatedBody = [regex]::Replace(
        $frontmatterBody,
        "(?m)^task_file_path:\s*(?:[>|][+-]?\s*\r?\n(?:[ \t]+.*(?:\r?\n|$))+|.*(?:\r?\n|$)?)",
        ""
    )

    if ($updatedBody -eq $frontmatterBody) {
        return @{ Text = $Text; Changed = $false }
    }

    $updatedFrontmatter = "---" + $newline + $updatedBody.TrimEnd("`r", "`n") + $newline + "---"
    $updatedText = $updatedFrontmatter + $Text.Substring($match.Length)
    return @{ Text = $updatedText; Changed = $true }
}

function Remove-TaskFilePathFromYaml {
    param(
        [Parameter(Mandatory = $true)][string]$Text
    )

    $updated = [regex]::Replace(
        $Text,
        "(?m)^[ \t]*task_file_path:\s*(?:[>|][+-]?\s*\r?\n(?:[ \t]+.*(?:\r?\n|$))+|.*(?:\r?\n|$)?)",
        ""
    )

    return @{ Text = $updated; Changed = ($updated -ne $Text) }
}

function Update-TextFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][scriptblock]$Transform
    )

    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    $result = & $Transform $text
    if (-not $result.Changed) {
        return $false
    }

    if ($PSCmdlet.ShouldProcess($Path, "remove task_file_path")) {
        [System.IO.File]::WriteAllText($Path, $result.Text, $Utf8NoBom)
    }

    return $true
}

if ([string]::IsNullOrWhiteSpace($TasksDir)) {
    $TasksDir = Resolve-DefaultTasksDir
} else {
    $TasksDir = (Resolve-Path -LiteralPath $TasksDir).Path
}

if ([string]::IsNullOrWhiteSpace($IndexPath)) {
    $IndexPath = Join-Path $TasksDir "_index.yaml"
}

if ($IncludeArchive -and [string]::IsNullOrWhiteSpace($ArchiveDir)) {
    $ArchiveDir = Resolve-DefaultArchiveDir -ResolvedTasksDir $TasksDir
} elseif (-not [string]::IsNullOrWhiteSpace($ArchiveDir)) {
    $ArchiveDir = (Resolve-Path -LiteralPath $ArchiveDir).Path
}

$markdownRoots = @($TasksDir)
if ($IncludeArchive -and -not [string]::IsNullOrWhiteSpace($ArchiveDir)) {
    $markdownRoots += $ArchiveDir
}

$changedMarkdown = 0
$scannedMarkdown = 0
foreach ($root in $markdownRoots) {
    if (-not (Test-Path -LiteralPath $root)) {
        continue
    }

    Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*.md" | ForEach-Object {
        $scannedMarkdown++
        if (Update-TextFile -Path $_.FullName -Transform ${function:Remove-TaskFilePathFromFrontmatter}) {
            $changedMarkdown++
        }
    }
}

$indexChanged = $false
if (Test-Path -LiteralPath $IndexPath) {
    $indexChanged = Update-TextFile -Path $IndexPath -Transform ${function:Remove-TaskFilePathFromYaml}
}

Write-Host "Cotaska task_file_path cleanup"
Write-Host "TasksDir        : $TasksDir"
if ($IncludeArchive -and -not [string]::IsNullOrWhiteSpace($ArchiveDir)) {
    Write-Host "ArchiveDir      : $ArchiveDir"
}
Write-Host "IndexPath       : $IndexPath"
Write-Host "Markdown scanned: $scannedMarkdown"
Write-Host "Markdown changed: $changedMarkdown"
Write-Host "Index changed   : $indexChanged"

