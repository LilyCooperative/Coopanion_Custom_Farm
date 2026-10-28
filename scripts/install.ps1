<#
  一键安装 / 迁移：把 <Pet> 这套东西接到本机的 Coopanion 上。

  用法（在新的电脑上，整个 Pet 文件夹拷过来之后，在 Pet 根目录跑）：
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1

  可选参数：
    -PetHome <dir>         Pet 文件夹在哪（默认=本脚本的上一级）
    -CoopanionData <dir>   Coopanion 的 data 目录（默认 %LOCALAPPDATA%\Programs\Coopanion\data）
    -NoOverlay             不启动桌面图层
#>
param(
    [string]$PetHome = (Split-Path -Parent $PSScriptRoot),
    [string]$CoopanionData = (Join-Path $env:LOCALAPPDATA 'Programs\Coopanion\data'),
    [switch]$NoOverlay
)

$ErrorActionPreference = 'Stop'
$steps = New-Object System.Collections.Generic.List[string]
function Step([string]$msg) { $steps.Add($msg); Write-Host ('  ' + $msg) }

Write-Host ''
Write-Host '=== 自定义农场 · 安装 ===' -ForegroundColor Cyan
Write-Host ('Pet 目录      : ' + $PetHome)
Write-Host ('Coopanion data: ' + $CoopanionData)
Write-Host ''

# 1) 检查目录结构
$need = @(
    'custom-farm\src\index.js',
    'custom-farm\src\world.js',
    'overlay\overlay.ps1',
    'bag\bag.ps1',
    'assets\sprites'
)
foreach ($n in $need) {
    if (-not (Test-Path -LiteralPath (Join-Path $PetHome $n))) {
        throw ('Pet 目录不完整，缺少：' + $n + '（整个 Pet 文件夹要一起拷贝）')
    }
}
Step '目录结构完整（扩展 / 图层 / 背包 / 素材）'

# 2) 注册扩展到 Coopanion
$extDir = Join-Path $CoopanionData 'extensions'
if (-not (Test-Path -LiteralPath $extDir)) { throw ('找不到 Coopanion 的扩展目录：' + $extDir + '（先启动一次 Coopanion）') }
$pkgFile = Join-Path $extDir 'package.json'
if (-not (Test-Path -LiteralPath $pkgFile)) { throw ('找不到 ' + $pkgFile) }

$pkg = Get-Content -LiteralPath $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
$EXT_NAME = 'custom-farm'
# 旧名字：安装时顺手摘掉，避免 extensions\package.json 里留一个指向已删除目录的死链接
$LEGACY_NAMES = @('cortico-world-farm')
$link = 'link:' + ($PetHome -replace '\\', '/') + '/' + $EXT_NAME

$json = Get-Content -LiteralPath $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $json.dependencies) { $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
$legacyRemoved = @()
foreach ($old in $LEGACY_NAMES) {
    if ($json.dependencies.PSObject.Properties[$old]) {
        $json.dependencies.PSObject.Properties.Remove($old)
        $legacyRemoved += $old
    }
}
$current = $null
if ($json.dependencies.PSObject.Properties[$EXT_NAME]) { $current = $json.dependencies.$EXT_NAME }
if ($current -eq $link -and $legacyRemoved.Count -eq 0) {
    Step ('扩展已注册：' + $link)
} else {
    $json.dependencies | Add-Member -Force -NotePropertyName $EXT_NAME -NotePropertyValue $link
    # 注意：PS 5.1 的 Set-Content -Encoding UTF8 会加 BOM，Node 的 JSON.parse 会直接报错（Coopanion 起不来）
    $jsonText = ($json | ConvertTo-Json -Depth 8)
    [System.IO.File]::WriteAllText($pkgFile, $jsonText, (New-Object System.Text.UTF8Encoding($false)))
    Step ('扩展已注册：' + $link)
    if ($legacyRemoved.Count -gt 0) { Step ('  已移除旧注册：' + ($legacyRemoved -join '、')) }
}

# 3) 让 pnpm 把链接装上（Coopanion 自带 pnpm；没有就跑不了，给出提示）
$pnpm = 'pnpm'
$hasPnpm = $null -ne (Get-Command $pnpm -ErrorAction SilentlyContinue)
if ($hasPnpm) {
    Push-Location $extDir
    try {
        & $pnpm install --silent 2>&1 | Out-Null
        Step 'pnpm install 完成（扩展链接已就绪）'
    } catch {
        Step ('pnpm install 失败，Coopanion 启动时可能也会自己装：' + $_.Exception.Message)
    } finally { Pop-Location }
} else {
    Step '本机 PATH 里没有 pnpm —— Coopanion 启动时会自己装扩展，跳过'
}

# 4) 启动两块桌面图层（单守护：背景层 + 野草前景层，自愈、无弹窗）
if (-not $NoOverlay) {
    $layers = Join-Path $PetHome 'overlay\restart-layers.ps1'
    & $layers -Restart -WaitSec 25 | ForEach-Object { if ($_ -ne '') { Step ('  ' + $_) } }
    if ($LASTEXITCODE -ne 0) { Step '图层没完全起来（可以再跑一次 overlay\restart-layers.ps1 看日志）' }
    else { Step '两块桌面图层已启动' }
}

# 5) 图层现在跟着桌宠走（桌宠退出/隐藏，图层也退出/隐藏），不再放登录自启快捷方式；
#    顺手清理老版本放过的那个 .lnk / 启动器
if (-not $NoOverlay) {
    $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Coopanion 种田图层.lnk'
    $vbs = Join-Path $PetHome 'overlay\layers-hidden.vbs'
    foreach ($f in @($lnk, $vbs)) {
        if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue; Step ('  已清理 ' + $f) }
    }
    Step '图层跟着桌宠启停（不需要登录自启）'
}

Write-Host ''
Write-Host '=== 完成 ===' -ForegroundColor Green
Write-Host '接下来：'
Write-Host '  1. 重启 Coopanion（或者它会自己加载新扩展）'
Write-Host '  2. 在控制台启用「自定义农场」World'
Write-Host '  3. 对桌宠说「打开背包」（farm_bag 工具），或手动运行 bag\bag.ps1'
Write-Host ''
Write-Host ('共 ' + $steps.Count + ' 步，全部完成。') -ForegroundColor DarkGray
