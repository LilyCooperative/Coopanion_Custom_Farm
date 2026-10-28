<#
  【兼容入口】停止两块图层（守护 + 背景层 + 野草层）。
  真正的实现在 restart-layers.ps1 -Stop。
#>
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$fwd = @{ Stop = $true }
if ($Quiet) { $fwd['Quiet'] = $true }
& (Join-Path $PSScriptRoot 'restart-layers.ps1') @fwd
exit $LASTEXITCODE
