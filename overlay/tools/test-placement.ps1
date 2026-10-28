<#
  位置计算的回归测试（不需要动真实任务栏）。
  用法：.\tools\test-placement.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'placement.ps1')

$fails = 0
function Check([string]$name, $got, $want) {
    $ok = ([string]$got -eq [string]$want)
    if (-not $ok) { $script:fails++ }
    $tag = 'FAIL  '
    if ($ok) { $tag = 'PASS  ' }
    Write-Host ($tag + $name + '  got=' + $got + ' want=' + $want)
}

# 1. 常见：2048x1152 逻辑分辨率，任务栏在下面 48 高
$p = Get-Placement -WorkLeft 0 -WorkTop 0 -WorkWidth 2048 -WorkHeight 1104 -StripHeight 200 -TaskbarEdge 3
Check '下任务栏 top' $p.Top 904
Check '下任务栏 ground' $p.Ground 1104
Check '下任务栏 width' $p.Width 2048
Check '下任务栏 edge' $p.Edge 'bottom'

# 2. 任务栏在上：工作区从 48 开始，底边 = 屏幕底
$p = Get-Placement -WorkLeft 0 -WorkTop 48 -WorkWidth 2048 -WorkHeight 1104 -StripHeight 200 -TaskbarEdge 1
Check '上任务栏 ground = 屏幕底' $p.Ground 1152
Check '上任务栏 top' $p.Top 952
Check '上任务栏 edge' $p.Edge 'top'

# 3. 任务栏在左：60 宽
$p = Get-Placement -WorkLeft 60 -WorkTop 0 -WorkWidth 1988 -WorkHeight 1152 -StripHeight 200 -TaskbarEdge 0
Check '左任务栏 left' $p.Left 60
Check '左任务栏 width' $p.Width 1988
Check '左任务栏 不压任务栏' ($p.Left -ge 60) 'True'

# 4. 自动隐藏：工作区 = 整屏
$p = Get-Placement -WorkLeft 0 -WorkTop 0 -WorkWidth 2048 -WorkHeight 1152 -StripHeight 200 -TaskbarEdge 3
Check '自动隐藏 ground = 屏幕底' $p.Ground 1152

# 5. 换分辨率 / 加高任务栏
$p = Get-Placement -WorkLeft 0 -WorkTop 0 -WorkWidth 2560 -WorkHeight 1360 -StripHeight 200 -TaskbarEdge 3
Check '加高任务栏 ground' $p.Ground 1360
Check '加高任务栏 width' $p.Width 2560

# 6. 取不到任务栏信息时也要有个合理默认
$p = Get-Placement -WorkLeft 0 -WorkTop 0 -WorkWidth 2048 -WorkHeight 1104 -StripHeight 160 -TaskbarEdge -1
Check '未知 edge 也能算' $p.Top 944
Check '未知 edge 标记' $p.Edge 'unknown'

Write-Host ''
if ($fails -gt 0) { Write-Host ('有 ' + $fails + ' 项失败'); exit 1 }
Write-Host '全部通过'
