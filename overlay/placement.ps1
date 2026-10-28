<#
  位置计算（纯函数，便于测试）：把"工作区 + 任务栏"换算成图层窗口的矩形。
  规则：作物站在**工作区底边**上。
    - 任务栏在下：工作区底边就是任务栏上沿 -> 作物正好种在任务栏边框上
    - 任务栏在上/左/右：工作区底边就是屏幕底边 -> 跟桌宠一样站在屏幕底边
  横向铺满工作区，所以任务栏在左/右时也不会伸到任务栏上去。
#>
function Get-Placement {
    param(
        [Parameter(Mandatory)][double]$WorkLeft,
        [Parameter(Mandatory)][double]$WorkTop,
        [Parameter(Mandatory)][double]$WorkWidth,
        [Parameter(Mandatory)][double]$WorkHeight,
        [int]$StripHeight = 220,
        [int]$TaskbarEdge = -1
    )
    $groundY = $WorkTop + $WorkHeight
    $top = $groundY - $StripHeight
    $edgeName = switch ($TaskbarEdge) {
        0 { 'left' }
        1 { 'top' }
        2 { 'right' }
        3 { 'bottom' }
        default { 'unknown' }
    }
    return [pscustomobject]@{
        Left     = [Math]::Round($WorkLeft)
        Top      = [Math]::Round($top)
        Width    = [Math]::Round($WorkWidth)
        Height   = $StripHeight
        Ground   = [Math]::Round($groundY)
        Edge     = $edgeName
        EdgeCode = $TaskbarEdge
    }
}
