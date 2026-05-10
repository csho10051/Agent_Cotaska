# Cotaska task file validator
#
# Usage:
#   .\validate-tasks.ps1
#   .\validate-tasks.ps1 -TasksDir "D:\path\to\data\tasks"
#
# Exit code:
#   0: OK
#   1: Validation errors found

param(
    [string]$TasksDir = "",
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultTasksDir {
    $candidates = @(
        # Release layout: Cotaska-0.1.0-dist\tools\validate-tasks.ps1
        (Join-Path $PSScriptRoot "..\data\tasks"),
        # Repository layout: Cotaska\20_app\scripts\validate-tasks.ps1
        (Join-Path $PSScriptRoot "..\..\00_mgmt\Cotaska_タスク管理ツール\data\tasks"),
        (Join-Path $PSScriptRoot "..\..\data\tasks")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "TasksDir was not specified and no default data\tasks folder was found."
}

function New-ValidationError {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [Parameter(Mandatory = $true)][int]$Line,
        [Parameter(Mandatory = $true)][string]$Message
    )

    [pscustomobject]@{
        File = $File
        Line = $Line
        Message = $Message
    }
}

function New-ValidationWarning {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [Parameter(Mandatory = $true)][string]$Message
    )

    [pscustomobject]@{
        File = $File
        Message = $Message
    }
}

function Test-UnquotedColonValue {
    param(
        [string]$Value
    )

    $trimmed = [string]$Value
    $trimmed = $trimmed.Trim()

    if ($trimmed -eq "" -or $trimmed -eq "null") { return $false }
    if ($trimmed -match "^(true|false)$") { return $false }
    if ($trimmed -match "^-?\d+(\.\d+)?$") { return $false }
    if ($trimmed -match "^\[.*\]$") { return $false }
    if ($trimmed -match "^['""]") { return $false }
    if ($trimmed -match "^[>|][+-]?$") { return $false }

    return $trimmed.Contains(":")
}

function Test-TaskFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    $errors = New-Object System.Collections.Generic.List[object]
    $lines = [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)
    $fileName = Split-Path -Leaf $Path

    if ($lines.Count -eq 0) {
        $errors.Add((New-ValidationError -File $fileName -Line 1 -Message "File is empty."))
        return @{ Errors = $errors; Id = $null }
    }

    if ($lines[0].Trim() -ne "---") {
        $errors.Add((New-ValidationError -File $fileName -Line 1 -Message "Frontmatter must start with '---'."))
        return @{ Errors = $errors; Id = $null }
    }

    $endIndex = -1
    for ($i = 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq "---") {
            $endIndex = $i
            break
        }
    }

    if ($endIndex -lt 0) {
        $errors.Add((New-ValidationError -File $fileName -Line 1 -Message "Frontmatter end marker '---' was not found."))
        return @{ Errors = $errors; Id = $null }
    }

    $id = $null
    $parent = $null
    $knownKeys = @{
        id = $true
        title = $true
        status = $true
        priority = $true
        progress_status = $true
        due_date = $true
        list = $true
        parent = $true
        tags = $true
        sort_order = $true
        delete_flag = $true
        created_at = $true
        updated_at = $true
        completed_at = $true
        deleted_at = $true
    }

    $previousKey = $null
    $blockScalarKey = $null

    for ($i = 1; $i -lt $endIndex; $i++) {
        $lineNumber = $i + 1
        $line = $lines[$i]
        $trimmed = $line.Trim()

        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) {
            continue
        }

        if ($null -ne $blockScalarKey) {
            if ($line -match "^\s+") {
                continue
            }
            $blockScalarKey = $null
        }

        if ($trimmed.StartsWith("- ")) {
            if ($previousKey -ne "tags") {
                $errors.Add((New-ValidationError -File $fileName -Line $lineNumber -Message "List item is only supported under 'tags'."))
            }
            $itemValue = $trimmed.Substring(2).Trim()
            if ($itemValue -match "\b(sort_order|delete_flag|status|priority|title)\s*:") {
                $errors.Add((New-ValidationError -File $fileName -Line $lineNumber -Message "List item appears to contain another YAML key. Split it onto a new line."))
            }
            if (Test-UnquotedColonValue -Value $itemValue) {
                $errors.Add((New-ValidationError -File $fileName -Line $lineNumber -Message "List item contains ':' and must be quoted."))
            }
            continue
        }

        if ($line -match "^\s+\S") {
            if ($previousKey -eq "tags" -or $null -ne $blockScalarKey) {
                continue
            }
            $errors.Add((New-ValidationError -File $fileName -Line $lineNumber -Message "Unexpected indented line in frontmatter."))
            continue
        }

        if ($line -notmatch "^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$") {
            $errors.Add((New-ValidationError -File $fileName -Line $lineNumber -Message "Invalid YAML key/value line. Expected 'key: value'."))
            continue
        }

        $key = $Matches[1]
        $value = $Matches[2]
        $previousKey = $key

        if (-not $knownKeys.ContainsKey($key)) {
            $errors.Add((New-ValidationError -File $fileName -Line $lineNumber -Message "Unknown frontmatter key '$key'."))
        }

        if ($key -eq "id") {
            $id = $value.Trim().Trim("'`"")
        }
        if ($key -eq "parent") {
            $parentValue = $value.Trim().Trim("'`"")
            if ($parentValue -ne "" -and $parentValue -ne "null") {
                $parent = $parentValue
            }
        }

        if ($value.Trim() -match "^[>|][+-]?$") {
            $blockScalarKey = $key
        }

        if (Test-UnquotedColonValue -Value $value) {
            $errors.Add((New-ValidationError -File $fileName -Line $lineNumber -Message "Value for '$key' contains ':' and must be quoted."))
        }

        if ($key -eq "tags" -and $value.Trim() -ne "" -and $value.Trim() -notmatch "^\[.*\]$") {
            $errors.Add((New-ValidationError -File $fileName -Line $lineNumber -Message "'tags' must be [] or a YAML list on following lines."))
        }
    }

    if ([string]::IsNullOrWhiteSpace($id)) {
        $errors.Add((New-ValidationError -File $fileName -Line 1 -Message "Required frontmatter key 'id' is missing or empty."))
    }

    return @{ Errors = $errors; Id = $id; Parent = $parent; File = $fileName }
}

