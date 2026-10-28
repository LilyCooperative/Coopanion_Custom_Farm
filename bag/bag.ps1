<#
  背包窗口：由 farm_bag 工具或手动运行打开（不再挂桌宠右键菜单）。

  外观照游戏里的 UI 做法：圆角面板 + 斜面边框 + 物品格栅（见 art\panel.png、art\slot.png）。
  只读 Pet\overlay\runtime\state.json 里的 inventory，每秒刷新。
#>
param(
    [string]$StatePath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'overlay\runtime\state.json'),
    [string]$AssetsDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'assets\sprites'),
    [string]$LogPath = '',
    [int]$Seconds = 0,
    [Alias('Page')]
    [string]$StartPage = 'bag',
    [string]$PetApi = ''
)

$ErrorActionPreference = 'Stop'

# 桌宠 API 端口不写死：优先 -PetApi / PET_API，其次 Coopanion config，最后回退 7797。
function Resolve-PetApi([string]$explicit) {
    if ($explicit) { return $explicit }
    if ($env:PET_API) { return [string]$env:PET_API }
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:COOPANION_CONFIG) { $candidates.Add([string]$env:COOPANION_CONFIG) }
    if ($env:COOPANION_DATA) { $candidates.Add((Join-Path $env:COOPANION_DATA 'home\companion\config.json')) }
    if ($env:LOCALAPPDATA) { $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\Coopanion\data\home\companion\config.json')) }
    if ($env:APPDATA) { $candidates.Add((Join-Path $env:APPDATA 'Coopanion\data\home\companion\config.json')) }
    foreach ($file in $candidates) {
        try {
            if (-not (Test-Path -LiteralPath $file)) { continue }
            $cfg = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
            $port = [int]$cfg.worlds.'desktop-pet'.port
            if ($port -gt 0) { return ('http://127.0.0.1:' + $port + '/api/state') }
        } catch { }
    }
    return 'http://127.0.0.1:7797/api/state'
}
$PetApi = Resolve-PetApi $PetApi
$ART = Join-Path $PSScriptRoot 'art'
# 家具页签开关：暂时不显示（摆放方案还没定）。要和 shop.js 的 FURNITURE_ENABLED 一起开。
$ShowFurniture = $false
if (-not $LogPath) { $LogPath = Join-Path $PSScriptRoot 'bag.log' }
function Log([string]$m) {
    try { Add-Content -LiteralPath $LogPath -Encoding utf8 -Value ((Get-Date).ToString('HH:mm:ss.fff') + ' [bag] ' + $m) } catch { }
}
Log ('start pid=' + $PID)

$pidFile = Join-Path $PSScriptRoot 'bag.pid'
try {
    if (Test-Path -LiteralPath $pidFile) {
        $old = (Get-Content -LiteralPath $pidFile -Raw).Trim()
        if ($old -match '^\d+$' -and (Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue)) {
            Log ('already running: ' + $old)
            exit 0
        }
    }
} catch { }
try { Set-Content -LiteralPath $pidFile -Value $PID -Encoding ascii } catch { }

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$ZH_NAME = @{
    tomato = '番茄'; pumpkin = '南瓜'; corn = '玉米'; potato = '土豆'
    strawberry = '草莓'; chinese_cabbage = '卷心菜'; wheat = '小麦'
}

$script:cache = @{}

# 颜色字符串 -> 画刷
function B([string]$hex) {
    return (New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString($hex)))
}
$CMD_DIR = Join-Path (Split-Path -Parent $StatePath) 'commands'

