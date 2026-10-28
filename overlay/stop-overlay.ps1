<#
  【兼容入口】停止桌面图层。
  真正的实现在 restart-layers.ps1 -Stop（会同时停守护和两块图层）。
#>
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$fwd = @{ Stop = $true }
if ($Quiet) { $fwd['Quiet'] = $true }
& (Join-Path $PSScriptRoot 'restart-layers.ps1') @fwd
exit $LASTEXITCODE
