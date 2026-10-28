# 素材说明（免费包 / AI 生成 / 替换指南）

当前仓库里的贴图只用于**功能示意和界面预览**，不是必须使用的最终美术。  
你可以直接替换 `assets/sprites/` 下的 PNG；只要保持文件名和阶段数，代码不需要改。

## 1. 免费素材包

| 素材包 | 作者 | 当前用途 | 作者要求 |
|---|---|---|---|
| **Farm Crops - Growth Stages Pixel Art Pack (16x16)** | **IDRK15599** | 18 种作物的阶段帧、种子包图标、产物图标 | 个人/商业项目免费使用；可修改；致谢非必需；**不要把素材包原样转售或再分发** |
| **Free Pixel Grass & Bushes Pack** | **vigi game** | 野草、野草变种、伊甸花 | 允许个人/商业使用；**不能把素材包本身单独转卖或再分发** |

原文与完整条款：

- `assets/LICENSES/FarmCrops_GrowthPack_16x16_v1.2.txt`
- `assets/LICENSES/Free Pixel Grass and Bushes Pack.txt`
- 汇总见 `THIRD_PARTY_LICENSES.md`

> 免费包可以随游戏/项目使用，但**不能当成素材包单独再发布**。如果你要二次分发本仓库，请先确认“随插件分发原始 PNG”是否符合作者原意；不确定就只发代码，让用户自备素材。

## 2. AI 生成素材

以下素材由 **Grok 生成/重绘**，不是第三方素材包：

- 地面长条：`popo20230114_gd_grass_0..2.png`
- 大树：`deco_tree.png`
- 稻草人：`deco_scarecrow.png`
- 小木屋：`deco_cabin.png`
- 扩展图标：`assets/icon.png`（`custom-farm/icon.png` 是安装包里用的同一张）
- 枯萎图：`sprite_crop_wither_*.png`
- 食材/菜品图标：`icon_item_rice_ear/rice/egg/meat/egg_fried_rice/tomato_egg.png`（Grok 绘制）；`icon_item_pasta.png` 为项目内按同一调色板补画的像素图
- 闪光粒子：`crop_shiny_01..60.png`
- 烟尘粒子：`smoke_ps_02_0..5.png`
- 兜底土图标：`icon_item_soil.png`
- 背包标题：`ui_menuicon_farm.png`
- 背包面板：`bag/art/panel.png`、`bag/art/slot.png`
- 水特效：`water_pour_1..4.png`、`water_burst_1..6.png`、`water_drip*_*.png`

这些文件由 **Grok Pro 会员**生成；用户确认素材归其所有，可按本项目许可公开分发。

## 3. 当前只是示意，请自行替换

### 作物

作物文件在 `assets/sprites/`，命名规则：

```text
sprite_seed_<crop>_<frame>.png
```

- `<crop>`：`potato`、`carrot`、`tomato`、`strawberry`、`corn`、`pumpkin`、`beetroot`、`blueberry`、`bok_choy`、`cauliflower`、`cucumber`、`eggplant`、`garlic`、`pineapple`、`radish`、`red_chili`、`red_onion`、`watermelon`
- `<frame>`：从 `0` 开始连续编号
- 帧数必须与 `custom-farm/src/crops.js` 的 `frames` / `levels` 一致
- 当前统一为 16×32 像素、底边贴地；替换图也要让有效像素接触画布底边，否则会看起来浮空
- 种子图标：`icon_item_seed_<crop>.png`
- 产物图标：`icon_item_<crop>.png`

### 地面 / 装饰 / 杂草

- 地面：`popo20230114_gd_grass_0/1/2.png`，按 96px 宽长条横向重复
- 大树：`deco_tree.png`
- 稻草人：`deco_scarecrow.png`
- 野草：`sprite_resource_weeds_*.png`、`sprite_resource_weeds_variant0_*.png`、`sprite_seed_eden_flower_*.png`

### 改完怎么生效

- 直接替换 PNG 后，重启图层或在「农场自定义」里刷新即可
- 改文件名 / 阶段数 / 尺寸时，同时改 `custom-farm/src/crops.js` 或自定义目录配置
- 带透明边的贴图请先裁掉底部透明行；否则会浮空

## 4. 许可边界

- **代码**：MIT，见 `LICENSE`
- **免费素材包**：各自作者许可，不随代码 MIT 授权
- **AI 图**：Grok Pro 会员生成，用户确认素材归其所有
- **不要**把任何素材包原始文件当成独立素材包再发布
