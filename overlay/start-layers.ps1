<#
  【兼容入口】启动两块桌面图层。

  真正的实现在 restart-layers.ps1（单守护、幂等、自愈）。这里只是转发，
  免得旧文档 / 旧快捷方式里的命令失效。新代码请直接用：

      .\restart-layers.ps1            # 确保在跑（幂等）
      .\restart-layers.ps1 -Restart   # 强制重来
#>
param(
    [switch]$Restart,
    [switch]$Quiet,
    [string]$StatePath = '',
    [string]$PetApi = ''
)
$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'restart-layers.ps1'
$fwd = @{}
if ($Restart) { $fwd['Restart'] = $true }
if ($Quiet) { $fwd['Quiet'] = $true }
if ($StatePath -and -not $Quiet) { Write-Host '（-StatePath 已废弃：状态文件固定是 overlay\runtime\state.json）' }
Write-Host '提示：start-layers.ps1 现在只是 restart-layers.ps1 的转发入口'
& $target @fwd
exit $LASTEXITCODE
