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
        task_file_path = $true
        created_at = $true
        updated_at = $true
        completed_at = $true
        deleted_at = $true
        progress = $true
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

    return @{ Errors = $errors; Id = $id }
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
$ids = @{}

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
        }
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

if (-not $Quiet) {
    Write-Host "OK: no validation errors." -ForegroundColor Green
}
exit 0