if ([string]::IsNullOrWhiteSpace($TasksDir)) {
    $TasksDir = Resolve-DefaultTasksDir
}
else {
    $TasksDir = (Resolve-Path -LiteralPath $TasksDir).Path
}

if (-not (Test-Path -LiteralPath $TasksDir)) {
    throw "TasksDir not found: $TasksDir"
}

$files = Get-ChildItem -LiteralPath $TasksDir -Filter "T-*.md" -File | Sort-Object Name
$allErrors = New-Object System.Collections.Generic.List[object]
$allWarnings = New-Object System.Collections.Generic.List[object]
$ids = @{}
$parents = @{}
$filesById = @{}

foreach ($file in $files) {
    $result = Test-TaskFile -Path $file.FullName
    foreach ($errorItem in $result.Errors) {
        $allErrors.Add($errorItem)
    }

    $id = [string]$result.Id
    if (-not [string]::IsNullOrWhiteSpace($id)) {
        if ($ids.ContainsKey($id)) {
            $allErrors.Add((New-ValidationError -File $file.Name -Line 1 -Message "Duplicate task id '$id'. First seen in $($ids[$id])."))
        }
        else {
            $ids[$id] = $file.Name
            $filesById[$id] = $file.Name
            if (-not [string]::IsNullOrWhiteSpace([string]$result.Parent)) {
                $parents[$id] = [string]$result.Parent
            }
        }
    }
}

function Get-TaskDepth {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [hashtable]$Seen = @{}
    )

    if ($Seen.ContainsKey($Id)) {
        return @{ Depth = 1; Cycle = $true; MissingParent = $false }
    }

    if (-not $parents.ContainsKey($Id)) {
        return @{ Depth = 1; Cycle = $false; MissingParent = $false }
    }

    $parentId = [string]$parents[$Id]
    if (-not $ids.ContainsKey($parentId)) {
        return @{ Depth = 1; Cycle = $false; MissingParent = $true }
    }

    $nextSeen = @{}
    foreach ($key in $Seen.Keys) { $nextSeen[$key] = $true }
    $nextSeen[$Id] = $true

    $parentResult = Get-TaskDepth -Id $parentId -Seen $nextSeen
    return @{
        Depth = ([int]$parentResult.Depth + 1)
        Cycle = [bool]$parentResult.Cycle
        MissingParent = [bool]$parentResult.MissingParent
    }
}

foreach ($id in $ids.Keys) {
    $depthResult = Get-TaskDepth -Id $id
    $fileName = [string]$filesById[$id]
    if ($depthResult.Cycle) {
        $allWarnings.Add((New-ValidationWarning -File $fileName -Message "Parent chain has a cycle. The task will be shown as a root-level warning item."))
    }
    elseif ($depthResult.MissingParent) {
        $allWarnings.Add((New-ValidationWarning -File $fileName -Message "Parent task was not found. The task will be shown at root level."))
    }
    elseif ([int]$depthResult.Depth -gt 5) {
        $allWarnings.Add((New-ValidationWarning -File $fileName -Message "Task depth is $($depthResult.Depth). Depth 6 or deeper will be shown at root level with a warning."))
    }
}

if (-not $Quiet) {
    Write-Host "Cotaska task validation"
    Write-Host "TasksDir: $TasksDir"
    Write-Host "Files   : $($files.Count)"
}

if ($allErrors.Count -gt 0) {
    if (-not $Quiet) {
        Write-Host ""
        Write-Host "NG: $($allErrors.Count) validation error(s)." -ForegroundColor Red
        $allErrors | Sort-Object File, Line | Format-Table -AutoSize
    }
    exit 1
}

if ($allWarnings.Count -gt 0 -and -not $Quiet) {
    Write-Host ""
    Write-Host "WARN: $($allWarnings.Count) hierarchy warning(s)." -ForegroundColor Yellow
    $allWarnings | Sort-Object File | Format-Table -AutoSize
}

if (-not $Quiet) {
    Write-Host "OK: no validation errors." -ForegroundColor Green
}
exit 0
