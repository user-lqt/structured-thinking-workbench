/* 帮助与数据：使用说明、运维指南、常见问题、技能包一览、项目包导入导出。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, PHASES, PHASE_LABEL, fmtDateTime } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  const SECTION = (title, body) => `<div class="card"><div class="card-title"><h3>${escapeHtml(title)}</h3></div><div class="help-body">${body}</div></div>`;

  const GUIDE = `
    <ol class="help-steps">
      <li><b>① 选身份、建项目</b>：首次打开先选一个本地演示身份（活动组织者 / 活动成员 / 只读访客），再填活动基本信息；只有「活动类型 / 名称 / 日期」必填，其余可以先留空，再用「问答式补全」一步步补齐。</li>
      <li><b>② 用问答式补全填信息表</b>：进入「项目信息表」，点右上角 <code>✦ 问答式补全</code>。它按活动类型逐题提问（科技文化节问展区与互动、运动会问赛制与天气备案），答完自动写进空白字段；你写过的「目标 / 内容 / 约束」勾选后是整段替换，而且生成前 AI 会先读一遍原文再重写，不会丢掉有效信息。</li>
      <li><b>③ 顶部标签栏切视图</b>：一次只显示一个视图，标签上的数字是该项目里的条目数。总览里的待办、阶段块、缺口、关键节点、产出都是入口，点一下直接跳到能处理它的那张表，并定位到具体那一条。</li>
      <li><b>④ 顺着主线做</b>：项目信息表（勾选产出）→ 全周期任务 → 风险预案 → 人员与资源 → 过程材料。</li>
    </ol>
    <ul class="help-list">
      <li><b>主线视图</b>：<code>总览</code> 看进度与待办 · <code>项目信息表</code> 定事实与产出 · <code>全周期任务</code> 分解 / 甘特 / 阶段门禁 · <code>风险预案</code> 台账与分级预案 · <code>人员与资源</code> 台账与占用冲突 · <code>过程材料</code> 逐份生成。</li>
      <li><b>工具视图</b>：<code>方案比选</code> 加权决策矩阵 · <code>变更演练</code> 突发场景推演 · <code>素材库</code> 图片与文案 · <code>项目库</code> 多项目与项目包 · <code>帮助与数据</code> 技能包与导出。</li>
      <li><b>有样表就上传参考</b>：<code>过程材料</code> 里每份材料都能「上传参考」（往届申报表 / 学校样表，Word 直接传；也可以把文件直接拖到那张卡片上，卡片就是拖放区）。工作台会解析出参考的栏目、字段清单与原文，生成时按它对齐，生成后在卡片上给出「栏目 x/y · 字段 a/b」的覆盖核对，缺哪项列出来；导出 Word 时还会沿用参考的样式表、页面设置与页眉页脚（参考条上显示「版式 ✓」），点「⇄ 按参考重排」可让 AI 把正文改写成与参考栏目、字段、表格列一致的成稿。想「只换值、不动表」时用卡片上的 <code>⇩ 参考表填值</code> 或直接点 <code>Word（参考原表）</code>：工作台把参考表当成一张待填的表，识别出栏目里的空位，你只填空位，导出的 Word 结构（表格、栏目、条目、缩进、页眉页脚）全按参考，只有填过值的地方被替换——挂了参考件的卡片，Word 按钮默认就走这条；想看 AI 写的正文才点旁边的 <code>Word（正文）</code>。</li>
      <li><b>随时换身份或项目</b>：右上角「显示名称 · 身份」按钮切换角色，旁边的下拉框切换项目；只读访客的写入控件会被禁用，数据互不影响。</li>
      <li><b>导出归档</b>：单份导出、材料包导出，或在「E 帮助与数据」的数据管理里导出全量档案与项目包。</li>
    </ul>`;

  const OPS = `
    <h4>运行环境</h4>
    <ul class="help-list">
      <li>零构建、零第三方依赖，只需要 Node.js 18 以上。</li>
      <li>启动：在仓库根目录执行 <code>node workbench/demo2/server.mjs</code>，默认地址 <code>http://127.0.0.1:4175/</code>。</li>
      <li>如需换端口：设置环境变量 <code>DEMO2_PORT</code>。</li>
      <li>服务只监听 <code>127.0.0.1</code>，不对外网开放。</li>
    </ul>
    <h4>AI 与密钥</h4>
    <ul class="help-list">
      <li>在仓库根目录的 <code>.env</code> 里配置 <code>DEEPSEEK_API_KEY</code>，模型可用 <code>DEEPSEEK_MODEL</code> 覆盖，默认 <code>deepseek-chat</code>。</li>
      <li>AI 生图另需 <code>YOSHUB_API_KEY</code>（可选 <code>YOSHUB_API_BASE</code>、<code>YOSHUB_IMAGE_MODEL</code>）；生成结果落盘在 <code>workbench/demo2/generated/</code>，未配置时只禁用生图按钮。</li>
      <li>API Key 只存在于服务端进程，不会下发到浏览器。</li>
      <li>未配置 Key 时自动进入离线模式：编辑、甘特、检查点、海报生成、全部导出功能照常可用，只有 AI 按钮不可用。</li>
    </ul>
    <h4>自测与排错</h4>
    <ul class="help-list">
      <li>离线自测：<code>node workbench/demo2/tools/selftest.mjs</code>，不依赖浏览器与 API Key，校验契约、示例项目、派生计算、导出产物、问答式补全与项目包往返。</li>
      <li>自测输出「失败 0 项」且退出码为 0 即代表数据结构与导出链路正常。</li>
    </ul>
    <h4>数据与备份</h4>
    <ul class="help-list">
      <li>项目数据保存在浏览器 <code>localStorage</code>，不跨设备同步。</li>
      <li>换浏览器、换电脑、清理缓存前，请先导出项目包（JSON）备份。</li>
      <li>素材库中的图片以 Data URL 保存，单张上限约 400 KB；容量接近浏览器上限时保存会提示失败。</li>
    </ul>
    <h4>常见运维动作</h4>
    <ul class="help-list">
      <li>端口被占用：先执行 <code>stop.bat</code> 或结束占用 4175 端口的 node 进程。</li>
      <li>界面空白：打开浏览器控制台看报错；多为本地数据损坏，可在「帮助与数据」清空后重新导入项目包。</li>
      <li>AI 报 401 / 403：密钥无效或过期；报 503：未读到 <code>.env</code>，确认它在仓库根目录。</li>
    </ul>`;

  const FAQ = [
    ['AI 会改掉我填好的内容吗？', '不会。合并规则是「只填空白与待确认」，任何被你手改过的字段、任务、风险、材料正文都会被标记为「用户填写」，AI 不再覆盖。'],
    ['「核心目标」「活动内容与形式」写不出来怎么办？', '用信息表右上角的「✦ 问答式补全」。它按活动类型逐题问你（场地、人数、预算、目标与衡量指标、核心环节、硬性约束），答完自动成稿写进空白字段；你写过的内容勾选后会被整段替换，但生成时会把当前内容一并交给 AI，由它按原文重写，所以旧内容清掉的同时有效信息仍在。'],
    ['问答式补全需要 API Key 吗？', '不需要。问题来自本地题库，离线也能完整走完；配了 Key 之后，「让 AI 再追问」会按你项目的类型与名称补几个更贴题的问题，「生成并填入」时 AI 会拿你的回答加上这三个字段的当前内容一起重写成通顺句子（请求形如「已知约束当前内容：…」），不会新增你没提供的人数、金额、单位与人名；如果你没勾选那一行，就完全不写入。'],
    ['某一题实在写不出来，只写「你帮我想」行不行？', '每题下面都配了参考：「常见做法」点一下就填进输入框（内容类可连点几条拼成一句，再点一次取消），「看 N 版示例」可以整段采用，配了 API Key 还能点「✦ AI 再给两版」让它就这一题拟 2–3 个可直接采用的版本。只写「你帮我想」「待确认」这类会被当成没说清，不会硬填进表单，而是提示你回去用上面的参考。'],
    ['追问为什么要先讲清「缺了这一项会怎样」？', '问题卡在提问下多显示一行「缺这一项会怎样」，例如问硬性约束会说「不写清，方案可能整体不成立：超时、超预算、违规」。这来自课程手册的追问口径：每次追问都要指认一个具体缺口、再给一条硬约束，问题才问得准。AI 追问还会标出这一问用的是哪类句式（依据 / 前提 / 反例 / 边界 / 替代 / 自评），优先问边界与替代，连追 2–3 类就够。'],
    ['没有 API Key 能用吗？', '能。除 AI 按钮外的所有功能都可用，包括手工建表、编辑、甘特、检查点、海报生成与全部导出。'],
    ['上传的 Word 模板不识别怎么办？', '模板需要真正的标题样式，或「一、」「（一）」「1.」这类编号。旧版 .doc 和 PDF 不支持，请先另存为 .docx。'],
    ['风险分值为啥都挤在中档？', '单次生成确实容易分值集中，所以做了两步：先生成清单，再由 risk-calibrate 只重算可能性和影响。你也可以点「重新校准评分」手动触发。'],
    ['怎么证明活动做完了？', '用「阶段检查点」逐项确认，用任务状态和完成度记录进度，收尾阶段导出复盘报告与经费决算表，全套资料可用「导出全量档案」一次性归档。'],
    ['数据怎么迁移给别人？', '「帮助与数据 → 导出项目包」得到 JSON，「导入项目包」在另一台机器还原。素材库中超过 400 KB 的图片不会入库，需要单独传原图。'],
    ['能多人同时编辑吗？', '不能。这是单机原型，数据存在本地浏览器；「身份」只是本地的角色开关，用来演示谁能改、谁只能看，不做账号校验，也不支持并发编辑。'],
    ['AI 生图会生成海报文字吗？', '不建议依赖。图像模型对中文文字不可靠，请让画面留白，标题、时间、地点等文字用「海报设计器」叠加，导出的 SVG / PNG 才是可发布的版本。'],
    ['演练记录和风险台账是什么关系？', '演练结束时默认会把结论写成一条风险记录（同名则更新），所以推演过什么、打算怎么处理，都会沉淀到风险台账与变更记录里。'],
    ['预算表这类表格，导出能直接给 Word 或 Excel 吗？', '能。材料卡片右侧按产出类型给了三个按钮：表格型默认 Excel、正文型默认 Word，另加 Markdown；页头的「导出材料包（Word）」会把所有已生成材料合成一份 Word。导出的都是真正的 .docx / .xlsx，Word、WPS、Excel 能直接打开，Excel 里每个章节是一张工作表、首行是表头并冻结。如果金额表某一行挂了发票，导出时会在表格最右自动多出一列「发票」并填上文件名；没有附件的表不会出现空列。'],
    ['材料正文里的表格怎么显示成了一堆竖线？', '材料卡片默认是「在线编辑」，管道表格已经渲染成表格；如果看到的是 | 科目 | 金额 | 这样的原文，说明切到了「Markdown 源码」。两种模式改的是同一份正文，正文始终按 Markdown 保存，导出时按结构拆成 Word 表格或 Excel 单元格。'],
    ['不想碰 Markdown，能直接在页面上改吗？', '能。默认就是「在线编辑」：段落、标题、列表、表格单元格点一下就能改，改完失焦（表格里按 Enter）自动回写，而且只更新改动的那个块，同一章其它内容、空行和表格对齐占位都原样保留。表格下方有「＋ 添加一行」，行尾悬停出现删除按钮（每张表至少保留一行）。'],
    ['发票怎么上传？', '金额 / 预算 / 费用类的表格（表头含金额 / 单价 / 费用 / 合计，或章节名带预算 / 经费 / 决算）最右会自动多出一列「发票」：把发票文件直接拖到对应那一行的格子里即可（也可以点该格选文件），一行最多 6 张，缩略图与文件名立刻出现。与素材库同一条 400 KB 规则：超限的只记文件名、不入库，需另行归档原件。发票只在导出 / 预览时拼成一列，正文 Markdown 不会被写入；删行时发票随行移动，重新生成材料会因行序变化而丢失发票，界面会提示。'],
    ['表格里的「合计」和「占比」能改吗？', '不能，也不需要。凡是能由金额算出来的都会自动求得：含「合计 / 总计 / 小计」的行按该列上方各行累加（容忍 ¥ 与千分位），「占比」列按「本行金额 ÷ 合计金额」实时算出（合计行固定 100%）。这些格子不可编辑、也没有删除按钮，改上面任意一格时它们会跟着一起变（打字过程中就变，不用等失焦）；「＋ 添加一行」会插在合计行上方。即使 AI 生成时写错了，预览与导出的 Word / Excel 都会按明细重算；确实要手改只能切「Markdown 源码」。'],
    ['AI 生成的内容能跟往届样表对齐吗？', '能。「过程材料」里每份材料都能「上传参考」（.docx / .md / .txt），也可以把文件直接拖到那张卡片上（拖拽区就是卡片本身）。Word 参考件在前端直接解析，不联网、不需要 Key：读出栏目（含 Word 表格里的整行小标题）、字段清单（活动名称 / 活动时间 / 负责人姓名 …）与原文，生成时一并交给 AI，要求结构与字段口径逐条对齐，参考里属于别的事实的值不会被照抄。章节优先级是「手选模板 > 参考 > 内置章节」。生成后卡片与参考面板会显示「栏目 x/y · 字段 a/b」的覆盖核对并列出缺项，核对只说明有没有写到，不判断内容对错。解析出来的原文可以在参考面板里展开核对。导出时还分两层：<b>版式</b>沿用参考的样式表、页面设置与页眉页脚（字体、字号、页边距、页眉页脚、表格线都跟着走，卡片上显示「版式 ✓」）；<b>内容</b>如果还想更贴参考，点卡片上的「⇄ 按参考重排」，AI 会按参考的栏目顺序、字段清单与表格列把当前正文重排成一份成稿（会替换正文，旁边有「↺ 撤回重排」）。参考是 .md / .txt，或版式部件超出本地存档预算时，只做内容对齐，Word 导出用默认版式。'],
    ['导出的 Word 能跟参考的格式一样吗？', '挂了参考件之后，卡片上的 Word 默认就是 <b>「Word（参考原表）」</b>：导出的就是这份参考件本身——表格怎么画、栏目叫什么、分几个部分、条目数量、缩进，连页眉页脚都跟参考一模一样，只把识别成「值」的文字换掉（跟「⇩ 参考表填值」是同一份产物，卡片上标着「按参考原表」）。想看 AI 写出来的正文，点旁边的 <b>「Word（正文）」</b>：版式仍沿用参考的样式表、页面设置与页眉页脚（卡片参考条显示「版式 ✓」），但表格结构来自正文本身。想让 AI 按参考的栏目与字段把正文重写成一份成稿（缺的写「待确认」，不照抄参考里属于别的事实的值，可「↺ 撤回重排」），用卡片上的「⇄ 按参考重排」。参考是 .md / .txt、或版式部件超出本地存档预算时，没有「参考原表」这一项，只做内容对齐。'],
    ['为什么有的表格看不到删行的 ×？', '删行按钮在每一行最右侧，鼠标悬停该行（或键盘 Tab 聚焦到该行）才显形。之前非金额表的按钮因为缺少定位祖先被甩到了页面右上角，看起来就像「这张表不能删行」，这一版已修复；「合计」行没有删除按钮，也不能删。'],
    ['「参考表填值」和「按参考重排」有什么区别？', '<b>参考表填值</b>（卡片上的「⇩ 参考表填值」，导出即「Word（参考原表）」）是把参考件当成一张要填的表：离线识别出栏目里的空位（标签格、正文段、表格数据格），你只填空位，导出时表格怎么画、环节叫什么、分几个部分、缩进与页眉页脚全部照参考原样，只换你填过值的地方，产物就是参考表本身——这是唯一保证「肉眼看上去结构一模一样」的路，离线可用。<b>按参考重排</b>是让 AI 按参考的栏目与字段把当前正文改写成一份成稿，结构照着来，但不是逐字节保真。要「在原表上替换几个值」用前者，要「照参考写一篇新的」用后者。'],
    ['「AI 补全空位」会拿哪些信息去补？','会先把整套项目上下文交给模型：项目信息表（活动类型 / 名称 / 时间 / 地点 / 对象 / 主办承办…）、任务分解、风险台账、资源台账、素材库，以及参考原文的写法；表格里的数字格也一起发。页面下方要求「输入里的每个空位 id 都要回一行」，模型**找不到依据的格子会显式留空**（不会瞎编），确实没有依据的和漏答的会分开计数（提示「已填 N / 无依据 N / 没回 N」）。所以你看到某格是空的，可能是表里本来就没有能推出它的信息——补一句事实（比如负责人、金额）再点一次就好。'],
  ];

  function renderSkills() {
    const skills = Object.values(window.WB.ai.skills());
    if (!skills.length) return SECTION('技能包一览', '<p class="help-muted">尚未读取到技能注册表。</p>');
    const items = skills.map((skill) => `<tr>
      <td><code>${escapeHtml(skill.id)}</code></td>
      <td>${escapeHtml(skill.title)}</td>
      <td>${escapeHtml(PHASE_LABEL[skill.phase] || skill.phase)}</td>
      <td>${escapeHtml({ document: '文档', table: '表格', graphic: '图形', structure: '结构化表' }[skill.kind] || skill.kind)}</td>
      <td>${escapeHtml({ word: 'Word', excel: 'Excel', svg: '海报 SVG/PNG', markdown: 'Markdown/CSV', none: '—' }[skill.deliverable] || skill.deliverable || '—')}</td>
      <td>${skill.ready ? '<span class="ok-tag">已接入</span>' : '<span class="warn-tag">待接入</span>'}</td>
    </tr>`).join('');
    return SECTION('技能包一览', `<p class="help-muted">每个产出对应一个技能包，定义在 <code>skills/&lt;id&gt;/SKILL.md</code>。技能包写「何时使用 + 输出契约 + 事实边界 + 交付格式」，具体细节放 references/；「交付」列是每个技能的主交付格式（表格型 Excel、正文型 Word）。</p>
      <div class="table-scroll"><table class="matrix help-table"><thead><tr><th>ID</th><th>名称</th><th>阶段</th><th>类型</th><th>交付</th><th>状态</th></tr></thead><tbody>${items}</tbody></table></div>`);
  }

  function renderLog() {
    const log = state().log.slice(0, 40);
    if (!log.length) return SECTION('关键节点记录', '<p class="help-muted">还没有记录。生成任务、风险、材料等动作会自动记入。</p>');
    return SECTION('关键节点记录', `<p class="help-muted">最近 40 条操作记录，可用于复盘报告与过程取证。</p>
      <ul class="log-list">${log.map((entry) => `<li><span class="log-time">${escapeHtml(fmtDateTime(entry.at))}</span>
        <span class="log-kind">${escapeHtml(entry.kind)}</span><span>${escapeHtml(entry.detail)}</span></li>`).join('')}</ul>`);
  }

  function renderData() {
    const current = state();
    const has = Boolean(current.project);
    return `<div class="card">
      <div class="card-title"><h3>数据管理</h3><small>项目包是唯一可跨设备迁移的格式，建议定期导出备份</small></div>
      <div class="data-actions">
        <button class="button button-primary" data-data="export-bundle" ${has ? '' : 'disabled'}>导出项目包（JSON）</button>
        <button class="button button-ghost" data-data="import-bundle">导入项目包</button>
        <button class="button button-ghost" data-data="load-sample">载入示例项目</button>
        <button class="button button-ghost" data-data="export-archive" ${has ? '' : 'disabled'}>导出全量档案（Markdown）</button>
        <button class="button button-ghost" data-data="export-log" ${current.log.length ? '' : 'disabled'}>导出关键节点记录</button>
        <button class="button button-ghost danger" data-data="clear" ${has ? '' : 'disabled'}>清空全部数据</button>
      </div>
      <p class="help-muted">当前项目：${escapeHtml(has ? store().projectName() : '（尚未建立）')} · 项目库 ${current.projects.length} 个 · 任务 ${current.wbs.length} 项 · 风险 ${current.risks.length} 项 · 资源 ${current.resources.length} 项 · 演练 ${current.drills.length} 场 · 材料 ${Object.keys(current.materials).length} 份 · 素材 ${current.assets.length} 项</p>
    </div>`;
  }

  function render() {
    const panel = $('#helpPanel');
    panel.innerHTML = `
      ${renderData()}
      ${SECTION('使用说明', GUIDE)}
      ${SECTION('运维指南', OPS)}
      ${SECTION('常见问题清单', `<ul class="faq-list">${FAQ.map(([q, a]) => `<li><b>${escapeHtml(q)}</b><p>${a}</p></li>`).join('')}</ul>`)}
      ${renderSkills()}
      ${renderLog()}
      <div class="card"><div class="card-title"><h3>术语速查</h3></div><div class="help-body">
        <ul class="help-list">
          <li><b>D-N</b>：相对活动日的时间写法，D-7 表示活动前 7 天，D+2 表示活动后 2 天。</li>
          <li><b>阶段门禁</b>：进入下一阶段前必须确认的检查点，用来防止「没准备好就开跑」。</li>
          <li><b>技能包（skill）</b>：一类产出的生成契约，决定章节结构、写作要求与事实边界。</li>
          <li><b>来源标记</b>：用户填写 / AI 建议 / 待确认，用于区分事实与推测。</li>
          <li><b>变更演练</b>：把一类突发场景按处置脚本推演一遍，用来暴露预案与资源缺口，不代表真实应急能力。</li>
          <li><b>占用冲突</b>：某项资源的「已安排」超过「可用数量」，需要调整排期、追加资源或压缩需求。</li>
        </ul></div></div>`;
  }

  function mount() {
    const panel = $('#helpPanel');
    const input = $('#bundleFile');

    panel.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-data]')?.dataset.data;
      if (!action) return;
      const name = U.safeFileName(store().projectName());

      if (action === 'export-bundle') {
        U.downloadText(`${name}-项目包.json`, JSON.stringify(store().exportBundle(), null, 2), 'application/json;charset=utf-8');
        store().log('export', '导出项目包');
        store().save();
        window.WB.toast('项目包已导出');
        return;
      }
      if (action === 'import-bundle') {
        if (!U.canOperate()) { window.WB.toast('只读访客不能导入项目包'); return; }
        input.click();
        return;
      }
      if (action === 'export-archive') {
        U.downloadText(`${name}-全周期策划与管控档案.md`, window.WB.exporters.fullArchive());
        store().log('export', '导出全量档案');
        store().save();
        window.WB.toast('全量档案已导出');
        return;
      }
      if (action === 'export-log') {
        U.downloadText(`${name}-关键节点记录.md`, window.WB.exporters.logToMarkdown());
        return;
      }
      if (action === 'load-sample') {
        if (!U.canOperate()) { window.WB.toast('只读访客不能载入示例项目'); return; }
        if (state().project && !confirm('载入示例项目会新建一个示例项目（当前项目不受影响），确定继续？')) return;
        await loadSample();
        return;
      }
      if (action === 'clear') {
        if (!U.canOperate()) { window.WB.toast('只读访客不能清空数据'); return; }
        if (!confirm('清空全部本地数据（含项目库里的所有项目与身份）且无法撤销，确定继续？建议先导出项目包。')) return;
        store().clearAll();
        window.WB.renderAll();
        window.WB.openLogin?.();
        window.WB.toast('已清空本地数据');
      }
    });

    input.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const bundle = JSON.parse(await file.text());
        store().importBundle(bundle);
        window.WB.renderAll();
        window.WB.toast('项目包导入成功');
      } catch (error) {
        window.WB.toast(`导入失败：${error.message}`);
      }
    });
  }

  async function loadSample() {
    try {
      const res = await fetch('./samples/示例项目-校园科技文化节.json');
      if (!res.ok) throw new Error(`示例文件不可读（HTTP ${res.status}）`);
      const bundle = await res.json();
      store().importBundle(bundle);
      window.WB.renderAll();
      window.WB.toast('示例项目已载入：可依次查看总览、任务、风险与材料');
    } catch (error) {
      window.WB.toast(`载入示例失败：${error.message}`);
    }
  }

  window.WB.views.help = { id: 'help', label: '帮助与数据', render, mount, loadSample };
}());
