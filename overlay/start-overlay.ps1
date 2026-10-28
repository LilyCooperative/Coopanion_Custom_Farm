<#
  【兼容入口】启动桌面图层。

  以前这里是"单窗口调试启动器"。现在图层是一个守护进程统一管理（背景层 + 野草层），
  这个入口只转发到 restart-layers.ps1，行为 = 重启两层。

  真正的实现在 restart-layers.ps1。
#>
param(
    [switch]$Clickable,
    [switch]$NoAnchor,
    [switch]$NoWeeds,
    [string]$StatePath = '',
    [int]$TimeoutSec = 20,
    [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
if (-not $Quiet) {
    Write-Host '提示：start-overlay.ps1 已并入 restart-layers.ps1（-Restart 会重启两层）'
}
$fwd = @{ Restart = $true }
if ($Quiet) { $fwd['Quiet'] = $true }
& (Join-Path $PSScriptRoot 'restart-layers.ps1') @fwd
exit $LASTEXITCODE
