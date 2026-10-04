'use strict';

// ====================== 基础工具 ======================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function fmtTime(t) {
  return t ? t.replace('T', ' ').slice(0, 16) : '';
}

let toastTimer = null;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* 非 JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ====================== Tab 切换 ======================

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const which = tab.dataset.tab;
    $('#view-trainee').hidden = which !== 'trainee';
    $('#view-trainer').hidden = which !== 'trainer';
    if (which === 'trainee') { loadPublished(); loadSessionList(); }
    if (which === 'trainer') {
      coverageCtx = null;
      $('#trainer-coverage').hidden = true;
      $('#trainer-editor').hidden = true;
      $('#trainer-home').hidden = false;
      loadScenarios();
    }
  });
});

// ====================== 学员端 ======================

let currentSession = null;

async function loadPublished() {
  const list = await api('/api/published');
  const box = $('#published-list');
  if (!list.length) {
    box.innerHTML = '<div class="muted">暂无已发布情境。请培训师在“编排”页发布后再开始演练。</div>';
    return;
  }
  box.innerHTML = list.map((s) => `
    <div class="card sc-card">
      <div class="title">${esc(s.title)}</div>
      <div class="meta">
        <span class="badge v">v${s.current_version}</span>
        发布于 ${fmtTime(s.published_at)}
      </div>
      <div style="margin-top:10px">
        <button class="btn primary" data-start-id="${esc(s.id)}">开始新演练</button>
      </div>
    </div>`).join('');
}

$('#btn-reload-published').addEventListener('click', () => { loadPublished(); loadSessionList(); });

$('#published-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-start-id]');
  if (!btn) return;
  const traineeName = $('#trainee-name').value.trim();
  try {
    const snap = await api('/api/sessions', { method: 'POST', body: { scenarioId: btn.dataset.startId, traineeName } });
    enterSession(snap);
    toast('已开始新演练（绑定当前最新发布版）', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
});

