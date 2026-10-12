from pathlib import Path
from html import escape
import re

HERE = Path(__file__).resolve().parent
INK, MUTED, RULE, ACCENT, LINK = '#173D45', '#587078', '#CAD8DA', '#247F80', '#436B8E'
SANS = 'Microsoft YaHei, SimHei, sans-serif'

def text(x, y, value, size=16, weight=400, color=INK, anchor='middle', family=SANS):
    return f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}" font-family="{family}">{escape(value)}</text>'

def box(x, y, w, h, title, lines, kind='normal', title_size=16, body_size=13):
    fill, stroke = {'normal': ('#FFFFFF', INK), 'focal': ('#EEF4F4', ACCENT), 'external': ('#F5F7F7', '#A6BABE'), 'store': ('#F0F4F4', MUTED), 'input': ('#F6F8F8', '#9AAEB2')}[kind]
    result = f'<g data-node="{escape(title)}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="#FFFFFF"/><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1.4"/>'
    result += text(x+w/2, y+23, title, title_size, 600)
    for i, line in enumerate(lines):
        result += text(x+w/2, y+45+i*18, line, body_size, color=MUTED)
    return result + '</g>'

def arrow(d, color=MUTED, dashed=False):
    marker = 'arrow-link' if color == LINK else 'arrow-accent' if color == ACCENT else 'arrow'
    dash = ' stroke-dasharray="5,4"' if dashed else ''
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.6"{dash} marker-end="url(#{marker})"/>'

def write(name, title, desc, height, body):
    markers = ''.join(f'<marker id="{key}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{color}"/></marker>' for key, color in [('arrow', MUTED), ('arrow-accent', ACCENT), ('arrow-link', LINK)])
    svg = f'<svg viewBox="0 0 800 {height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{name}-title {name}-desc"><title id="{name}-title">{title}</title><desc id="{name}-desc">{desc}</desc><defs>{markers}</defs><rect width="800" height="{height}" fill="#FFFFFF"/>{body}</svg>'
    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{title}</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#FFFFFF;color:{INK};font-family:{SANS}}}main{{width:800px;margin:24px auto}}h1{{font-family:SimHei,sans-serif;font-size:28px;font-weight:400;margin:0 40px 12px}}p{{font-size:12px;color:{MUTED};margin:0 40px 20px}}svg{{display:block;width:800px;height:{height}px}}</style></head>
<body><main><h1>{title}</h1><p>校园活动工作台 · 结构与数据关系</p>{svg}</main></body></html>'''
    (HERE / f'{name}.html').write_text(html, encoding='utf-8')
    # Export the authored HTML's SVG, preserving accessibility and local fonts.
    exported = re.search(r'<svg\b.*?</svg>', html, re.S).group(0)
    (HERE / f'{name}.svg').write_text('<?xml version="1.0" encoding="UTF-8"?>\n'+exported, encoding='utf-8')


# Six components in three compact columns, with separate service ports.
arch = arrow('M 224,64 H 294')
arch += arrow('M 224,184 H 246 Q 254,184 254,176 V 108 Q 254,100 262,100 H 294')
arch += arrow('M 504,64 H 578', LINK)
arch += arrow('M 504,100 H 538 Q 546,100 546,108 V 164 H 578', LINK)
arch += arrow('M 400,122 V 170')
arch += box(12,24,212,98,'浏览器工作台',['登录与项目管理','任务、资源与材料编辑','本机存档与文件导出'],'input')
arch += box(12,148,212,78,'手机服务入口',['参与者与服务人员','报名、任务与签到签退'],'input')
arch += box(294,24,210,98,'Node服务',['账号、排班与版本交付','共享、考勤与AI请求','持久化与冲突保护'],'focal')
arch += box(294,170,210,78,'持久化数据',['账号、项目与班次记录','交付版本与考勤流水'],'store')
arch += box(578,32,210,64,'DeepSeek',['文字与结构化生成'],'external')
arch += box(578,132,210,64,'GPT-image2',['宣传图像生成'],'external')
write('system-architecture','系统架构与数据流','浏览器和手机入口接入Node服务；服务调用两类模型并持久化项目及报名考勤数据。',260,arch)

# Left-to-right fan-in, fan-out, then review: six nodes in four columns.
flow = arrow('M 184,44 H 202 Q 210,44 210,52 V 76 Q 210,84 218,84 H 236')
flow += arrow('M 184,148 H 202 Q 210,148 210,140 V 120 Q 210,112 218,112 H 236')
flow += arrow('M 400,84 H 418 Q 426,84 426,76 V 52 Q 426,44 434,44 H 452')
flow += arrow('M 400,112 H 418 Q 426,112 426,120 V 140 Q 426,148 434,148 H 452')
flow += arrow('M 622,44 H 640 Q 648,44 648,52 V 76 Q 648,84 656,84 H 672')
flow += arrow('M 622,148 H 640 Q 648,148 648,140 V 120 Q 648,112 656,112 H 672')
flow += box(12,12,172,64,'已确认项目事实',['目标、时间地点与安排'],'input')
flow += box(12,116,172,64,'知识与素材',['已选择的依据与文案'],'input')
flow += box(236,62,164,78,'活动执行口径',['汇总事实与资料','统一材料要求'],'focal')
flow += box(452,12,170,64,'参与者通知',['安排与参与方式'])
flow += box(452,116,170,64,'工作人员岗位简报',['岗位动作与上报路径'])
flow += box(672,62,116,78,'核验与归档',['核验后写回','导出与复用'],'store')
write('material-workflow','卡片依赖与材料形成流程','项目事实和资料汇入执行口径，分支生成通知及岗位简报，再经人工核验写回并归档。',192,flow)

# Root and four stage nodes, joined by short orthogonal branches.
tree = arrow('M 292,66 V 76 Q 292,82 286,82 H 112 Q 106,82 106,88 V 104')
tree += arrow('M 364,66 V 88 Q 364,94 358,94 H 308 Q 302,94 302,100 V 104')
tree += arrow('M 436,66 V 88 Q 436,94 442,94 H 492 Q 498,94 498,100 V 104')
tree += arrow('M 508,66 V 76 Q 508,82 514,82 H 688 Q 694,82 694,88 V 104')
tree += box(220,8,360,58,'标准化组织一场活动',['任务可执行 · 材料可核验 · 风险可处置'],'focal')
for x,title,lines in [
    (12,'前期策划',['确认目标与约束','比较方案与预算','明确分工与风险']),
    (208,'活动筹备',['宣传与报名','场地、物料与排班','培训与应急准备']),
    (404,'现场执行',['按执行手册推进','签到签退与记录','异常响应与升级']),
    (600,'活动收尾',['核对目标与结果','复盘、决算与归档','形成下次改进项'])
]: tree += box(x,104,188,94,title,lines)
write('activity-tree','全周期任务方案树','活动目标按过程时间法拆为策划、筹备、执行和收尾四阶段，再落实为行动。',210,tree)

# Four horizontal steps and one feedback path.
pdca = arrow('M 188,48 H 212') + arrow('M 388,48 H 412') + arrow('M 588,48 H 612')
pdca += arrow('M 700,86 V 108 Q 700,116 692,116 H 108 Q 100,116 100,108 V 86',ACCENT,True)
for x,title,lines,kind in [
    (12,'P · 计划',['目标、任务与预算','风险与执行安排'],'normal'),
    (212,'D · 执行',['推进任务与考勤','记录现场情况'],'normal'),
    (412,'C · 检查',['核对材料与结果','检查偏差与证据'],'focal'),
    (612,'A · 处理',['落实改进责任','明确后续行动'],'normal')
]: pdca += box(x,8,176,78,title,lines,kind)
pdca += text(400,140,'改进反馈至下一轮计划',13,600,ACCENT)
write('pdca-cycle','活动管控的 PDCA 闭环','计划、执行、检查和处理依次推进，改进行动反馈至下一轮计划。',150,pdca)

# Three stable slots across four phases; no redundant legend strip.
cycle = ''
phases = ['前期策划','活动筹备','现场执行','活动收尾']
slots = [
    ('核心行动',[['目标确认','方案、预算与分工'],['宣传报名','物料、排班与培训'],['现场推进','考勤与异常处置'],['核对结果','复盘、决算与归档']]),
    ('代表材料',[['策划书','预算表与任务清单'],['宣传图与文案','培训提纲与预案'],['执行手册','岗位简报与记录'],['复盘报告','决算表与归档清单']]),
    ('检查证据',[['目标与约束明确','任务责任可追踪'],['准备条件核对','资源与风险复核'],['执行进度记录','处置与考勤流水'],['费用与材料核对','改进项责任落实']])
]
for j,title in enumerate(phases):
    x=120+167*j
    cycle += f'<rect x="{x}" y="8" width="167" height="34" fill="#EEF4F4" stroke="{RULE}"/>'
    cycle += text(x+83.5,31,title,16,600)
for i,(title,cells) in enumerate(slots):
    y=42+54*i
    cycle += text(60,y+32,title,14,600,MUTED)
    for j,lines in enumerate(cells):
        x=120+167*j
        cycle += f'<rect x="{x}" y="{y}" width="167" height="54" fill="{["#FFFFFF","#F8FAFA","#FFFFFF"][i]}" stroke="{RULE}"/>'
        for k,line in enumerate(lines): cycle += text(x+83.5,y+22+k*19,line,13,color=INK if k==0 else MUTED)
cycle += f'<rect x="12" y="216" width="776" height="34" rx="5" fill="#EEF4F4" stroke="{ACCENT}"/>'
cycle += text(400,239,'风险识别 → 筹备核查 → 现场响应 → 复盘改进',15,600)
write('lifecycle-controls','全周期管控与阶段成果','四阶段对应核心行动、代表材料和检查证据，风险管理贯穿全周期。',262,cycle)

# Shared input bus converges five constraints into a single contract.
prompt = f'<path d="M 80,86 V 98 Q 80,106 88,106 H 712 Q 720,106 720,98 V 86 M 240,86 V 106 M 400,86 V 106 M 560,86 V 106" fill="none" stroke="{MUTED}" stroke-width="1.6"/>'
prompt += arrow('M 300,106 V 130') + arrow('M 520,162 H 576',ACCENT)
for x,title,lines in [
    (8,'A · 目标',['明确材料用途','服务活动目标']),
    (168,'L · 深度',['细化环节','责任与检查点']),
    (328,'I · 依据',['项目事实','选定引用资料']),
    (488,'G · 规则',['限制未确认信息','明确事实边界']),
    (648,'N · 成果',['规定章节','表格与交付形式'])
]: prompt += box(x,8,144,78,title,lines,'input')
prompt += box(80,130,440,62,'技能包与输入契约',['统一依据、深度、结构与核验要求'],'focal')
prompt += box(576,130,216,62,'可检查的材料',['依据一致 · 结构齐全 · 可执行'],'store')
write('align-inputs','ALIGN 输入结构与材料生成','目标、深度、依据、规则及成果共同约束技能包输入契约，再生成可检查的材料。',204,prompt)

# Exact-product matrix beside the three response levels.
risk = text(200,23,'可能性 P',14,600)
fills={'低':'#F0F4F4','中':'#BCD2D4','高':INK}
for row,p in enumerate(range(5,0,-1)):
    y=36+40*row
    risk += text(78,y+26,str(p),15,color=MUTED)
    for col,i in enumerate(range(1,6)):
        x=100+40*col
        score=p*i
        level='高' if score>=15 else '中' if score>=8 else '低'
        risk += f'<rect x="{x}" y="{y}" width="40" height="40" fill="{fills[level]}" stroke="#FFFFFF" stroke-width="1.5"/>'
        risk += text(x+20,y+26,str(score),15,600,'#FFFFFF' if level=='高' else INK)
for col,i in enumerate(range(1,6)): risk += text(120+col*40,256,str(i),15,color=MUTED)
risk += text(200,279,'影响 I',14,600)
risk += box(352,8,436,78,'高风险 · 15–25',['总协调立即介入；安全问题先暂停或疏散','复核并确认后恢复'],'focal')
risk += box(352,102,436,78,'中风险 · 8–14',['责任人实施预防或替代方案并报告','超时或影响扩大时升级'])
risk += box(352,196,436,78,'低风险 · 1–7',['责任人持续跟踪并记录','触发条件变化时重新评分'],'store')
risk += text(570,295,'评分 = 可能性 × 影响',13,600,MUTED)
write('risk-matrix','风险评分矩阵与分级响应','可能性与影响各1至5分，乘积1至7为低风险、8至14为中风险、15至25为高风险；各级响应并列展示。',306,risk)

# Three spaced bands keep the operating sequence readable. The dark AI
# node and the pale manual-review node are the two focal elements.
mainflow = ''
def main_step(x, y, title, lines, kind='normal', height=88):
    return box(x, y, 220, height, title, lines, kind, title_size=18, body_size=15)

for y,title in [(26,'项目准备'),(182,'AI 生产与人工核验'),(354,'执行与收尾')]:
    mainflow += text(28,y,title,18,600,INK,anchor='start')
    line_start = {'项目准备':124, 'AI 生产与人工核验':204, '执行与收尾':172}[title]
    line_end = 640 if title == 'AI 生产与人工核验' else 772
    mainflow += f'<line x1="{line_start}" y1="{y-5}" x2="{line_end}" y2="{y-5}" stroke="{RULE}"/>'
    if title == 'AI 生产与人工核验':
        mainflow += f'<line x1="684" y1="{y-5}" x2="772" y2="{y-5}" stroke="{RULE}"/>'
mainflow += arrow('M 248,81 H 290') + arrow('M 510,81 H 552')
mainflow += arrow('M 662,120 V 200')
mainflow += arrow('M 552,244 H 510')
mainflow += arrow('M 290,225 H 270 Q 262,225 262,233 V 244 H 248')
mainflow += arrow('M 220,256 H 264 Q 272,256 272,264 V 316 Q 272,324 280,324 H 392 Q 400,324 400,316 V 288',ACCENT,True)
mainflow += arrow('M 138,290 V 374') + arrow('M 248,418 H 290')
mainflow += main_step(28,42,'1 · 登录与项目库',['注册登录、维护个人资料','新建、切换或加入项目'],'input',78)
mainflow += main_step(290,42,'2 · 确定活动信息',['目标、日期、场地与预算','活动安排与产出选择'],height=78)
mainflow += main_step(552,42,'3 · 策划与筹备',['任务、资源与方案比选','风险评估与分级预案'],height=78)
mainflow += f'<g data-node="4 · AI 材料生产"><rect x="552" y="200" width="220" height="88" rx="6" fill="{INK}"/>'
mainflow += text(662,227,'4 · AI 材料生产',18,600,'#FFFFFF')
mainflow += text(662,251,'项目依据 → 文案与海报',15,color='#DDEBEC')
mainflow += text(662,271,'技能包限定结构与事实',15,color='#DDEBEC') + '</g>'
mainflow += main_step(290,200,'5 · 人工核验与修订',['核对事实、结构与执行','修订材料，补齐缺项'],'focal')
mainflow += '<polygon points="138,198 248,244 138,290 28,244" fill="#FFFFFF" stroke="#247F80" stroke-width="1.6"/>'
mainflow += text(138,240,'阶段检查点',18,600) + text(138,261,'已确认？',15,600)
mainflow += '<rect x="290" y="292" width="110" height="24" fill="#FFFFFF"/>'
mainflow += text(345,310,'否：返回补齐',13,600,ACCENT)
mainflow += '<rect x="146" y="313" width="42" height="24" fill="#FFFFFF"/>'
mainflow += text(167,330,'是',13,600,MUTED)
mainflow += main_step(28,374,'6 · 执行与交付',['排班、考勤与版本交付','异常响应与升级处置'])
mainflow += main_step(290,374,'7 · 收尾与复用',['复盘、决算与改进行动','导出材料、归档项目'],'store')
mainflow += text(662,401,'贯穿全过程',16,600,MUTED)
mainflow += text(662,426,'邀请协作 · 版本同步',14,color=MUTED)
mainflow += text(662,449,'风险识别 · 跟踪处置',14,color=MUTED)
write('workbench-main-flow','工作台主要功能与使用流程','登录并进入项目后，项目准备、AI生产与人工核验、执行与收尾分区呈现。检查点未确认则补齐，确认后进入执行与版本交付；邀请同步与风险管理贯穿全周期。',482,mainflow)

# Task states and delivery identity form separate but linked records.
def label(x, baseline, content, width=64, color=MUTED):
    return (f'<rect x="{x-width/2}" y="{baseline-16}" width="{width}" height="22" fill="#FFFFFF"/>'
            + text(x,baseline,content,14,600,color))

delivery = arrow('M 256,47 H 288') + arrow('M 512,47 H 552',ACCENT)
delivery += arrow('M 668,86 V 108 Q 668,116 660,116 H 516 Q 508,116 508,124 V 156',ACCENT)
delivery += arrow('M 160,195 H 224') + arrow('M 368,195 H 432') + arrow('M 576,195 H 640',ACCENT)
delivery += arrow('M 508,234 V 266 Q 508,274 500,274 H 304 Q 296,274 296,266 V 234',MUTED,True)
delivery += box(16,8,240,78,'AI / 人工草稿',['事实、结构与执行核验','编辑只改变当前草稿'],'input',18,15)
delivery += box(288,8,224,78,'人工确认交付',['保存确认人及时间','正文、附件、参考填值'],'normal',18,15)
delivery += box(552,8,232,78,'冻结交付版本',['材料编号 + 版本编号','改名或重生成保留历史'],'focal',18,15)
for x,title,lines,kind in [
    (16,'未开始',['明确任务','与交付要求'],'input'),
    (224,'进行中',['排班、考勤','与执行报告'],'normal'),
    (432,'待验收',['提交说明','绑定实际版本'],'normal'),
    (640,'已验收',['组织者核对','记录结论与版本'],'focal')
]: delivery += box(x,156,144,78,title,lines,kind,18,14)
delivery += label(596,103,'选择版本',96,ACCENT)
delivery += label(192,181,'开始') + label(400,181,'提交') + label(608,181,'验收',color=ACCENT)
delivery += label(402,260,'退回并说明原因',128)
delivery += f'<line x1="16" y1="300" x2="784" y2="300" stroke="{RULE}"/>'
delivery += text(400,326,'受阻独立记录；打卡、班次报告和 AI 草稿均不自动触发任务验收',15,600,MUTED)
write('task-delivery-flow','任务状态与实际交付版本的证据链','草稿经人工确认冻结为交付版本，进行中任务选择版本提交，组织者核验后通过或退回。版本、责任人与验收结论共同形成检查证据。',340,delivery)

# The weather case uses the example project's actual score and response roles.
weather = arrow('M 256,178 H 288') + arrow('M 512,178 H 544')
weather += arrow('M 656,222 V 268',ACCENT)
weather += f'<rect x="32" y="8" width="736" height="78" rx="6" fill="#EEF4F4" stroke="{ACCENT}" stroke-width="1.4"/>'
weather += text(400,35,'天气风险：可能性 4 × 影响 4 = 16（高风险）',19,600)
weather += text(400,61,'触发条件：降雨、大风或气温骤降，户外展区无法正常开放',15,color=MUTED)
weather += box(32,134,224,88,'跟踪与准备',['提前 48 小时关注天气','准备备用场地与搬运人力'],'normal',18,14)
weather += box(288,134,224,88,'总协调决定转场',['活动前一天 18:00 前确认','是否启用体育馆副馆'],'focal',18,15)
weather += box(544,134,224,88,'三组协同执行',['宣传更新、后勤搬运','执行组引导人流改道'],'normal',18,15)
weather += box(544,268,224,78,'检查与复盘',['核对场地、通知与动线','记录处置和改进行动'],'store',18,14)
weather += text(32,288,'升级条件',16,600,INK,anchor='start')
weather += text(32,314,'转场出现安全风险 → 按高风险流程处置',15,color=MUTED,anchor='start')
weather += f'<line x1="32" y1="368" x2="768" y2="368" stroke="{RULE}"/>'
weather += text(400,391,'评分用于安排处置优先级；准备条件、行动责任与复核记录共同支撑应急决策',14,color=MUTED)
write('weather-response','天气变更的风险识别、分级与处置','示例项目中的天气风险评分为4乘4等于16，前置跟踪与备用准备、总协调决策、宣传后勤执行协同转场，再复核留档；转场安全问题升级到高风险处置。',408,weather)

# A logic tree decomposes each claim into rules, counterexamples and evidence.
evidence = arrow('M 248,74 V 92 Q 248,100 240,100 H 140 Q 132,100 132,108 V 124')
evidence += arrow('M 400,74 V 124')
evidence += arrow('M 552,74 V 92 Q 552,100 560,100 H 660 Q 668,100 668,108 V 124')
for x in [132,400,668]: evidence += arrow(f'M {x},212 V 260')
evidence += box(220,8,360,66,'核心目标具有检查证据',['需求 → 规则 → 反例检查 → 证据'],'focal',19,15)
for x,title,lines in [
    (20,'任务与交付',['实名责任、状态与版本','检查无版本及越权验收']),
    (288,'权限与协作',['邀请、权限与共享修订','检查只读写入及过期保存']),
    (556,'人员与资源',['资格、班次与资源预留','检查时间冲突及容量不足'])
]: evidence += box(x,124,224,88,title,lines,'normal',18,14)
for x,title,lines in [
    (20,'关联接口 · 56 项',['验收引用保留原版本','缺责任或版本的提交被拒']),
    (288,'共享集成 · 82 项',['草稿保留并提示冲突','邀请角色决定读写范围']),
    (556,'人员考勤 · 88 项',['多人安排整组校验','签到、报告与工时分别留档'])
]: evidence += box(x,260,224,88,title,lines,'store',17,14)
evidence += f'<line x1="20" y1="374" x2="780" y2="374" stroke="{RULE}"/>'
evidence += text(400,399,'基础回归覆盖 38 个模块、1044 项断言；界面操作另以独立浏览器会话核对',15,color=MUTED)
write('validation-evidence','从目标到验证证据的逻辑树','需求拆为任务交付、权限协作与人员资源三类规则，用非法操作、版本变化和时间冲突等反例检查，再以专项结果和记录支撑结论；离线回归与界面复核补充基础验证。',412,evidence)
print('Authored eleven diagrams and exported their SVG sources.')
