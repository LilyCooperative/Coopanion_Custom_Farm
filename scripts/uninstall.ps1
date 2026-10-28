<#
  停用 / 卸载这套自定义农场插件（**不删 Pet 文件**，随时可以再 install）。

    .\scripts\uninstall.ps1                   停图层 + 删登录自启快捷方式
    .\scripts\uninstall.ps1 -RemoveExtension  另外从 Coopanion 的扩展清单里去掉 link（需重启 App）

  用法（在 Pet 根目录）：
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
#>
param(
    [string]$PetHome = (Split-Path -Parent $PSScriptRoot),
    [string]$CoopanionData = (Join-Path $env:LOCALAPPDATA 'Programs\Coopanion\data'),
    [switch]$RemoveExtension
)
$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

Write-Host ''
Write-Host '=== 自定义农场 · 停用 ===' -ForegroundColor Cyan

# 1) 停两块图层（守护 + 背景 + 野草）
$layers = Join-Path $PetHome 'overlay\restart-layers.ps1'
if (Test-Path -LiteralPath $layers) {
    & $layers -Stop -Quiet | Out-Null
    Write-Host '  已停止桌面图层' -ForegroundColor Green
}

# 2) 删登录快捷方式（老版本留下的）+ 旧静默启动器
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Coopanion 种田图层.lnk'
$vbs = Join-Path $PetHome 'overlay\layers-hidden.vbs'
foreach ($f in @($lnk, $vbs)) {
    if (Test-Path -LiteralPath $f) {
        Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
        Write-Host ('  已删除 ' + $f) -ForegroundColor Green
    }
}

# 3) 可选：从扩展清单里去掉 link（新名字 + 历史名字都摘）
if ($RemoveExtension) {
    $pkgFile = Join-Path $CoopanionData 'extensions\package.json'
    if (Test-Path -LiteralPath $pkgFile) {
        $pkg = Get-Content -LiteralPath $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $targets = @('custom-farm', 'cortico-world-farm')
        $removed = @()
        foreach ($name in $targets) {
            if ($pkg.dependencies -and $pkg.dependencies.PSObject.Properties[$name]) {
                $pkg.dependencies.PSObject.Properties.Remove($name)
                $removed += $name
            }
        }
        if ($removed.Count -gt 0) {
            $text = $pkg | ConvertTo-Json -Depth 8
            # 这个文件不能带 BOM，否则 Node JSON.parse 报错，Coopanion 起不来
            [System.IO.File]::WriteAllText($pkgFile, $text, $utf8NoBom)
            Write-Host ('  已从扩展清单移除 ' + ($removed -join '、')) -ForegroundColor Green
            Write-Host '  重启一次 Coopanion 生效（先停用「自定义农场」World）'
        } else {
            Write-Host '  扩展清单里本来就没有 custom-farm'
        }
    } else {
        Write-Host ('  找不到 ' + $pkgFile)
    }
}

Write-Host ''
Write-Host '项目文件夹和安装目录原样保留；要恢复就再跑 scripts\install.ps1。' -ForegroundColor DarkGray
Write-Host ''
