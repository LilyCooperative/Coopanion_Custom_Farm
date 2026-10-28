<#
  显式重置自定义农场的存档（有意为之的重开，不是 bug）。
  顺序很重要：先停 World（停机时会存档）→ 删文件 → 再启动，否则删了会被停机保存写回去。

  用法：.\tools\reset-farm.ps1
        .\tools\reset-farm.ps1 -DryRun     只看会删什么
#>
param(
    [string]$Base = 'http://127.0.0.1:17788',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

$stateFile = Join-Path $env:LOCALAPPDATA 'Programs\Coopanion\data\home\companion\data\farm\state.json'

if (Test-Path -LiteralPath $stateFile) {
    $s = [System.IO.File]::ReadAllText($stateFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    Write-Host ('当前存档: 第 ' + $s.day + ' 天 · 金币 ' + $s.coins + ' · savedAt ' + $s.savedAt)
} else {
    Write-Host '当前没有存档文件'
}
Write-Host ('存档路径: ' + $stateFile)

if ($DryRun) { Write-Host '（-DryRun，不动手）'; return }

$offBody = @{ id = 'farm'; enabled = $false } | ConvertTo-Json
$onBody  = @{ id = 'farm'; enabled = $true }  | ConvertTo-Json

Write-Host '1/3 停 World（会存档）…'
Invoke-RestMethod -Uri "$Base/api/worlds/activation" -Method Post -ContentType 'application/json' -Body $offBody -TimeoutSec 30 | Out-Null
Start-Sleep -Seconds 2

Write-Host '2/3 删存档…'
if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile -Force }
Get-ChildItem -LiteralPath (Split-Path $stateFile) -Filter '*.tmp-*' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host '3/3 启动 World（新开局）…'
Invoke-RestMethod -Uri "$Base/api/worlds/activation" -Method Post -ContentType 'application/json' -Body $onBody -TimeoutSec 30 | Out-Null
Start-Sleep -Seconds 3

$s2 = [System.IO.File]::ReadAllText($stateFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
Write-Host ('新存档: 第 ' + $s2.day + ' 天 · 金币 ' + $s2.coins + ' · 种着 ' + $s2.plots.Count + ' 棵：' + (($s2.plots | ForEach-Object { $_.crop }) -join '/'))
