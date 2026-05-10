@echo off
setlocal

rem Remove obsolete "progress:" lines from Markdown frontmatter.
rem Usage:
rem   remove-progress-field.cmd
rem   remove-progress-field.cmd "D:\path\to\data\tasks"

set "COTASKA_PROGRESS_ARG=%~1"
set "COTASKA_PROGRESS_SCRIPT_DIR=%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $arg=$env:COTASKA_PROGRESS_ARG; $scriptDir=(Resolve-Path -LiteralPath $env:COTASKA_PROGRESS_SCRIPT_DIR).Path; if([string]::IsNullOrWhiteSpace($arg)){ $candidates=@((Join-Path $scriptDir '..\data\tasks')); $repoRoot=(Resolve-Path -LiteralPath (Join-Path $scriptDir '..\..')).Path; $mgmt=Join-Path $repoRoot '00_mgmt'; if(Test-Path -LiteralPath $mgmt){ Get-ChildItem -LiteralPath $mgmt -Directory | ForEach-Object { $candidates += (Join-Path $_.FullName 'data\tasks') } }; $candidates += (Join-Path $repoRoot 'data\tasks'); $target=$candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1; if(-not $target){ throw 'Could not resolve data\tasks folder. Specify TasksDir explicitly.' } } else { $target=$arg }; $target=(Resolve-Path -LiteralPath $target).Path; $utf8=New-Object System.Text.UTF8Encoding($false); $changed=0; Get-ChildItem -LiteralPath $target -Recurse -Filter '*.md' -File | ForEach-Object { $text=[System.IO.File]::ReadAllText($_.FullName,[System.Text.Encoding]::UTF8); if(-not $text.StartsWith('---')){ return }; $match=[regex]::Match($text,'(?s)^---\r?\n(.*?)\r?\n---'); if(-not $match.Success){ return }; $body=$match.Groups[1].Value; $updated=[regex]::Replace($body,'(?m)^progress\s*:\s*[^\r\n]*(\r?\n)?',''); if($updated -ne $body){ $newText=$text.Substring(0,$match.Groups[1].Index)+$updated+$text.Substring($match.Groups[1].Index+$match.Groups[1].Length); [System.IO.File]::WriteAllText($_.FullName,$newText,$utf8); Write-Host ('UPDATED: '+$_.FullName); $script:changed++ } }; Write-Host ('Done. Updated '+$changed+' file(s). Target: '+$target)"

exit /b %ERRORLEVEL%
