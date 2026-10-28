<#
  【兼容入口】启动野草前景层（叠在桌宠上面）。

  现在两层由 restart-layers.ps1 统一管理：缺哪块补哪块。这里转发到 -Ensure，
  不会重启已经在跑的图层。
#>
param(
    [string]$StatePath = '',
    [string]$PetApi = '',
    [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
if (-not $Quiet) { Write-Host '提示：start-weeds-layer.ps1 已并入 restart-layers.ps1 -Ensure' }
$fwd = @{}
if ($Quiet) { $fwd['Quiet'] = $true }
& (Join-Path $PSScriptRoot 'restart-layers.ps1') @fwd
exit $LASTEXITCODE