# 给 World 发一条命令（World 每秒扫一次这个目录）
function Send-Cmd($obj) {
    try {
        if (-not (Test-Path -LiteralPath $CMD_DIR)) { New-Item -ItemType Directory -Force -Path $CMD_DIR | Out-Null }
        $name = '{0}-{1}.json' -f ([DateTime]::Now.ToString('HHmmssfff')), (Get-Random -Maximum 9999)
        $json = $obj | ConvertTo-Json -Compress -Depth 4
        [System.IO.File]::WriteAllText((Join-Path $CMD_DIR $name), $json, (New-Object System.Text.UTF8Encoding($false)))
        Log ('cmd -> ' + $json)
    } catch { Log ('cmd failed: ' + $_.Exception.Message) }
}
function Img([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    if ($script:cache.ContainsKey($path)) { return $script:cache[$path] }
    try {
        $b = [System.Windows.Media.Imaging.BitmapImage]::new()
        $b.BeginInit(); $b.UriSource = [Uri]::new($path); $b.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad; $b.EndInit(); $b.Freeze()
        $script:cache[$path] = $b
        return $b
    } catch { return $null }
}

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="FarmBag" Width="360" Height="400" WindowStyle="None"
        AllowsTransparency="True" Background="Transparent" Topmost="True"
        ShowInTaskbar="False" ResizeMode="NoResize" WindowStartupLocation="CenterScreen">
  <Grid>
    <Image x:Name="Panel" Stretch="Fill"/>
    <Grid Margin="14,8,14,14">
      <Grid.RowDefinitions>
        <RowDefinition Height="52"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <Grid Grid.Row="0">
        <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
          <Image x:Name="TitleIcon" Width="40" Height="32" VerticalAlignment="Center"/>
          <TextBlock x:Name="Coins" Text="金币 0" Margin="8,0,0,0" VerticalAlignment="Center"
                     FontFamily="Microsoft YaHei UI" FontSize="13" FontWeight="SemiBold" Foreground="#FFF0D27A"/>
        </StackPanel>
        <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Center" Margin="0,0,30,0">
          <Button x:Name="TabBag" Content="背包" Width="44" Height="22" Margin="0,0,4,0"
                  FontFamily="Microsoft YaHei UI" FontSize="11" Foreground="#FFE9DFC8" Background="#33FFFFFF" BorderThickness="0" Cursor="Hand"/>
          <Button x:Name="TabShop" Content="商店" Width="44" Height="22" Margin="0,0,4,0"
                  FontFamily="Microsoft YaHei UI" FontSize="11" Foreground="#FFE9DFC8" Background="#22FFFFFF" BorderThickness="0" Cursor="Hand"/>
          <Button x:Name="TabOwn" Content="家具" Width="44" Height="22"
                  FontFamily="Microsoft YaHei UI" FontSize="11" Foreground="#FFE9DFC8" Background="#22FFFFFF" BorderThickness="0" Cursor="Hand"/>
        </StackPanel>
        <Button x:Name="CloseBtn" Content="×" Width="24" Height="22" HorizontalAlignment="Right" VerticalAlignment="Top"
                ToolTip="关闭"
                FontFamily="Microsoft YaHei UI" FontSize="13" Foreground="#E6FFFFFF" Background="#33FFFFFF" BorderThickness="0" Cursor="Hand"/>
      </Grid>

      <Grid Grid.Row="1" Margin="0,6,0,0">
        <Canvas x:Name="Slots" Width="304" Height="286" HorizontalAlignment="Left" VerticalAlignment="Top"/>
        <ScrollViewer x:Name="ShopScroll" Visibility="Collapsed" VerticalScrollBarVisibility="Auto">
          <Canvas x:Name="ShopSlots" Width="304" Height="286" HorizontalAlignment="Left" VerticalAlignment="Top"/>
        </ScrollViewer>
        <ScrollViewer x:Name="OwnScroll" Visibility="Collapsed" VerticalScrollBarVisibility="Auto">
          <StackPanel x:Name="OwnList"/>
        </ScrollViewer>
      </Grid>

      <TextBlock x:Name="Foot" Grid.Row="2" Margin="2,6,0,0" FontFamily="Microsoft YaHei UI" FontSize="11" Foreground="#D9CBBFA0"/>
    </Grid>
  </Grid>
</Window>
"@

$win = [Windows.Markup.XamlReader]::Parse($xaml)
if (-not $ShowFurniture) { $win.FindName('TabOwn').Visibility = 'Collapsed' }
$win.FindName('Panel').Source = Img (Join-Path $ART 'panel.png')
$win.FindName('TitleIcon').Source = Img (Join-Path $AssetsDir 'ui_menuicon_farm.png')
$win.FindName('CloseBtn').Add_Click({ $win.Close() })
$win.FindName('Panel').Add_MouseLeftButtonDown({ try { $win.DragMove() } catch { } })
$win.FindName('TabBag').Add_Click({ Show-Page 'bag' })
$win.FindName('TabShop').Add_Click({ Show-Page 'shop' })
$win.FindName('TabOwn').Add_Click({ Show-Page 'own' })

$slots = $win.FindName('Slots')
$shopScroll = $win.FindName('ShopScroll')
$shopSlots = $win.FindName('ShopSlots')
$ownScroll = $win.FindName('OwnScroll')
$ownList = $win.FindName('OwnList')
$coinsText = $win.FindName('Coins')
$script:page = 'bag'
$script:lastState = $null

function Show-Page([string]$name) {
    if ($name -eq 'own' -and -not $ShowFurniture) { $name = 'bag' }
    $script:page = $name
    $slots.Visibility = $(if ($name -eq 'bag') { 'Visible' } else { 'Collapsed' })
    $shopScroll.Visibility = $(if ($name -eq 'shop') { 'Visible' } else { 'Collapsed' })
    $ownScroll.Visibility = $(if ($name -eq 'own') { 'Visible' } else { 'Collapsed' })
    $win.FindName('TabBag').Background = B $(if ($name -eq 'bag') { '#44FFFFFF' } else { '#22FFFFFF' })
    $win.FindName('TabShop').Background = B $(if ($name -eq 'shop') { '#44FFFFFF' } else { '#22FFFFFF' })
    $win.FindName('TabOwn').Background = B $(if ($name -eq 'own') { '#44FFFFFF' } else { '#22FFFFFF' })
    if ($script:lastState) { Fill-Page $script:lastState }
}

function New-Row([string]$title, [string]$sub, [scriptblock]$onClick, [string]$btnText) {
    $bg = New-Object System.Windows.Controls.Border
    $bg.Background = B '#1AFFFFFF'
    $bg.CornerRadius = [System.Windows.CornerRadius]::new(6)
    $bg.Padding = New-Object System.Windows.Thickness(8,5,8,5)
    $bg.Margin = New-Object System.Windows.Thickness(0,0,0,5)
    $g = New-Object System.Windows.Controls.Grid
    $sp = New-Object System.Windows.Controls.StackPanel
    $t1 = New-Object System.Windows.Controls.TextBlock
    $t1.Text = $title
    $t1.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei UI')
    $t1.FontSize = 12
    $t1.Foreground = B '#FFE9DFC8'
    [void]$sp.Children.Add($t1)
    if ($sub) {
        $t2 = New-Object System.Windows.Controls.TextBlock
        $t2.Text = $sub
        $t2.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei UI')
        $t2.FontSize = 10
        $t2.Foreground = B '#99FFFFFF'
        [void]$sp.Children.Add($t2)
    }
    [void]$g.Children.Add($sp)
    $btn = New-Object System.Windows.Controls.Button
    $btn.Content = $btnText
    $btn.Width = 46; $btn.Height = 22
    $btn.HorizontalAlignment = 'Right'; $btn.VerticalAlignment = 'Center'
    $btn.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei UI')
    $btn.FontSize = 11
    $btn.Foreground = B '#FF1A1418'
    $btn.Background = B '#FFF0D27A'
    $btn.BorderThickness = New-Object System.Windows.Thickness(0)
    $btn.Cursor = 'Hand'
    $btn.Add_Click($onClick)
    [void]$g.Children.Add($btn)
    $bg.Child = $g
    return $bg
}

function Fill-Page($state) {
    $script:lastState = $state
    try { $coinsText.Text = ('金币 ' + [int]$state.coins) } catch { }
    if ($script:page -eq 'bag') {
        $bag = $state.inventory
        $rows = @()
        if ($bag -and $bag.items) {
            $rows = @($bag.items.PSObject.Properties | Where-Object { [int]$_.Value -gt 0 })
        }
        if ($rows.Count -eq 0) {
            $foot.Text = '背包是空的'
        } else {
            $total = 0
            foreach ($p in $rows) { $total += [int]$p.Value }
            $foot.Text = ('共 ' + $total + ' 件 · ' + $rows.Count + ' 种')
        }
    }
    if ($script:page -eq 'shop') {
        $shopSlots.Children.Clear()
        $items = @($state.shop | Where-Object { $null -ne $_ -and [int]$_.buy -gt 0 })
        $idx = 0
        foreach ($one in $items) {
            [void]$shopSlots.Children.Add((New-Shop-Slot $one $idx))
            $idx++
        }
        $rows = [Math]::Ceiling($items.Count / 4)
        $shopSlots.Height = [double]([Math]::Max(286, $rows * 70))
        if ($items.Count -eq 0) {
            $t = New-Object System.Windows.Controls.TextBlock
            $t.Text = '商店没有货'
            $t.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei UI')
            $t.FontSize = 11; $t.Foreground = B '#99FFFFFF'
            [System.Windows.Controls.Canvas]::SetLeft($t, 8)
            [System.Windows.Controls.Canvas]::SetTop($t, 8)
            [void]$shopSlots.Children.Add($t)
        }
        $foot.Text = '点图标买 1 个 · ￥ 是买价'
    } elseif ($script:page -eq 'own') {
        $ownList.Children.Clear()
        $owned = @($state.owned)
        if ($owned.Count -eq 0) {
            $t = New-Object System.Windows.Controls.TextBlock
            $t.Text = '还没有家具，去「商店」买一件'
            $t.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei UI')
            $t.FontSize = 11; $t.Foreground = B '#99FFFFFF'
            [void]$ownList.Children.Add($t)
            return
        }
        foreach ($o in $owned) {
            $one = $o
            $where = $(if ($null -ne $one.x) { '在 ' + [Math]::Round([double]$one.x * 100) + '% 处' } else { '未摆放' })
            $row = New-Row ([string]$one.name) $where { Send-Cmd @{ cmd = 'place'; uid = [int]$one.uid; x = 0.5 } } '摆'
            [void]$ownList.Children.Add($row)
        }
    }
}
$coinsText = $win.FindName('Coins')
$msgText = $win.FindName('Msg')
$foot = $win.FindName('Foot')
$slotImg = Img (Join-Path $ART 'slot.png')
$SLOT = 64

function New-Slot([string]$key, [int]$count, [int]$idx) {
    $g = New-Object System.Windows.Controls.Grid
    $g.Width = $SLOT; $g.Height = $SLOT
    [System.Windows.Controls.Canvas]::SetLeft($g, [double](($idx % 4) * ($SLOT + 10)))
    [System.Windows.Controls.Canvas]::SetTop($g, [double]([Math]::Floor($idx / 4) * ($SLOT + 10)))
    $g.Margin = New-Object System.Windows.Thickness(0)

    $btn = New-Object System.Windows.Controls.Button
    $btn.Background = [System.Windows.Media.Brushes]::Transparent
    $btn.BorderThickness = New-Object System.Windows.Thickness(0)
    $btn.Padding = New-Object System.Windows.Thickness(0)
    $btn.Cursor = 'Hand'
    $isDecor = $false
    if ($key -and $script:kindMap.ContainsKey($key)) { $isDecor = ([string]$script:kindMap[$key] -eq 'decor') }
    $btn.ToolTip = ('点一下卖 1 个，Shift+点全卖' + $(if ($key -and $script:priceMap.ContainsKey($key)) { '（单价 ' + $script:priceMap[$key] + ' 金币）' } else { '' }) + $(if ($isDecor) { '；右键放到 50%' } else { '' }))
    $btn.Add_Click({ param($snd, $ev)
        if (-not $key) { return }
        $all = [bool]([System.Windows.Input.Keyboard]::Modifiers -band [System.Windows.Input.ModifierKeys]::Shift)
        Send-Cmd @{ cmd = 'sell'; item = $key; count = $(if ($all) { 0 } else { 1 }) }
    })
    if ($isDecor) {
        $btn.Add_MouseRightButtonUp({ param($snd, $ev)
            if (-not $key) { return }
            $ev.Handled = $true
            Send-Cmd @{ cmd = 'placeItem'; item = $key; x = 0.5 }
        })
    }
    $inner = New-Object System.Windows.Controls.Grid
    $inner.Width = $SLOT; $inner.Height = $SLOT
    $btn.Content = $inner
    $g.Children.Add($btn) | Out-Null

    $bg = New-Object System.Windows.Controls.Image
    $bg.Source = $slotImg
    [void]$inner.Children.Add($bg)

    if (-not $key) { return $g }
    $iconName = $(if ($script:iconMap.ContainsKey($key)) { [string]$script:iconMap[$key] } else { 'icon_item_' + $key })
    $src = $null
    if ($iconName) { $src = Img (Join-Path $AssetsDir ($iconName + '.png')) }
    if ($src) {
        $ic = New-Object System.Windows.Controls.Image
        $ic.Source = $src
        $ic.Width = 48; $ic.Height = 48
        $ic.HorizontalAlignment = 'Center'
        $ic.VerticalAlignment = 'Center'
        [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($ic, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
        [void]$inner.Children.Add($ic)
    }

    $num = New-Object System.Windows.Controls.TextBlock
    $num.Text = [string]$count
    $num.FontFamily = New-Object System.Windows.Media.FontFamily('Consolas')
    $num.FontSize = 12
    $num.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString('#FFF6E7B8'))
    $num.HorizontalAlignment = 'Right'
    $num.VerticalAlignment = 'Bottom'
    $num.Margin = New-Object System.Windows.Thickness(0, 0, 4, 2)
    $fx = [System.Windows.Media.Effects.DropShadowEffect]::new()
    $fx.BlurRadius = 4; $fx.ShadowDepth = 0; $fx.Opacity = 0.9
    $fx.Color = [System.Windows.Media.ColorConverter]::ConvertFromString('#FF000000')
    $num.Effect = $fx
    [void]$inner.Children.Add($num)
    return $g
}

function New-Shop-Slot([object]$item, [int]$idx) {
    $S = 64
    $STEP = 70
    $g = New-Object System.Windows.Controls.Grid
    $g.Width = $S; $g.Height = $S
    [System.Windows.Controls.Canvas]::SetLeft($g, [double](($idx % 4) * $STEP))
    [System.Windows.Controls.Canvas]::SetTop($g, [double]([Math]::Floor($idx / 4) * $STEP))
    $g.Margin = New-Object System.Windows.Thickness(0)

    $one = $item
    $buy = [int]$one.buy
    $sell = [int]$one.sell
    $tip = [string]$one.name + ' · 买价 ￥' + $buy
    if ($sell -gt 0) { $tip += ' · 卖价 ￥' + $sell }
    $tip += '（点一下买 1 个）'

    $btn = New-Object System.Windows.Controls.Button
    $btn.Background = [System.Windows.Media.Brushes]::Transparent
    $btn.BorderThickness = New-Object System.Windows.Thickness(0)
    $btn.Padding = New-Object System.Windows.Thickness(0)
    $btn.Cursor = 'Hand'
    $btn.ToolTip = $tip
    $btn.Add_Click({
        if ($buy -le 0) { return }
        Send-Cmd @{ cmd = 'buy'; id = [string]$one.id }
    })
    $inner = New-Object System.Windows.Controls.Grid
    $inner.Width = $S; $inner.Height = $S
    $btn.Content = $inner
    [void]$g.Children.Add($btn)

    $bg = New-Object System.Windows.Controls.Image
    $bg.Source = $slotImg
    [void]$inner.Children.Add($bg)

    $iconName = $(if ($script:iconMap.ContainsKey([string]$one.id)) { [string]$script:iconMap[[string]$one.id] } else { 'icon_item_' + [string]$one.id })
    $src = $null
    if ($iconName) { $src = Img (Join-Path $AssetsDir ($iconName + '.png')) }
    if ($src) {
        $ic = New-Object System.Windows.Controls.Image
        $ic.Source = $src
        $ic.Width = 48; $ic.Height = 48
        $ic.HorizontalAlignment = 'Center'
        $ic.VerticalAlignment = 'Center'
        [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($ic, [System.Windows.Media.BitmapScalingMode]::NearestNeighbor)
        [void]$inner.Children.Add($ic)
    }

    # 和背包格子一样的位置：右下角。背包放数量，商店放买价。
    $price = New-Object System.Windows.Controls.TextBlock
    $price.Text = '￥' + $buy
    $price.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei UI')
    $price.FontSize = 10
    $price.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString('#FFF0D27A'))
    $price.HorizontalAlignment = 'Right'
    $price.VerticalAlignment = 'Bottom'
    $price.Margin = New-Object System.Windows.Thickness(0, 0, 3, 1)
    $fx = [System.Windows.Media.Effects.DropShadowEffect]::new()
    $fx.BlurRadius = 4; $fx.ShadowDepth = 0; $fx.Opacity = 0.9
    $fx.Color = [System.Windows.Media.ColorConverter]::ConvertFromString('#FF000000')
    $price.Effect = $fx
    [void]$inner.Children.Add($price)
    return $g
}

$script:priceMap = @{}
$script:iconMap = @{}
$script:nameMap = @{}
$script:kindMap = @{}
$script:stamp = [DateTime]::MinValue
function Refresh {
    if (-not (Test-Path -LiteralPath $StatePath)) { $foot.Text = '还没有状态文件'; return }
    $st = (Get-Item -LiteralPath $StatePath).LastWriteTimeUtc
    if ($st -eq $script:stamp) { return }
    $script:stamp = $st
    try { $state = Get-Content -LiteralPath $StatePath -Raw -Encoding utf8 | ConvertFrom-Json } catch { return }
    if ($state.prices) {
        $script:priceMap = @{}
        foreach ($pp in $state.prices.PSObject.Properties) { $script:priceMap[$pp.Name] = [int]$pp.Value }
    }
    # 自定义农场：物品图标 / 名字由 World 写进 state.itemIcons / state.names
    $script:iconMap = @{}
    if ($state.itemIcons) {
        foreach ($pp in $state.itemIcons.PSObject.Properties) { if ($pp.Value) { $script:iconMap[$pp.Name] = [string]$pp.Value } }
    }
    $script:nameMap = @{}
    if ($state.names) {
        foreach ($pp in $state.names.PSObject.Properties) { if ($pp.Value) { $script:nameMap[$pp.Name] = [string]$pp.Value } }
    }
    $script:kindMap = @{}
    if ($state.itemKinds) {
        foreach ($pp in $state.itemKinds.PSObject.Properties) { if ($pp.Value) { $script:kindMap[$pp.Name] = [string]$pp.Value } }
    }

    $slots.Children.Clear()
    $bag = $state.inventory
    $rows = @()
    if ($bag -and $bag.items) {
        $rows = @($bag.items.PSObject.Properties | Where-Object { [int]$_.Value -gt 0 })
    }
    # 固定 16 格：有东西的填前面，剩下的留空格子（像游戏里的背包）
    $CAP = 16
    $idx = 0
    foreach ($p in $rows) {
        if ($idx -ge $CAP) { break }
        [void]$slots.Children.Add((New-Slot ([string]$p.Name) ([int]$p.Value) $idx))
        $idx++
    }
    while ($idx -lt $CAP) {
        [void]$slots.Children.Add((New-Slot '' 0 $idx))
        $idx++
    }
    if ($rows.Count -eq 0) {
        $foot.Text = '背包是空的'
    } else {
        $total = 0
        foreach ($p in $rows) { $total += [int]$p.Value }
        $foot.Text = ('共 ' + $total + ' 件 · ' + $rows.Count + ' 种')
    }
    # 关键：每次状态更新都要把当前页（商店/家具）重画一遍。
    # 旧版只在切页时画，lastState 还是 null，商店页就永远是空的。
    Fill-Page $state
}

Refresh
Show-Page $(if ($StartPage -eq 'shop' -or ($StartPage -eq 'own' -and $ShowFurniture)) { $StartPage } else { 'bag' })

if ($Seconds -gt 0) {
    $exitTimer = [System.Windows.Threading.DispatcherTimer]::new()
    $exitTimer.Interval = [TimeSpan]::FromSeconds($Seconds)
    $exitTimer.Add_Tick({ $exitTimer.Stop(); $win.Close() })
    $exitTimer.Start()
}

$script:deadCount = 0
$timer = [System.Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({
    try { Refresh } catch { }
    # 看门狗：桌宠不在了（API 连续 8 秒打不通）就关掉自己
    try {
        [void](Invoke-WebRequest -Uri $PetApi -TimeoutSec 1 -UseBasicParsing)
        $script:deadCount = 0
    } catch {
        $script:deadCount++
        if ($script:deadCount -ge 8) { Log '桌宠不在了，背包窗口自动关闭'; $win.Close() }
    }
})
$timer.Start()

$win.Add_KeyDown({ if ($_.Key -eq 'Escape') { $win.Close() } })
$win.Add_Closed({
    try { if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force } } catch { }
    Log 'closed'
})

$app = [System.Windows.Application]::new()
[void]$app.Run($win)
