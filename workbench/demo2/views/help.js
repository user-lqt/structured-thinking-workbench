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
      <li><b>① 选身份、建项目</b>：首次打开先选一个本地演示身份（活动组织者 / 活动成员 / 只读访客），再填活动基本信息；只有「活动类型 / 名称 / 日期」必填，其余留空会由 AI 补成「待确认」。</li>
      <li><b>② 认准一页到底</b>：整个工作台就是一页。顶部导航条分「主线」和「工具」两行，点一下滚到对应分区，滚动时也会自动高亮你正在看的那一节，不用来回切页。</li>
      <li><b>③ 顺着编号做</b>：00 总览 → 01 项目信息表（勾选产出）→ 02 全周期任务 → 03 风险预案 → 04 人员与资源 → 05 过程材料。总览里的阶段块、缺口、关键节点、产出都是入口，点一下直接落到能处理它的那一行。</li>
    </ol>
    <ul class="help-list">
      <li><b>主线六步</b>（同一页自上而下）：<code>00 总览</code> 看进度与待办 · <code>01 项目信息表</code> 定事实与产出 · <code>02 全周期任务</code> 分解 / 甘特 / 阶段门禁 · <code>03 风险预案</code> 台账与分级预案 · <code>04 人员与资源</code> 台账与占用冲突 · <code>05 过程材料</code> 逐份生成。</li>
      <li><b>工具五项</b>（同一页后半段）：<code>A 方案比选</code> 加权决策矩阵 · <code>B 变更演练</code> 突发场景推演 · <code>C 素材库</code> 图片与文案 · <code>D 项目库</code> 多项目与项目包 · <code>E 帮助与数据</code> 技能包与导出。</li>
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
      <li>离线自测：<code>node workbench/demo2/tools/selftest.mjs</code>，不依赖浏览器与 API Key，校验契约、示例项目、派生计算、导出产物与项目包往返。</li>
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
    ['没有 API Key 能用吗？', '能。除 AI 按钮外的所有功能都可用，包括手工建表、编辑、甘特、检查点、海报生成与全部导出。'],
    ['上传的 Word 模板不识别怎么办？', '模板需要真正的标题样式，或「一、」「（一）」「1.」这类编号。旧版 .doc 和 PDF 不支持，请先另存为 .docx。'],
    ['风险分值为啥都挤在中档？', '单次生成确实容易分值集中，所以做了两步：先生成清单，再由 risk-calibrate 只重算可能性和影响。你也可以点「重新校准评分」手动触发。'],
    ['怎么证明活动做完了？', '用「阶段检查点」逐项确认，用任务状态和完成度记录进度，收尾阶段导出复盘报告与经费决算表，全套资料可用「导出全量档案」一次性归档。'],
    ['数据怎么迁移给别人？', '「帮助与数据 → 导出项目包」得到 JSON，「导入项目包」在另一台机器还原。素材库中超过 400 KB 的图片不会入库，需要单独传原图。'],
    ['能多人同时编辑吗？', '不能。这是单机原型，数据存在本地浏览器；「身份」只是本地的角色开关，用来演示谁能改、谁只能看，不做账号校验，也不支持并发编辑。'],
    ['AI 生图会生成海报文字吗？', '不建议依赖。图像模型对中文文字不可靠，请让画面留白，标题、时间、地点等文字用「海报设计器」叠加，导出的 SVG / PNG 才是可发布的版本。'],
    ['演练记录和风险台账是什么关系？', '演练结束时默认会把结论写成一条风险记录（同名则更新），所以推演过什么、打算怎么处理，都会沉淀到风险台账与变更记录里。']
  ];

  function renderSkills() {
    const skills = Object.values(window.WB.ai.skills());
    if (!skills.length) return SECTION('技能包一览', '<p class="help-muted">尚未读取到技能注册表。</p>');
    const items = skills.map((skill) => `<tr>
      <td><code>${escapeHtml(skill.id)}</code></td>
      <td>${escapeHtml(skill.title)}</td>
      <td>${escapeHtml(PHASE_LABEL[skill.phase] || skill.phase)}</td>
      <td>${escapeHtml({ document: '文档', table: '表格', graphic: '图形', structure: '结构化表' }[skill.kind] || skill.kind)}</td>
      <td>${skill.ready ? '<span class="ok-tag">已接入</span>' : '<span class="warn-tag">待接入</span>'}</td>
    </tr>`).join('');
    return SECTION('技能包一览', `<p class="help-muted">每个产出对应一个技能包，定义在 <code>skills/&lt;id&gt;/SKILL.md</code>。技能包只写「何时使用 + 输出契约 + 事实边界」，具体细节放 references/。</p>
      <div class="table-scroll"><table class="matrix help-table"><thead><tr><th>ID</th><th>名称</th><th>阶段</th><th>类型</th><th>状态</th></tr></thead><tbody>${items}</tbody></table></div>`);
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
      ${SECTION('常见问题清单', `<ul class="faq-list">${FAQ.map(([q, a]) => `<li><b>${escapeHtml(q)}</b><p>${escapeHtml(a)}</p></li>`).join('')}</ul>`)}
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
