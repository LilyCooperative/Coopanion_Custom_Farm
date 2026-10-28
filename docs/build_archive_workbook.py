# -*- coding: utf-8 -*-
"""生成 2026-10-28 项目归档工作簿。"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.dimensions import ColumnDimension

OUT = r"C:\Users\Administrator\Documents\Deepseek\Pet\docs\项目归档-2026-10-28.xlsx"

DARK = "1F1F1F"
GREEN = "2E7D32"
GREEN_LIGHT = "E8F5E9"
ORANGE = "FFF3E0"
RED = "FFEBEE"
GRAY = "F5F5F5"
WHITE = "FFFFFF"
BORDER = Side(style="thin", color="D9D9D9")

def title(ws, text, sub=""):
    ws.merge_cells("A1:H1")
    c = ws["A1"]
    c.value = text
    c.font = Font(name="Microsoft YaHei", size=18, bold=True, color=WHITE)
    c.fill = PatternFill("solid", fgColor=DARK)
    c.alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 34
    if sub:
        ws.merge_cells("A2:H2")
        c = ws["A2"]
        c.value = sub
        c.font = Font(name="Microsoft YaHei", size=10, color="666666", italic=True)
        c.alignment = Alignment(vertical="center")
        ws.row_dimensions[2].height = 24

def header(ws, row, cols):
    for i, v in enumerate(cols, 1):
        c = ws.cell(row=row, column=i, value=v)
        c.font = Font(name="Microsoft YaHei", size=10, bold=True, color=WHITE)
        c.fill = PatternFill("solid", fgColor=GREEN)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = Border(bottom=Side(style="medium", color=GREEN))
    ws.row_dimensions[row].height = 28

def rows(ws, start, data, widths, status_col=None):
    for r, row in enumerate(data, start):
        for c, v in enumerate(row, 1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.font = Font(name="Microsoft YaHei", size=10)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = Border(bottom=BORDER)
            if r % 2 == 0:
                cell.fill = PatternFill("solid", fgColor=GRAY)
        if status_col:
            cell = ws.cell(row=r, column=status_col)
            val = str(cell.value or "")
            if "完成" in val or "通过" in val or "已发布" in val or "正常" in val:
                cell.fill = PatternFill("solid", fgColor=GREEN_LIGHT)
            elif "待" in val or "未" in val or "限制" in val:
                cell.fill = PatternFill("solid", fgColor=ORANGE)
            elif "失败" in val or "风险" in val or "阻塞" in val:
                cell.fill = PatternFill("solid", fgColor=RED)
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = f"A{start}"

def setup(ws, widths):
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = GREEN
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

wb = Workbook()
wb.remove(wb.active)

# 00 总览
ws = wb.create_sheet("00-总览")
setup(ws, [20, 58, 44, 28, 24, 18, 18, 18])
title(ws, "Coopanion 自定义农场 · 项目归档", "归档日期：2026-10-28 19:15（Asia/Hong_Kong）｜工作簿由会话记录与当前环境核对生成")
header(ws, 4, ["项目", "内容", "状态 / 备注"])
overview = [
    ["项目", "自定义农场（Cortico World，World id = farm）", "已加载"],
    ["仓库", "https://github.com/LilyCooperative/Coopanion_Custom_Farm", "main 分支干净"],
    ["npm 包", "@lily-cooperative/custom-farm", "公开包"],
    ["当前包版本", "0.33.6", "npm 已可见"],
    ["Git 提交", "00f6872 公开版初始提交", "已推送"],
    ["Git 标签", "v0.33.6（另有 v0.33.4 / v0.33.5）", "已推送"],
    ["宿主", "Coopanion 0.2.13", "运行中"],
    ["当前扩展", "custom-farm 0.33.3（本地 link）", "loaded / enabled"],
    ["数据目录", r"C:\Users\Administrator\AppData\Local\Programs\Coopanion\data", "保留记录后恢复"],
    ["数据备份", r"C:\Users\Administrator\Documents\Deepseek\Pet\_backup\coopanion-data-20261028-1816", "约 1.6 GB"],
    ["默认素材", "assets/sprites 共 330 张 PNG", "npm 包内自包含"],
    ["自测", "165 / 165 通过", "4 个事件，20 条日志"],
    ["桌面渲染", "Electron/HTML 默认；WPF 仅回退", "需再确认实际窗口"],
    ["发布市场", "npm 已发布；cortico-extensions 已做 sync", "图标/版本需要重新同步验证"],
]
rows(ws, 5, overview, [20, 58, 44], status_col=3)
ws.merge_cells("A20:H20")
ws["A20"] = "一句话结论"
ws["A20"].font = Font(name="Microsoft YaHei", size=12, bold=True, color=GREEN)
ws.merge_cells("A21:H24")
ws["A21"] = ("核心功能、素材、npm 包结构和 Coopanion 包管理器安装/卸载已经跑通；"
             "当前剩余风险集中在 Electron overlay 的桌面级行为、标准安装器、"
             "公开扩展页 UI 的最终验收，以及已经暴露的 npm token 必须撤销。")
ws["A21"].font = Font(name="Microsoft YaHei", size=11)
ws["A21"].alignment = Alignment(vertical="top", wrap_text=True)
ws["A21"].fill = PatternFill("solid", fgColor=GREEN_LIGHT)

# 01 里程碑
ws = wb.create_sheet("01-里程碑")
setup(ws, [16, 20, 70, 34])
title(ws, "里程碑与变更时间线", "按会话阶段整理，不按 Git 提交逐条展开")
header(ws, 4, ["日期", "阶段", "内容", "结果"])
milestones = [
    ["2026-10-28", "素材迁移", "替换为 18 种 FarmCrops 免费作物、Vigi 野草、Grok 地面/树木/稻草人/粒子", "素材 330 PNG，贴图底边对齐"],
    ["2026-10-28", "旧素材清理", "删除 Gandalf / 旧导出素材与旧截图；Git 历史压成单提交", "当前工作树无旧素材"],
    ["2026-10-28", "桌面图层", "修复作物浮空、浇水特效、粒子、掉落动画；Electron 成为默认", "功能已实现，Electron 桌面层需复测"],
    ["2026-10-28", "农场设置", "增加隐藏农场；食谱/合成表并入道具自定义；增加稻穗恢复", "已实现"],
    ["2026-10-28", "生态/天气", "新增生态自定义、4 种天气、预览 5 秒、立即生效、作物/装饰分开摇摆", "已实现"],
    ["2026-10-28", "天气细节", "彩蛋改为只压扁/拉伸、同相位；无风默认 4°；60fps", "已实现"],
    ["2026-10-28", "心情系统", "mood / happy / bored；天气心情结算；吃东西 +8；状态只在进入时触发行为", "165 项自测通过"],
    ["2026-10-28", "小木屋 / 图标", "加入 deco_cabin 与花盆扩展图标 assets/icon.png", "已进包"],
    ["2026-10-28", "npm 发布", "发布 @lily-cooperative/custom-farm；0.33.6 为最新", "公开可安装"],
    ["2026-10-28", "卸载/重装", "卸载 Coopanion 保留 data 并恢复；Setup 静默安装失败后手工部署 0.2.13 载荷", "App 运行，记录保留；标准安装器待补"],
]
rows(ws, 5, milestones, [16, 20, 70, 34], status_col=4)

# 02 功能清单
ws = wb.create_sheet("02-功能清单")
setup(ws, [20, 34, 16, 78])
title(ws, "功能清单与验收状态", "状态是归档时点的实际状态，不代表市场审核")
header(ws, 4, ["模块", "功能", "状态", "说明"])
features = [
    ["作物", "18 种免费素材作物 / 阶段 / 种子 / 产物", "已完成", "土豆、胡萝卜、番茄、草莓、玉米、南瓜、甜菜根、蓝莓、小白菜、花椰菜、黄瓜、茄子、大蒜、菠萝、小萝卜、红辣椒、红洋葱、西瓜"],
    ["种植", "播种、浇水、生长、收获、掉落、拾取", "已验证", "确定性 tick，不因每帧唤醒模型"],
    ["经济", "商店、金币、买卖、种子价格", "已完成", "缺种子先查价再买"],
    ["背包", "背包、农场预览、装饰摆放", "已完成", "WebUI 背包页"],
    ["合成", "合成表并入道具自定义", "已完成", "saveRecipe / removeRecipe 走 items 面板桥接"],
    ["删除清理", "删除道具时同步删除引用它的合成表", "已完成", "removeRecipesUsing"],
    ["稻穗", "稻穗缺失自动补回，并恢复 rice_ear → rice 配方", "已完成", "避免误删后永久缺道具"],
    ["天气", "无风 / 微风 / 大风 / 彩蛋；持续时间/权重/方向/幅度/压扁/速度", "已完成", "天气页可增删、无风不可删"],
    ["天气操作", "预览 5 秒 / 立即生效", "已完成", "保存后立即重新应用当前天气"],
    ["天气视觉", "作物与装饰分开摇摆；彩蛋同相位、只压扁拉伸、不旋转", "已实现", "Electron Canvas；WPF 仅回退"],
    ["心情", "mood 0~100 初始60；天气结算；吃东西 +8；开心/无聊", "已完成", "开心 >=70；无聊 <30"],
    ["状态行为", "只在进入 happy/bored/饥饿时触发；持续期间不重复", "已完成", "entered 集合 + onlyTriggers 过滤"],
    ["小木屋", "deco_cabin 装饰物，买350/卖120，bottom", "已完成", "旧存档自动补"],
    ["隐藏农场", "游戏配置里的开关；停止/恢复图层，农场仍在后台", "已完成", "hideFarm"],
    ["默认设置", "农场默认值=当前用户的配置（含天气/心情间隔）", "已完成", "见 08-运维"],
    ["图标", "cortico.icon = assets/icon.png，花盆图标", "已进包", "0.33.6"],
    ["Electron overlay", "水/粒子/掉落/天气/心情数据", "已实现", "缺少桌面级 z-order、桌宠隐藏、多屏跟随"],
    ["WPF overlay", "Electron 不可用回退", "保留", "Windows 旧行为"],
    ["WebUI", "农场/生态/状态/道具/商店/背包", "已实现", "0.33.6 面板清单修复"],
]
rows(ws, 5, features, [20, 34, 16, 78], status_col=3)

# 03 版本
ws = wb.create_sheet("03-版本与发布")
setup(ws, [14, 16, 18, 58, 34])
title(ws, "版本、Git 与 npm 发布记录", "npm 的 latest 以 registry 最终状态为准；本归档记录当时的发布动作")
header(ws, 4, ["版本", "Git 标签", "npm 状态", "关键内容", "备注"])
versions = [
    ["0.31.1", "-", "未发布", "Electron overlay、水/粒子/掉落、天气初版", "开发中"],
    ["0.32.0", "-", "未发布", "Electron 成为默认；天气/小木屋/心情前序", "开发中"],
    ["0.32.1", "-", "未发布", "天气保存快照、无风默认、道具/合成修正", "开发中"],
    ["0.33.0", "-", "未发布或旧包", "心情状态、天气影响、默认设置", "开发中"],
    ["0.33.1", "-", "未发布", "情绪/天气细节、生态面板、小木屋", "开发中"],
    ["0.33.2", "-", "未发布", "状态快照 + 天气保存、overlay lease", "开发中"],
    ["0.33.3", "-", "已公开", "mood、天气、小木屋、公共包首次可见", "需以 registry 为准"],
    ["0.33.4", "v0.33.4", "已推送", "版本/依赖说明、README", "曾处于 processing"],
    ["0.33.5", "v0.33.5", "已推送", "状态进入才触发 + 天气/图标前序", "曾处于 processing"],
    ["0.33.6", "v0.33.6", "已发布（latest）", "花盆 icon、cortico.icon、最终元数据", "当前最新"],
]
rows(ws, 5, versions, [14, 16, 18, 58, 34], status_col=3)
ws.merge_cells("A18:E18")
ws["A18"] = "npm 地址：https://www.npmjs.com/package/@lily-cooperative/custom-farm"
ws["A18"].font = Font(name="Microsoft YaHei", size=10, color="1565C0", underline="single")

# 04 测试
ws = wb.create_sheet("04-测试记录")
setup(ws, [16, 30, 58, 22, 42])
title(ws, "测试与验收记录", "通过项是实际执行过的；未执行项明确写待验证")
header(ws, 4, ["日期", "范围", "方法", "结果", "备注"])
tests = [
    ["2026-10-28", "核心逻辑", "custom-farm/tools/selftest.mjs", "165/165 通过", "4 个事件、20 条日志"],
    ["2026-10-28", "npm 包结构", "npm pack --json", "375 个文件", "包含 assets/icon.png 和 330 张 PNG"],
    ["2026-10-28", "npm 安装/卸载", "临时目录 npm install --ignore-scripts / uninstall", "通过", "14 个包；卸载后目录为空"],
    ["2026-10-28", "公开包安装", "npm install @lily-cooperative/custom-farm@0.33.3", "通过", "公开 registry 安装/卸载"],
    ["2026-10-28", "Coopanion 安装", "在 data/extensions 用 pnpm add 公开包", "loaded/enabled", "扩展列表出现 @lily-cooperative/custom-farm"],
    ["2026-10-28", "Coopanion 卸载", "pnpm remove 公开包并重启", "扩展消失，farm World=0", "测试后恢复本地 link"],
    ["2026-10-28", "素材", "安装后检查 node_modules/.../assets/sprites", "330 PNG", "icon、种子、作物、产物图标均在"],
    ["2026-10-28", "本地 link", "恢复 data/extensions/custom-farm junction", "330 PNG", "之前 Copy-Item 破坏 junction，已修复"],
    ["2026-10-28", "Electron overlay", "capturePage / 进程与日志", "部分通过", "桌面级透明层/层级/桌宠跟随需复测"],
    ["2026-10-28", "WPF 图层", "restart-layers -Check", "2 个窗口", "Electron 默认后 WPF 仅回退"],
    ["待验证", "扩展页 UI", "高级模式 → 扩展 → 安装/卸载", "未执行", "pnpm 路径已通过，UI 按钮仍需点一次"],
]
rows(ws, 5, tests, [16, 30, 58, 22, 42], status_col=4)

# 05 路径
ws = wb.create_sheet("05-路径与文件")
setup(ws, [22, 86, 44])
title(ws, "关键路径与文件", "迁移/重装时优先保护 data、备份和源码；不要复制单个 custom-farm 子目录")
header(ws, 4, ["类型", "路径", "说明"])
paths = [
    ["源码仓库", r"C:\Users\Administrator\Documents\Deepseek\Pet", "整个 Pet 根目录"],
    ["扩展源码", r"C:\Users\Administrator\Documents\Deepseek\Pet\custom-farm", "package.json / src / dist"],
    ["根素材", r"C:\Users\Administrator\Documents\Deepseek\Pet\assets\sprites", "330 PNG；本地 link 使用这里"],
    ["扩展图标", r"C:\Users\Administrator\Documents\Deepseek\Pet\assets\icon.png", "512×512 花盆"],
    ["Electron overlay", r"C:\Users\Administrator\Documents\Deepseek\Pet\overlay-electron", "默认桌面渲染"],
    ["WPF overlay", r"C:\Users\Administrator\Documents\Deepseek\Pet\overlay", "回退"],
    ["背包", r"C:\Users\Administrator\Documents\Deepseek\Pet\bag", "Windows WPF"],
    ["npm tarball", r"C:\Users\Administrator\Documents\Deepseek\Pet\custom-farm\lily-cooperative-custom-farm-0.33.6.tgz", "0.33.6"],
    ["Coopanion", r"C:\Users\Administrator\AppData\Local\Programs\Coopanion\Coopanion.exe", "0.2.13"],
    ["Coopanion data", r"C:\Users\Administrator\AppData\Local\Programs\Coopanion\data", "记录、config、extensions"],
    ["扩展目录", r"C:\Users\Administrator\AppData\Local\Programs\Coopanion\data\extensions", "pnpm workspace"],
    ["本地 link", r"C:\Users\Administrator\AppData\Local\Programs\Coopanion\data\extensions\node_modules\custom-farm", "必须是 junction；指向 Pet/custom-farm"],
    ["数据备份", r"C:\Users\Administrator\Documents\Deepseek\Pet\_backup\coopanion-data-20261028-1816", "约 1.6 GB"],
    ["安装包", r"C:\Users\Administrator\Downloads\Coopanion-Setup-0.2.13.exe", "官方 Setup"],
]
rows(ws, 5, paths, [22, 86, 44])

# 06 待办
ws = wb.create_sheet("06-待办")
setup(ws, [10, 52, 70, 20])
title(ws, "发布前待办", "按优先级；P0 完成前不建议宣称正式发布")
header(ws, 4, ["优先级", "事项", "验收标准", "状态"])
todos = [
    ["P0", "撤销两个已暴露的 npm token", "npm Settings → Tokens 中找不到旧 token", "待处理"],
    ["P0", "同步 0.33.6 到扩展市场", "市场显示 0.33.6 且花盆图标可见", "待验证"],
    ["P0", "在 Coopanion 扩展页实际点击安装/卸载", "UI 按钮路径也能完成，且 farm World 正确启停", "待验证"],
    ["P0", "标准安装器验证", "双击 Setup 能正常安装、Add/Remove 有卸载项、保留 data", "待验证"],
    ["P1", "Electron overlay 桌面级验收", "透明层可见、层级正确、桌宠隐藏时隐藏、卸载后 20s 退出", "待验证"],
    ["P1", "心情/天气完整交互测试", "进入开心/无聊/饥饿只触发一次；天气结算/预览/立即生效", "部分完成"],
    ["P1", "macOS / Linux 实机测试", "Electron overlay 至少启动/渲染", "待处理"],
    ["P1", "完整 WPF 回退冒烟", "Windows 无 Electron 时仍可用", "待处理"],
    ["P2", "清理 experimental / internal-state 标签状态", "确认稳定后更新 cortico.tags", "待处理"],
    ["P2", "GitHub Release 与发布说明", "v0.33.6 release 可下载，说明与 README 一致", "待处理"],
]
rows(ws, 5, todos, [10, 52, 70, 20], status_col=4)

# 07 风险
ws = wb.create_sheet("07-风险与问题")
setup(ws, [20, 26, 82, 20])
title(ws, "已知风险与故障记录", "不要把这些当成已解决；它们是归档时点的真实状态")
header(ws, 4, ["类别", "现象", "原因 / 处理", "状态"])
risks = [
    ["安全", "npm token 曾出现在聊天", "必须撤销；本工作簿不保存 token 值", "待处理"],
    ["安装器", "Setup /S 返回0但不部署完整文件/卸载项", "手工解出 app-64.7z，补 Uninstall；标准安装器仍需图形界面验证", "未解决"],
    ["扩展生命周期", "卸载 App 后扩展自动回来", "data 保留，extensions 也在 data；不是自动重装", "已解释"],
    ["素材", "本地 link 素材消失", "Copy-Item 把 junction 展开；重新 junction 后恢复 330 PNG", "已修复"],
    ["素材", "custom-farm/assets 为空", "postpack 清理临时 staging；npm 包内有 assets", "正常"],
    ["版权", "Grok 素材再分发", "用户声明 Pro 会员并拥有素材；已在文档记录", "已记录"],
    ["Electron", "缺少双层 z-order、桌宠隐藏、多屏跟随", "当前 Electron 是单窗口；需要原生/宿主能力", "限制"],
    ["Electron", "卸载后 overlay 残留", "已加 20s state lease；需复测", "待验证"],
    ["版本", "App 内扩展显示0.33.3，npm为0.33.6", "本地 link 未重新加载/未升级", "待同步"],
    ["发布", "npm 0.33.4/0.33.5 曾 processing", "npm 202 处理延迟；0.33.6 已可见", "已观察"],
    ["平台", "macOS/Linux 未实测", "README 已注明", "待测试"],
]
rows(ws, 5, risks, [20, 26, 82, 20], status_col=4)

# 08 素材
ws = wb.create_sheet("08-素材与许可")
setup(ws, [36, 28, 64, 28])
title(ws, "素材来源与许可摘要", "完整条款见 ASSETS.md / ASSET_SOURCES.md / THIRD_PARTY_LICENSES.md")
header(ws, 4, ["内容", "来源 / 作者", "许可 / 声明", "状态"])
assets = [
    ["18 种作物阶段、种子、产物图标", "Farm Crops - Growth Stages Pixel Art Pack 16x16 / IDRK15599", "个人/商业可用；可修改；不可把素材包原样转售/再分发", "已记录"],
    ["野草 / 变种 / 伊甸花", "Free Pixel Grass & Bushes Pack / vigi game", "个人/商业可用；不可单独转卖/再分发素材包", "已记录"],
    ["地面、树木、稻草人、小木屋、粒子、水特效、食物图标、背包 UI", "Grok Pro 会员生成/重绘", "用户确认素材归其所有，可按项目许可分发", "已记录"],
    ["扩展图标", "用户提供的花盆图，裁切/透明化", "用户提供并授权用于本项目", "已记录"],
    ["旧素材", "Gandalf / Doloc / 旧导出", "已从当前树和历史清理；不再使用", "已清理"],
]
rows(ws, 5, assets, [36, 28, 64, 28], status_col=4)

# 09 运维
ws = wb.create_sheet("09-运维手册")
setup(ws, [32, 92, 38])
title(ws, "常用运维命令", "复制前先确认路径；不要提交 token 或 data 到 Git")
header(ws, 4, ["任务", "命令 / 操作", "备注"])
ops = [
    ["启动 Coopanion", "Remove-Item Env:ELECTRON_RUN_AS_NODE; Start-Process 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Coopanion\\Coopanion.exe'", "ELECTRON_RUN_AS_NODE 必须清掉，否则会当 Node 运行并退出"],
    ["运行自测", "cd C:\\Users\\Administrator\\Documents\\Deepseek\\Pet\\custom-farm; node tools/selftest.mjs", "165/165"],
    ["打包", "cd custom-farm; npm.cmd pack", "生成 lily-cooperative-custom-farm-0.33.6.tgz"],
    ["发布", "临时 .npmrc 写入 token；npm.cmd --userconfig <cfg> publish --access public；删除 cfg", "token 不要进 Git；发布后撤销"],
    ["确认 npm 版本", "npm.cmd view @lily-cooperative/custom-farm version", "当前 0.33.6"],
    ["检查安装后素材", "Get-ChildItem data\\extensions\\node_modules\\@lily-cooperative\\custom-farm\\assets\\sprites -Filter *.png | Measure-Object", "应为330"],
    ["检查本地 link", "Get-Item data\\extensions\\node_modules\\custom-farm | Select LinkType,Target", "必须是 Junction，指向 Pet/custom-farm"],
    ["Coopanion 装扩展", "在 data/extensions 用 pnpm add @lily-cooperative/custom-farm@0.33.6", "pnpm store-dir 用 Coopanion data/pnpm/store/v11"],
    ["Coopanion 卸扩展", "pnpm remove @lily-cooperative/custom-farm; 重启 App", "farm World 应为0"],
    ["市场同步", "GitHub issue [sync] @lily-cooperative/custom-farm", "body: package: @lily-cooperative/custom-farm"],
    ["备份数据", "robocopy data <backup> /E /R:1 /W:1", "保留 home/config/custom"],
    ["恢复本地开发 link", "Remove-Item custom-farm 目录；cmd /c mklink /J ...", "不要用 Copy-Item 复制 junction"],
]
rows(ws, 5, ops, [32, 92, 38])

# 统一打印/属性
for ws in wb.worksheets:
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.page_setup.orientation = "landscape"
    ws.oddFooter.center.text = "Coopanion Custom Farm · 2026-10-28"
    ws.oddFooter.center.size = 8

wb.properties.title = "Coopanion 自定义农场项目归档"
wb.properties.subject = "2026-10-28 工作归档"
wb.properties.creator = "lily_cooperative"
wb.properties.keywords = "Coopanion, custom-farm, npm, archive"
wb.save(OUT)
print(OUT)
