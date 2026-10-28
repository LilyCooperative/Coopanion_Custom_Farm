<#
  Re-save every .ps1 of this plugin as UTF-8 **with BOM**.

  Why: Windows PowerShell 5.1 reads a .ps1 without BOM using the system ANSI
  code page (GBK on this machine), not UTF-8.  A source file that contains
  Chinese text but lost its BOM then fails to parse and the process exits
  silently before writing any log -- which looks exactly like "the layer
  disappeared".  Several editors (and some agent tooling) strip the BOM on
  every save, so run this after editing.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\fix-encoding.ps1
#>
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
# this file is <Pet>\overlay\tools\fix-encoding.ps1 -> scan the whole <Pet> folder
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$utf8 = New-Object System.Text.UTF8Encoding($false)
$bom = New-Object System.Text.UTF8Encoding($true)
$fixed = 0
$bad = 0

$files = Get-ChildItem -LiteralPath $root -Recurse -File -Filter *.ps1 |
    Where-Object { $_.FullName -notmatch '_backup' }
foreach ($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $has = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    if ($has) { continue }
    $text = [System.IO.File]::ReadAllText($f.FullName, $utf8)
    [System.IO.File]::WriteAllText($f.FullName, $text, $bom)
    $fixed++
    if (-not $Quiet) { Write-Output ('BOM added: ' + $f.FullName.Substring($root.Length + 1)) }
}

# Verify they parse the way PowerShell 5.1 will read them.
foreach ($f in $files) {
    $text = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::Default)
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$errs)
    if ($errs -and $errs.Count -gt 0) {
        $bad++
        Write-Output ('PARSE FAIL: ' + $f.FullName.Substring($root.Length + 1) + ' line ' + $errs[0].Extent.StartLineNumber + ': ' + $errs[0].Message)
    }
}

Write-Output ('files=' + $files.Count + ' bomFixed=' + $fixed + ' parseFailed=' + $bad)
if ($bad -gt 0) { exit 1 }
exit 0