async function loadSessionList() {
  const list = await api('/api/sessions');
  const box = $('#session-list');
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <table class="ses-table">
      <thead><tr><th>会话码</th><th>情境</th><th>版本</th><th>状态</th><th>步数</th><th>总分</th><th>来源</th><th>学员</th><th></th></tr></thead>
      <tbody>
        ${list.map((s) => `
          <tr>
            <td><code>${esc(s.code)}</code></td>
            <td>${esc(s.scenario_title)}</td>
            <td>v${s.version}</td>
            <td class="${s.status === 'active' ? 'status-active' : 'status-ended'}">${s.status === 'active' ? '进行中' : '已结局'}</td>
            <td>${s.step_no}</td>
            <td><b class="${scoreClass(s.total_score || 0)}">${s.total_score || 0}</b></td>
            <td>${s.parent_code
              ? `分支↩<code data-lineage-jump="${esc(s.parent_code)}" title="查看源会话">${esc(s.parent_code)}</code>@${s.fork_step_no}步`
              : '<span class="muted">原始</span>'}</td>
            <td>${esc(s.trainee_name || '—')}</td>
            <td class="ses-actions">
              <button class="btn sm" data-resume="${esc(s.code)}">${s.status === 'active' ? '继续' : '查看'}</button>
              <button class="btn sm" data-fork="${esc(s.code)}" title="从历史步创建复盘分支">🌿 分叉</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

$('#session-list').addEventListener('click', async (e) => {
  const jump = e.target.closest('[data-lineage-jump]');
  if (jump) {
    try {
      const snap = await api(`/api/sessions/${encodeURIComponent(jump.dataset.lineageJump)}`);
      enterSession(snap);
    } catch (err) { toast(err.message, 'err'); }
    return;
  }
  const forkBtn = e.target.closest('[data-fork]');
  if (forkBtn) {
    try {
      const snap = await api(`/api/sessions/${encodeURIComponent(forkBtn.dataset.fork)}`);
      enterSession(snap);
      openForkPanel();
    } catch (err) { toast(err.message, 'err'); }
    return;
  }
  const btn = e.target.closest('[data-resume]');
  if (btn) {
    try {
      const snap = await api(`/api/sessions/${encodeURIComponent(btn.dataset.resume)}`);
      enterSession(snap);
    } catch (err) { toast(err.message, 'err'); }
  }
});

function openForkPanel() {
  const card = document.querySelector('.fork-card');
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1200);
  }
  const sel = $('#fork-step-select');
  if (sel && sel.options.length) sel.focus();
}

$('#btn-resume').addEventListener('click', async () => {
  const code = $('#resume-code').value.trim();
  if (!code) return toast('请输入会话码');
  try {
    const snap = await api(`/api/sessions/${encodeURIComponent(code)}`);
    enterSession(snap);
  } catch (err) { toast(err.message, 'err'); }
});

$('#btn-exit-session').addEventListener('click', () => {
  currentSession = null;
  $('#trainee-session').hidden = true;
  $('#trainee-home').hidden = false;
  loadSessionList();
});

function enterSession(snap) {
  currentSession = snap;
  $('#trainee-home').hidden = true;
  $('#trainee-session').hidden = false;
  hideBanner();
  renderSession();
}

function hideBanner() {
  const b = $('#ses-banner');
  b.className = 'banner hidden';
  b.textContent = '';
}

function showBanner(msg, kind) {
  const b = $('#ses-banner');
  b.textContent = msg;
  b.className = 'banner ' + kind;
}

function renderSession() {
  const s = currentSession;
  if (!s) return;
  $('#ses-scenario-title').textContent = s.scenarioTitle || '';
  $('#ses-code').textContent = s.code;
  $('#ses-version').textContent = 'v' + s.version;
  $('#ses-step').textContent = s.stepNo;
  $('#ses-score').textContent = s.totalScore;
  $('#ses-score').className = scoreClass(s.totalScore);

  // 溯源标记
  const lin = s.lineage || {};
  $('#ses-lineage').innerHTML = lin.isBranch
    ? ` · <span class="branch-flag" title="该会话是复盘分支">🌿 分支（源 <code data-lineage-jump="${esc(lin.parentCode)}">${esc(lin.parentCode)}</code> 的第 ${lin.forkStepNo} 步分叉）</span>`
    : '';

  const node = s.currentNode;
  $('#node-kick').textContent = node && node.isEnd ? '结局' : '当前情境';
  $('#node-title').textContent = node ? node.title : '（节点缺失）';
  $('#node-narrative').textContent = node && node.narrative ? node.narrative : '';

  // 状态
  $('#state-list').innerHTML = s.states.map((st) => `
    <div class="state-row">
      <span>${esc(st.name)}</span>
      <span class="state-val ${st.value ? 'yes' : 'no'}">${st.value ? '● 是' : '○ 否'}</span>
    </div>`).join('');

  // 选项
  const optBox = $('#option-list');
  if (s.status === 'ended') {
    optBox.innerHTML = '<div class="muted">演练已结束。</div>';
    showBanner(`演练结束：已到达结局「${node ? node.title : ''}」，共 ${s.stepNo} 步，总分 <b>${s.totalScore}</b> 分。${lin.isBranch ? '（本会话为复盘分支，可在右侧从更早的步骤再次分叉）' : '（可在右侧从历史步分叉复盘）'}`, 'ok');
  } else {
    const avail = s.availableOptions.map((o) => `
      <button class="option-btn" data-opt="${esc(o.id)}">
        ${esc(o.label)}
        ${o.conditions.length ? `<span class="conds">条件：${o.conditions.map((c) => condText(s, c)).join('；')}</span>` : ''}
      </button>`).join('');
    const unavail = (s.unavailableOptions || []).map((o) => `
      <button class="option-btn disabled-opt" data-opt="${esc(o.id)}" title="当前条件不满足，提交也会被服务器拒绝">
        🔒 ${esc(o.label)}
        <span class="lock">${esc(o.reason)}：${o.failingConditions.map((f) => `${esc(f.stateName)} 需为「${f.required ? '是' : '否'}」`).join('；')}</span>
      </button>`).join('');
    optBox.innerHTML = (avail || '<div class="muted">当前没有可选项。</div>') + unavail;
  }

  // 路径
  $('#path-list').innerHTML = s.path.map((p) => renderPathItem(p, s)).join('');

  // 复盘分叉：可选分歧步 0..当前步号（结局步即当前步会在服务端拒绝，这里直接禁选）
  renderForkStepSelect(s);

  // 来源与分支对照
  loadLineageView(s.code);
}

function scoreClass(v) {
  if (v > 0) return 'score-pos';
  if (v < 0) return 'score-neg';
  return 'score-zero';
}

function scoreBadge(score) {
  const v = Number.isInteger(score) ? score : 0;
  const sign = v > 0 ? '+' : '';
  return `<span class="step-score ${scoreClass(v)}" title="本步得分">${sign}${v} 分</span>`;
}

function renderPathItem(p, snap) {
  const isFinal = snap && p.toNodeTitle && snap.status === 'ended' && p.step === snap.stepNo;
  const note = p.scoreNote ? `<span class="pl-note">评分说明：${esc(p.scoreNote)}</span>` : '';
  return `
    <li>
      <b>第 ${p.step} 步</b>：${esc(p.fromNodeTitle)}
      —「${esc(p.optionLabel)}」→
      <span class="${isFinal ? 'pl-end' : ''}">${esc(p.toNodeTitle)}</span>
      ${scoreBadge(p.score)}
      <span class="pl-sub">状态：${p.stateAfter.map((x) => `${esc(x.name)}=${x.value ? '是' : '否'}`).join('，') || '无'}</span>
      ${note}
    </li>`;
}

function renderForkStepSelect(s) {
  const sel = $('#fork-step-select');
  const nodeTitleAt = (step) => {
    if (step === 0) return s.startNodeTitle || '初态';
    const p = s.path.find((x) => x.step === step);
    return p ? p.toNodeTitle : '?';
  };
  // 已结束：默认选中结局步之前那一步（最后一个可分叉步）；进行中：默认可从当前步分叉
  const preferred = s.status === 'ended' ? Math.max(0, s.stepNo - 1) : s.stepNo;
  let html = '';
  for (let k = 0; k <= s.stepNo; k++) {
    const isEnd = k === s.stepNo && s.status === 'ended';
    const selAttr = k === preferred ? 'selected' : '';
    html += `<option value="${k}" ${isEnd ? 'disabled' : ''} ${selAttr}>第 ${k} 步 · ${esc(nodeTitleAt(k))}${isEnd ? '（结局步，不可分叉）' : ''}</option>`;
  }
  sel.innerHTML = html;
  $('#fork-name').value = '';
}

function condText(snap, c) {
  const st = snap.states.find((x) => x.id === c.stateId);
  return `${st ? st.name : c.stateId}=${c.value ? '是' : '否'}`;
}

$('#option-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-opt]');
  if (!btn || !currentSession) return;
  if (currentSession.status !== 'active') return;
  const optionId = btn.dataset.opt;
  // 防重复点击：以本地当前步号提交，服务器比对步号决定是否推进
  const stepNo = currentSession.stepNo;
  try {
    const snap = await api(`/api/sessions/${currentSession.code}/move`, {
      method: 'POST',
      body: { optionId, stepNo },
    });
    currentSession = snap;
    hideBanner();
    renderSession();
    loadSessionList();
    if (snap.lastMove) {
      const lm = snap.lastMove;
      const sign = lm.score > 0 ? '+' : '';
      showBanner(
        `本步得分 ${sign}${lm.score} 分，当前累计 ${lm.totalScore} 分。`
        + (lm.scoreNote ? ` 评分说明：${lm.scoreNote}` : ''),
        lm.score > 0 ? 'ok' : (lm.score < 0 ? 'error' : 'info'));
    }
  } catch (err) {
    // 过期/不满足条件：展示服务器返回的原因与现状，不推进
    const reason = err.message;
    if (err.data && err.data.current) {
      currentSession = { ...currentSession, ...err.data.current, scenarioTitle: currentSession.scenarioTitle };
      renderSession();
    }
    showBanner(`选择被拒绝：${reason}`, 'error');
  }
});

// ====================== 培训师：复盘分叉 ======================

$('#btn-fork').addEventListener('click', async () => {
  if (!currentSession) return;
  const sel = $('#fork-step-select');
  const forkStepNo = parseInt(sel.value, 10);
  if (!Number.isInteger(forkStepNo)) return toast('请选择分歧步号');
  const traineeName = $('#fork-name').value.trim();
  // observedStepNo 携带“所见的源当前步号”，服务端比对，源会话若已被推进则拒绝并返回其当前步号
  const observedStepNo = currentSession.stepNo;
  const sourceCode = currentSession.code;
  try {
    const snap = await api(`/api/sessions/${encodeURIComponent(sourceCode)}/fork`, {
      method: 'POST',
      body: { forkStepNo, observedStepNo, traineeName },
    });
    enterSession(snap);
    showBanner(`已从源会话 ${sourceCode} 的第 ${forkStepNo} 步创建分支（沿用冻结版本 v${snap.version}），继承此前路径得分 ${snap.inheritedScore ?? snap.totalScore ?? 0} 分，后续选择只计本分支。`, 'ok');
    toast('分支已创建，可在此局面继续选择', 'ok');
    loadSessionList();
  } catch (err) {
    if (err.data && err.data.sourceCurrent && err.data.errorCode === 'STEP_STALE') {
      // 源步号已变化：刷新到源会话最新现状，让培训师重新选择分歧步
      try {
        const fresh = await api(`/api/sessions/${encodeURIComponent(sourceCode)}`);
        currentSession = fresh;
        renderSession();
      } catch (_) { /* 忽略二次刷新失败 */ }
    } else if (err.data && err.data.current) {
      currentSession = { ...currentSession, ...err.data.current, scenarioTitle: currentSession.scenarioTitle };
      renderSession();
    }
    showBanner(`分叉被拒绝：${err.message}`, 'error');
  }
});

// 会话页溯源标记 / 对照树内的会话跳转
$('#trainee-session').addEventListener('click', async (e) => {
  const jump = e.target.closest('[data-lineage-jump]');
  if (!jump) return;
  try {
    const snap = await api(`/api/sessions/${encodeURIComponent(jump.dataset.lineageJump)}`);
    enterSession(snap);
  } catch (err) { toast(err.message, 'err'); }
});

async function loadLineageView(code) {
  const box = $('#lineage-box');
  try {
    const r = await api(`/api/sessions/${encodeURIComponent(code)}/lineage`);
    box.innerHTML = renderLineageNode(r.tree, code);
  } catch (err) {
    box.innerHTML = `<div class="muted">对照信息加载失败：${esc(err.message)}</div>`;
  }
}

function renderLineageNode(node, currentCode, depth = 0) {
  const isCurrent = node.code === currentCode;
  const isBranch = node.lineage && node.lineage.isBranch;
  const head = `
    <div class="lg-node ${isCurrent ? 'lg-current' : ''}" style="margin-left:${depth * 14}px">
      <div class="lg-head">
        ${isBranch ? '🌿' : '🟢'}
        <code data-lineage-jump="${esc(node.code)}" title="查看该会话">${esc(node.code)}</code>
        ${isBranch ? `<span class="muted">← 源 <code>${esc(node.lineage.parentCode)}</code>@第${node.lineage.forkStepNo}步分叉</span>` : '<span class="muted">原始会话</span>'}
        ${isCurrent ? '<span class="badge v">当前查看</span>' : ''}
      </div>
      <div class="lg-meta muted">
        v${node.version} · ${node.status === 'active' ? `<span class="status-active">进行中·第${node.stepNo}步</span>` : `<span class="status-ended">已结局·共${node.stepNo}步</span>`}
        · 总分 <b class="${scoreClass(node.totalScore)}">${node.totalScore}</b>
        · 当前：${esc(node.currentNode ? node.currentNode.title : '?')}${node.traineeName ? ' · ' + esc(node.traineeName) : ''}
      </div>
      ${node.path.length ? `
        <details class="lg-path" ${isCurrent ? 'open' : ''}>
          <summary>后续路径（${node.path.length} 步）${isBranch ? `；保留源第 1..${node.lineage.forkStepNo} 步，自第 ${node.lineage.forkStepNo} 步局面另走` : ''}</summary>
          <ol class="path-list">${node.path.map((p) => renderPathItem(p, node)).join('')}</ol>
        </details>` : '<div class="muted lg-meta">第 0 步（尚未选择）</div>'}
    </div>`;
  const children = (node.children || []).map((c) => renderLineageNode(c, currentCode, depth + 1)).join('');
  return head + children;
}

// ====================== 培训师端：列表 ======================

let editing = null; // { id, currentVersion, draft }

async function loadScenarios() {
  const list = await api('/api/scenarios');
  const box = $('#scenario-list');
  if (!list.length) {
    box.innerHTML = '<div class="muted">还没有情境，点击右上角“新建情境”开始编排。</div>';
    return;
  }
  box.innerHTML = list.map((s) => `
    <div class="card sc-card" data-open="${esc(s.id)}">
      <div class="title">${esc(s.title)}</div>
      <div class="meta">
        ${s.current_version > 0
          ? `<span class="badge v">已发布 v${s.current_version}</span>`
          : '<span class="badge draft">未发布</span>'}
        会话 ${s.session_count} 个 · 更新于 ${fmtTime(s.updated_at)}
      </div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <span class="btn">编排 / 查看</span>
        ${s.current_version > 0
          ? `<button class="btn" data-coverage="${esc(s.id)}" data-version="${s.current_version}" title="查看已发布版本的处置覆盖情况">📊 处置覆盖报告</button>`
          : ''}
      </div>
    </div>`).join('');
}

$('#scenario-list').addEventListener('click', (e) => {
  const covBtn = e.target.closest('[data-coverage]');
  if (covBtn) {
    e.stopPropagation();
    openCoverage(covBtn.dataset.coverage, parseInt(covBtn.dataset.version, 10));
    return;
  }
  const card = e.target.closest('[data-open]');
  if (card) openEditor(card.dataset.open);
});

$('#btn-new-scenario').addEventListener('click', async () => {
  const template = {
    title: '未命名事故处置情境',
    states: [{ id: 's1', name: '新状态（如：电源已切断）', initial: false }],
    startNodeId: 'n1',
    nodes: [
      { id: 'n1', title: '起点', narrative: '描述事故发生的初始情况……', isEnd: false, options: [
        { id: 'o1', label: '第一个处置选择', conditions: [], changes: [], toNodeId: 'n2', score: null, scoreNote: '' },
      ] },
      { id: 'n2', title: '结局', narrative: '描述该处置的结果……', isEnd: true, options: [] },
    ],
  };
  try {
    const r = await api('/api/scenarios', { method: 'POST', body: template });
    editing = { id: r.id, currentVersion: 0, draft: r.draft };
    showEditor();
    toast('已创建，可以开始编排');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#btn-back-list').addEventListener('click', async () => {
  editing = null;
  $('#trainer-editor').hidden = true;
  $('#trainer-home').hidden = false;
  await loadScenarios();
});

async function openEditor(id) {
  const detail = await api(`/api/scenarios/${id}`);
  if (!detail.draft) { toast('该情境没有草稿数据'); return; }
  editing = { id: detail.id, currentVersion: detail.currentVersion, draft: detail.draft };
  showEditor();
}

function showEditor() {
  $('#trainer-home').hidden = true;
  $('#trainer-editor').hidden = false;
  $('#editor-report').className = 'report hidden';
  renderEditor();
}

// ====================== 培训师端：编辑器渲染 ======================

function stateInUse(stateId) {
  for (const n of editing.draft.nodes) {
    for (const o of n.options) {
      if (o.conditions.some((t) => t.stateId === stateId) || o.changes.some((t) => t.stateId === stateId)) {
        return n.title || n.id;
      }
    }
  }
  return null;
}

function renderEditor() {
  const d = editing.draft;
  $('#editor-title').value = d.title;
  $('#editor-version-label').textContent = editing.currentVersion > 0
    ? `当前已发布 v${editing.currentVersion}；发布将生成 v${editing.currentVersion + 1}，进行中的旧会话不受影响`
    : '尚未发布；发布后学员方可开始演练';

  // 状态
  const sBox = $('#state-editor-list');
  sBox.innerHTML = d.states.map((s, i) => `
    <div class="state-edit-row">
      <input class="input sm" style="width:70px" value="${esc(s.id)}" data-bind="state-id" data-i="${i}" placeholder="id" />
      <input class="input name" value="${esc(s.name)}" data-bind="state-name" data-i="${i}" placeholder="状态名称" />
      <label class="checkbox"><input type="checkbox" data-bind="state-initial" data-i="${i}" ${s.initial ? 'checked' : ''}/> 初值为“是”</label>
      <button class="btn ghost danger" data-act="del-state" data-i="${i}">删除</button>
    </div>`).join('');
  $('#btn-add-state').disabled = d.states.length >= 8;

  // 起点选择
  const startSel = $('#start-select');
  startSel.innerHTML = d.nodes.map((n) =>
    `<option value="${esc(n.id)}" ${n.id === d.startNodeId ? 'selected' : ''}>${esc(n.title || n.id)}</option>`).join('');

  // 节点
  const box = $('#node-editor-list');
  box.innerHTML = d.nodes.map((n, ni) => {
    const optsHtml = n.isEnd ? '' : n.options.map((o, oi) => renderOption(n, o, ni, oi)).join('');
    return `
    <div class="node-block ${n.isEnd ? 'is-end' : ''}">
      <div class="node-block-head">
        <input class="input sm" style="width:90px" value="${esc(n.id)}" data-bind="node-id" data-ni="${ni}" placeholder="节点id" />
        <input class="input node-title-input" value="${esc(n.title)}" data-bind="node-title" data-ni="${ni}" placeholder="节点标题" />
        ${n.id === d.startNodeId ? '<span class="start-flag">▶ 起点</span>' : ''}
        <label class="checkbox"><input type="checkbox" data-bind="node-end" data-ni="${ni}" ${n.isEnd ? 'checked' : ''}/> 结局节点</label>
        <button class="btn ghost danger" data-act="del-node" data-ni="${ni}">删除节点</button>
      </div>
      <div class="field">
        <textarea class="input" data-bind="node-narr" data-ni="${ni}" placeholder="情境描述（学员可见）">${esc(n.narrative)}</textarea>
      </div>
      ${n.isEnd ? '' : `
        <div class="field">
          <label>选项（条件满足时学员可见可选；选择后应用状态变更并跳转）</label>
          ${optsHtml || '<div class="muted">暂无选项（非结局节点无选项在发布检查时会被判为无路可走）</div>'}
          <button class="btn dashed" data-act="add-opt" data-ni="${ni}">＋ 添加选项</button>
        </div>`}
    </div>`;
  }).join('');
}

function stateOptions(selected) {
  return editing.draft.states.map((s) =>
    `<option value="${esc(s.id)}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)} (${esc(s.id)})</option>`).join('');
}

function nodeOptions(selected) {
  return editing.draft.nodes.map((n) =>
    `<option value="${esc(n.id)}" ${n.id === selected ? 'selected' : ''}>${esc(n.title || n.id)}</option>`).join('');
}

function renderTermRows(kind, terms, ni, oi) {
  const verb = kind === 'cond' ? '要求' : '置为';
  return terms.map((t, ti) => `
    <div class="term-row">
      <span class="term-mini-label">${verb}</span>
      <select class="input sm" data-bind="${kind}-state" data-ni="${ni}" data-oi="${oi}" data-ti="${ti}">
        ${stateOptions(t.stateId)}
      </select>
      <select class="input sm" style="width:70px" data-bind="${kind}-value" data-ni="${ni}" data-oi="${oi}" data-ti="${ti}">
        <option value="true" ${t.value ? 'selected' : ''}>是</option>
        <option value="false" ${!t.value ? 'selected' : ''}>否</option>
      </select>
      <button class="btn ghost danger" data-act="del-${kind}" data-ni="${ni}" data-oi="${oi}" data-ti="${ti}">×</button>
    </div>`).join('');
}

function renderOption(n, o, ni, oi) {
  return `
    <div class="opt-block">
      <div class="opt-head">
        <input class="input sm" style="width:80px" value="${esc(o.id)}" data-bind="opt-id" data-ni="${ni}" data-oi="${oi}" placeholder="选项id" />
        <input class="input label" value="${esc(o.label)}" data-bind="opt-label" data-ni="${ni}" data-oi="${oi}" placeholder="选项文案（学员看到的处置动作）" />
        <button class="btn ghost danger" data-act="del-opt" data-ni="${ni}" data-oi="${oi}">删除</button>
      </div>
      <div class="field">
        <label>显示条件（全部满足时该选项可选）</label>
        ${renderTermRows('cond', o.conditions, ni, oi)}
        <button class="btn dashed" data-act="add-cond" data-ni="${ni}" data-oi="${oi}">＋ 添加条件</button>
      </div>
      <div class="field">
        <label>状态变更（选择后执行）</label>
        ${renderTermRows('chg', o.changes, ni, oi)}
        <button class="btn dashed" data-act="add-chg" data-ni="${ni}" data-oi="${oi}">＋ 添加变更</button>
      </div>
      <div class="term-row">
        <span class="term-mini-label">跳转</span>
        <select class="input sm" data-bind="opt-target" data-ni="${ni}" data-oi="${oi}">${nodeOptions(o.toNodeId)}</select>
      </div>
      <div class="field score-field">
        <label>评分（选择该选项的得分：-10 至 10 的整数，留空视为 0）</label>
        <div class="score-edit-row">
          <input class="input sm score-input" type="number" min="-10" max="10" step="1"
                 value="${o.score === undefined || o.score === null ? '' : esc(String(o.score))}"
                 data-bind="opt-score" data-ni="${ni}" data-oi="${oi}" placeholder="0" />
          <input class="input score-note" maxlength="500"
                 value="${esc(o.scoreNote || '')}"
                 data-bind="opt-score-note" data-ni="${ni}" data-oi="${oi}"
                 placeholder="评分说明（学员选后可见，可说明该处置好/坏在哪里）" />
        </div>
      </div>
    </div>`;
}

// ---------- 编辑器：结构变更（事件委托） ----------

$('#trainer-editor').addEventListener('click', onEditorAction);

function onEditorAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const d = editing.draft;
  const act = btn.dataset.act;
  const ni = +btn.dataset.ni;
  const oi = +btn.dataset.oi;
  const ti = +btn.dataset.ti;

  switch (act) {
    case 'add-state':
      if (d.states.length >= 8) return toast('至多 8 个现场状态');
      d.states.push({ id: uid('s'), name: '新状态', initial: false });
      break;
    case 'del-state': {
      const st = d.states[ni];
      const usedIn = stateInUse(st.id);
      if (usedIn) return toast(`状态「${st.name}」仍被节点「${usedIn}」的条件/变更引用，请先移除引用`, 'err');
      d.states.splice(ni, 1);
      break;
    }
    case 'add-node': {
      const id = uid('n');
      d.nodes.push({ id, title: '新节点', narrative: '', isEnd: false, options: [] });
      break;
    }
    case 'del-node': {
      const n = d.nodes[ni];
      if (!window.confirm(`确定删除节点「${n.title || n.id}」？指向它的选项会在保存时被服务端判为无效引用。`)) return;
      d.nodes.splice(ni, 1);
      if (d.startNodeId === n.id) d.startNodeId = d.nodes[0] ? d.nodes[0].id : '';
      break;
    }
    case 'add-opt':
      d.nodes[ni].options.push({
        id: uid('o'), label: '新选择', conditions: [], changes: [],
        toNodeId: d.nodes[ni].id, score: null, scoreNote: '',
      });
      break;
    case 'del-opt':
      d.nodes[ni].options.splice(oi, 1);
      break;
    case 'add-cond':
      if (!d.states.length) { toast('请先在右侧定义至少一个状态', 'err'); break; }
      d.nodes[ni].options[oi].conditions.push({ stateId: d.states[0].id, value: true });
      break;
    case 'del-cond':
      d.nodes[ni].options[oi].conditions.splice(ti, 1);
      break;
    case 'add-chg':
      if (!d.states.length) { toast('请先在右侧定义至少一个状态', 'err'); break; }
      d.nodes[ni].options[oi].changes.push({ stateId: d.states[0].id, value: true });
      break;
    case 'del-chg':
      d.nodes[ni].options[oi].changes.splice(ti, 1);
      break;
  }
  renderEditor();
}

// ---------- 编辑器：字段变更（不整体重绘，避免失焦） ----------

$('#trainer-editor').addEventListener('input', (e) => {
  const el = e.target;
  const b = el.dataset.bind;
  if (!b || !editing) return;
  const d = editing.draft;
  const ni = +el.dataset.ni, oi = +el.dataset.oi, ti = +el.dataset.ti, i = +el.dataset.i;
  switch (b) {
    case 'state-id': d.states[i].id = el.value; break;
    case 'state-name': d.states[i].name = el.value; break;
    case 'node-id': d.nodes[ni].id = el.value; break;
    case 'node-title': d.nodes[ni].title = el.value; break;
    case 'node-narr': d.nodes[ni].narrative = el.value; break;
    case 'opt-id': d.nodes[ni].options[oi].id = el.value; break;
    case 'opt-label': d.nodes[ni].options[oi].label = el.value; break;
    case 'opt-score': {
      const v = el.value.trim();
      // 留空按未填写处理（服务端保存时视为 0）；非整数/越界仍由服务端拒绝
      d.nodes[ni].options[oi].score = v === '' ? null : Number(v);
      break;
    }
    case 'opt-score-note': d.nodes[ni].options[oi].scoreNote = el.value; break;
    default: break;
  }
});

$('#trainer-editor').addEventListener('change', (e) => {
  const el = e.target;
  const b = el.dataset.bind;
  if (!b || !editing) return;
  const d = editing.draft;
  const ni = +el.dataset.ni, oi = +el.dataset.oi, ti = +el.dataset.ti, i = +el.dataset.i;
  switch (b) {
    case 'state-initial': d.states[i].initial = el.checked; break;
    case 'node-end': {
      const n = d.nodes[ni];
      if (el.checked && n.options.length > 0) {
        if (!window.confirm('结局节点不能携带选项，勾选将清空该节点的全部选项，确定？')) {
          el.checked = false;
          return;
        }
        n.options = [];
      }
      n.isEnd = el.checked;
      renderEditor();
      break;
    }
    case 'opt-target': d.nodes[ni].options[oi].toNodeId = el.value; break;
    case 'cond-state': d.nodes[ni].options[oi].conditions[ti].stateId = el.value; break;
    case 'cond-value': d.nodes[ni].options[oi].conditions[ti].value = el.value === 'true'; break;
    case 'chg-state': d.nodes[ni].options[oi].changes[ti].stateId = el.value; break;
    case 'chg-value': d.nodes[ni].options[oi].changes[ti].value = el.value === 'true'; break;
    default: break;
  }
});

$('#start-select').addEventListener('change', (e) => {
  editing.draft.startNodeId = e.target.value;
  renderEditor();
});

// ====================== 保存 / 检查 / 发布 ======================

$('#editor-title').addEventListener('input', (e) => {
  if (editing) editing.draft.title = e.target.value;
});

$('#btn-save-draft').addEventListener('click', saveDraft);
$('#btn-analyze').addEventListener('click', () => runAnalyze(true));
$('#btn-publish').addEventListener('click', publish);

async function saveDraft(showOk = true) {
  // 提交前即时校验分值：必须留空或为 -10..10 的整数（服务端仍会再次裁决）
  const scoreErrors = [];
  for (const n of editing.draft.nodes) {
    for (const o of n.options || []) {
      if (o.score === null || o.score === undefined || o.score === '') continue;
      if (!Number.isInteger(o.score) || o.score < -10 || o.score > 10) {
        scoreErrors.push(`节点「${n.title || n.id}」的选项「${o.label || o.id}」分值须为 -10 至 10 的整数（留空视为 0）`);
      }
    }
  }
  if (scoreErrors.length) {
    toast(scoreErrors[0], 'err');
    renderStructuralErrors({ error: '草稿分值不合法，未保存', errors: scoreErrors.map((m) => ({ code: 'OPTION_SCORE_INVALID', message: m })) });
    return false;
  }
  try {
    const r = await api(`/api/scenarios/${editing.id}/draft`, { method: 'PUT', body: editing.draft });
    if (showOk) toast('草稿已保存', 'ok');
    renderReport(r.publishReport, { titleOnly: false });
    return true;
  } catch (err) {
    renderStructuralErrors(err.data);
    return false;
  }
}

async function runAnalyze(persistFirst) {
  try {
    const r = await api(`/api/scenarios/${editing.id}/analyze`, {
      method: 'POST',
      body: { draft: editing.draft },
    });
    renderReport(r, {});
  } catch (err) {
    renderStructuralErrors(err.data);
  }
}

async function publish() {
  // 发布前先保存草稿；结构不合法则中止
  try {
    const r = await api(`/api/scenarios/${editing.id}/draft`, { method: 'PUT', body: editing.draft });
    if (!r.publishReport.ok) {
      renderReport(r.publishReport, {});
      toast('草稿已保存，但发布检查未通过', 'err');
      return;
    }
  } catch (err) {
    renderStructuralErrors(err.data);
    toast('草稿存在结构错误，已拒绝保存与发布', 'err');
    return;
  }
  try {
    const r = await api(`/api/scenarios/${editing.id}/publish`, { method: 'POST' });
    editing.currentVersion = r.publishedVersion;
    renderReport({ ok: true, problems: [], warnings: r.warnings || [] }, {
      successNote: `已发布 v${r.publishedVersion}，内容冻结。进行中的会话仍按旧版本继续，新会话使用本版本。`,
    });
    toast(`发布成功 v${r.publishedVersion}`, 'ok');
    renderEditor();
  } catch (err) {
    if (err.data && (err.data.problems || err.data.errors)) {
      if (err.data.problems) renderReport(err.data, {});
      else renderStructuralErrors(err.data);
    } else {
      toast(err.message, 'err');
    }
  }
}

function renderStructuralErrors(data) {
  const box = $('#editor-report');
  const errors = (data && data.errors) || [];
  box.className = 'report err';
  box.innerHTML = `
    <div class="r-title">❌ 草稿校验失败，未保存（共 ${errors.length} 项）</div>
    ${errors.map((x) => {
      const loc = x.at ? `<span class="muted">[${esc(formatAt(x.at))}]</span> ` : '';
      return `<div class="problem"><span class="p-kind">${esc(x.code)}</span><div>${loc}${esc(x.message)}</div></div>`;
    }).join('') || esc(data && data.error ? data.error : '未知错误')}`;
}

function formatAt(at) {
  if (!at) return '';
  const parts = [];
  if (at.field) parts.push(at.field);
  if (at.index !== undefined) parts.push(`#${at.index}`);
  if (at.optionIndex !== undefined) parts.push(`选项#${at.optionIndex}`);
  if (at.nodeId) parts.push(`节点${at.nodeId}`);
  if (at.optionId) parts.push(`选项${at.optionId}`);
  return parts.join(' ');
}

function renderReport(report, opts = {}) {
  const box = $('#editor-report');
  if (!report) return;
  const problems = report.problems || [];
  const warnings = report.warnings || [];
  if (report.ok && problems.length === 0) {
    box.className = 'report ok';
    box.innerHTML = `
      <div class="r-title">✅ 发布检查通过${opts.successNote ? '：已发布新版本' : ''}</div>
      <div>${esc(opts.successNote || '从初态出发，所有可达的非结局节点/状态组合都有出路，且所有路径都必然抵达结局。')}</div>
      ${warnings.map((w) => `<div class="warning-item">⚠ ${esc(w.message)}</div>`).join('')}`;
    return;
  }
  box.className = 'report err';
  box.innerHTML = `
    <div class="r-title">⛔ 发布检查未通过，已拒绝发布（${problems.length} 项）</div>
    ${problems.map((p) => `
      <div class="problem">
        <span class="p-kind">${p.kind === 'DEAD_END' ? '无路可走（非结局死路）' : '可无限循环（永不抵达结局）'}</span>
        <div>${esc(p.message)}</div>
        <div class="muted" style="margin-top:4px">问题发生时状态：${(p.vertex.states || []).map((s) => `${esc(s.name)}=${s.value ? '是' : '否'}`).join('，')}</div>
        <pre>可复现路径（从初态开始）：\n${(p.reproduciblePath || []).map(esc).join('\n') || '（起点即问题节点）'}</pre>
        ${p.cycle && p.cycle.length ? `<pre class="cycle">循环段（到达上述节点后重复执行即可永远不到结局）：\n${p.cycle.map(esc).join('\n')}</pre><div class="muted">${esc(p.hint || '')}</div>` : ''}
      </div>`).join('')}
    ${warnings.map((w) => `<div class="warning-item">⚠ ${esc(w.message)}</div>`).join('')}`;
}

// ====================== 培训师端：处置覆盖报告 ======================

let coverageCtx = null; // { scenarioId, version, uncoveredOnly, data }

$('#btn-coverage-from-editor').addEventListener('click', () => {
  if (!editing) return;
  if (editing.currentVersion < 1) return toast('该情境尚未发布，暂无冻结版本可统计', 'err');
  openCoverage(editing.id, editing.currentVersion);
});

$('#btn-coverage-back').addEventListener('click', () => {
  coverageCtx = null;
  $('#trainer-coverage').hidden = true;
  $('#trainer-home').hidden = false;
  loadScenarios();
});

$('#btn-coverage-reload').addEventListener('click', () => {
  if (coverageCtx) loadCoverage();
});

$('#coverage-version').addEventListener('change', (e) => {
  if (!coverageCtx) return;
  coverageCtx.version = parseInt(e.target.value, 10);
  loadCoverage();
});

$('#coverage-filter-uncovered').addEventListener('change', (e) => {
  if (!coverageCtx) return;
  coverageCtx.uncoveredOnly = e.target.checked;
  loadCoverage();
});

async function openCoverage(scenarioId, version) {
  $('#trainer-home').hidden = true;
  $('#trainer-editor').hidden = true;
  $('#trainer-coverage').hidden = false;
  coverageCtx = { scenarioId, version, uncoveredOnly: $('#coverage-filter-uncovered').checked, data: null };
  try {
    const detail = await api(`/api/scenarios/${encodeURIComponent(scenarioId)}`);
    const sel = $('#coverage-version');
    const versions = (detail.versions || []).slice().sort((a, b) => b.version - a.version);
    sel.innerHTML = versions.map((v) => `<option value="${v.version}">v${v.version}（${fmtTime(v.created_at)}）</option>`).join('');
    sel.value = String(version);
  } catch (err) {
    toast(err.message, 'err');
  }
  await loadCoverage();
}

async function loadCoverage() {
  if (!coverageCtx) return;
  const { scenarioId, version, uncoveredOnly } = coverageCtx;
  const itemsBox = $('#coverage-items');
  const summaryBox = $('#coverage-summary');
  itemsBox.innerHTML = '<div class="muted">统计中…</div>';
  summaryBox.innerHTML = '';
  let r;
  try {
    const qs = uncoveredOnly ? '?uncovered=1' : '';
    r = await api(`/api/scenarios/${encodeURIComponent(scenarioId)}/versions/${version}/coverage${qs}`);
  } catch (err) {
    coverageCtx.data = null;
    $('#coverage-title').textContent = '处置覆盖报告';
    $('#coverage-sub').textContent = '';
    summaryBox.innerHTML = '';
    itemsBox.innerHTML = `<div class="report err"><div class="r-title">无法生成覆盖报告（${esc(err.data && err.data.errorCode || 'ERROR')}）</div><div>${esc(err.message)}</div></div>`;
    return;
  }
  coverageCtx.data = r;
  $('#coverage-title').textContent = `📊 ${r.scenarioTitle} · v${r.version} 处置覆盖报告`;
  $('#coverage-sub').textContent = `冻结于 ${fmtTime(r.versionPublishedAt)}`;

  const t = r.totals;
  const pct = t.total ? Math.round((t.covered / t.total) * 1000) / 10 : 0;
  summaryBox.innerHTML = `
    <div class="coverage-stat-grid">
      <div class="cov-stat"><div class="cov-num">${t.total}</div><div class="muted">覆盖项总数</div></div>
      <div class="cov-stat covered"><div class="cov-num">${t.covered}</div><div class="muted">已覆盖（${pct}%）</div></div>
      <div class="cov-stat uncovered"><div class="cov-num">${t.uncovered}</div><div class="muted">未覆盖</div></div>
      <div class="cov-stat"><div class="cov-num">${t.sessionsConsidered}</div><div class="muted">绑定本版本的会话</div></div>
      <div class="cov-stat"><div class="cov-num">${t.familiesConsidered}</div><div class="muted">演练家族（原始+分支）</div></div>
    </div>
    <div class="report ${t.uncovered ? 'warn' : 'ok'}">
      ${t.uncovered
        ? `还有 <b>${t.uncovered}</b> 个「节点 × 进入状态 × 选项」组合从未被任何演练家族选到，勾选右上角“只看未覆盖项”可聚焦查漏。`
        : '所有可达处置组合都已被至少一个演练家族覆盖。'}
    </div>`;
  renderCoverageItems(r);
}

function renderCoverageItems(r) {
  const box = $('#coverage-items');
  const items = r.items;
  if (!items.length) {
    box.innerHTML = '<div class="muted">没有符合筛选条件的覆盖项。</div>';
    return;
  }
  box.innerHTML = `
    <table class="cov-table">
      <thead><tr><th style="width:46px">状态</th><th>进入时现场状态</th><th>节点</th><th>可选选项（处置）</th><th style="width:110px">覆盖家族数</th></tr></thead>
      <tbody>
        ${items.map((it) => {
          const stateName = new Map((it.entryStates || []).map((s) => [s.id, s.name]));
          return `
          <tr class="${it.covered ? '' : 'cov-uncovered'}">
            <td>${it.covered ? '<span class="cov-tag yes">已覆盖</span>' : '<span class="cov-tag no">未覆盖</span>'}</td>
            <td class="cov-states">${(it.entryStates || []).map((s) =>
              `<span class="mini-state ${s.value ? 'yes' : 'no'}">${esc(s.name)}=${s.value ? '是' : '否'}</span>`).join(' ')}</td>
            <td><b>${esc(it.nodeTitle)}</b><div class="muted">${esc(it.nodeId)}</div></td>
            <td>
              「${esc(it.option.label)}」<span class="muted">→ ${esc(it.option.toNodeTitle)}</span>
              ${it.option.conditions && it.option.conditions.length
                ? `<div class="muted">可选条件：${it.option.conditions.map((c) =>
                    `${esc(stateName.get(c.stateId) || c.stateId)}=${c.value ? '是' : '否'}`).join('；')}</div>` : ''}
            </td>
            <td class="cov-count ${it.coveredFamilies ? 'has' : ''}">
              <b>${it.coveredFamilies}</b>
              ${it.familyCodes && it.familyCodes.length
                ? `<div class="muted" title="贡献覆盖的家族根会话码">${it.familyCodes.slice(0, 3).map((c) => `<code>${esc(c)}</code>`).join(' ')}${it.familyCodes.length > 3 ? ` +${it.familyCodes.length - 3}` : ''}</div>`
                : '<div class="muted">尚无家族练到</div>'}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ====================== 初始化 ======================

loadPublished().catch((e) => toast(e.message, 'err'));
loadSessionList().catch(() => {});
