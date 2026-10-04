'use strict';

// 处置覆盖报告：
// 覆盖项 = 某个已发布（冻结）版本从初态可达的「节点 × 进入时现场状态 × 可选选项」组合。
// 只统计绑定该版本的会话中“已完成的选择”；同一家族（root_code 相同的原始会话与多级分支）
// 对同一覆盖项至多贡献一次（分支继承前缀因此不会被重复累计）；进行中会话只计已完成步骤；
// 其它版本的会话不混入。任何冻结内容 / 会话路径损坏都整体报错，不返回部分统计。

const {
  normalizeDraft,
  analyze,
  initialMask,
  optionAvailable,
  applyChanges,
  formatStateValues,
} = require('./scenario');

const fail = (status, errorCode, error, extra) => ({
  ok: false, status, errorCode, error, ...(extra || {}),
});

/**
 * 载入并校验冻结版本内容。
 * 版本不存在 → 404；内容 JSON / 结构损坏 → 500 VERSION_CONTENT_CORRUPT。
 * 返回 { ok, scenario, scenarioTitle }。
 */
function loadFrozenScenario(db, scenarioId, version) {
  const scRow = db.prepare('SELECT id, title FROM scenarios WHERE id = ?').get(scenarioId);
  if (!scRow) {
    return fail(404, 'SCENARIO_NOT_FOUND', `情境不存在：${scenarioId}`);
  }
  const versionRow = db.prepare('SELECT content FROM versions WHERE scenario_id = ? AND version = ?')
    .get(scenarioId, version);
  if (!versionRow) {
    return fail(404, 'VERSION_NOT_FOUND',
      `版本不存在：情境「${scRow.title}」（${scenarioId}）没有 v${version}，无法生成覆盖报告`);
  }

  let raw;
  try {
    raw = JSON.parse(versionRow.content);
  } catch (_) {
    return fail(500, 'VERSION_CONTENT_CORRUPT',
      `冻结版本 v${version} 的内容不是合法 JSON，无法生成覆盖报告（数据可能已损坏）`);
  }

  // 冻结内容应当是发布时通过校验的完整草稿；这里重新规范化并做结构校验，
  // 任何无效引用 / 矛盾条件 / 缺字段都视为冻结内容损坏，拒绝给出部分统计。
  const normalized = normalizeDraft(raw);
  if (!normalized.ok) {
    return fail(500, 'VERSION_CONTENT_CORRUPT',
      `冻结版本 v${version} 的内容结构损坏，无法生成覆盖报告：${normalized.errors[0] ? normalized.errors[0].message : '结构不合法'}`,
      { validationErrors: normalized.errors });
  }

  return { ok: true, scenario: normalized.scenario, scenarioTitle: scRow.title };
}

/**
 * 枚举覆盖项：从初态做与发布检查一致的可达性分析，每个可达顶点的每条可选边为一项。
 * 顺序确定：BFS 发现顶点的顺序；同一顶点内按选项在节点中的声明顺序。
 * 返回 Map(key -> item)，key = nodeId|stateMask|optionId。
 */
function enumerateItems(scenario) {
  const graph = analyze(scenario);
  const nodesById = new Map(scenario.nodes.map((n) => [n.id, n]));
  const items = new Map();

  for (const [key, vertex] of graph.V) {
    if (vertex.end) continue; // 结局顶点无可选边
    const node = nodesById.get(vertex.nodeId);
    if (!node) continue;
    const edgeOptionIds = new Set(vertex.edges.map((e) => e.optionId));
    for (const option of node.options) {
      if (!edgeOptionIds.has(option.id)) continue; // 该现场状态下条件不满足，不是“可选选项”
      const toNode = nodesById.get(option.toNodeId);
      const itemKey = `${vertex.nodeId}|${vertex.mask}|${option.id}`;
      items.set(itemKey, {
        nodeId: vertex.nodeId,
        nodeTitle: node.title,
        stateMask: vertex.mask,
        states: formatStateValues(scenario, vertex.mask),
        optionId: option.id,
        optionLabel: option.label,
        toNodeId: option.toNodeId,
        toNodeTitle: toNode ? toNode.title : option.toNodeId,
      });
    }
  }
  return items;
}

/**
 * 逐步复现一条会话的已完成路径，收集本会话实际做出过的覆盖项 key。
 * 复现同时充当路径完整性校验：任何一步与冻结版本推演不一致都视为会话路径损坏。
 *
 * @returns {ok:false,status,errorCode,error,reason,step} 或 {ok:true, coveredKeys:Set}
 */
function replaySession(scenario, session) {
  let pathRows;
  try {
    pathRows = JSON.parse(session.path || '[]');
  } catch (_) {
    return fail(500, 'SESSION_PATH_CORRUPT',
      `会话 ${session.code} 的路径数据不是合法 JSON`, { reason: 'PATH_JSON_INVALID' });
  }
  if (!Array.isArray(pathRows)) {
    return fail(500, 'SESSION_PATH_CORRUPT',
      `会话 ${session.code} 的路径数据结构损坏（不是数组）`, { reason: 'PATH_NOT_ARRAY' });
  }

  const nodesById = new Map(scenario.nodes.map((n) => [n.id, n]));

  // 按步号排序并严格检查 1..N 连续、不重复
  const sorted = [...pathRows].sort((a, b) => (a && a.step) - (b && b.step));
  const coveredKeys = new Set();
  let curNodeId = scenario.startNodeId;
  let curMask = initialMask(scenario);

  for (let i = 0; i < sorted.length; i++) {
    const stepNo = i + 1;
    const p = sorted[i];
    const corrupt = (reason, detail) => fail(500, 'SESSION_PATH_CORRUPT',
      `会话 ${session.code} 的路径数据损坏（第 ${stepNo} 步：${detail}），拒绝给出部分统计`,
      { reason, step: stepNo, sessionCode: session.code });

    if (!p || typeof p !== 'object') return corrupt('STEP_NOT_OBJECT', '路径项不是对象');
    if (p.step !== stepNo) {
      return corrupt('STEP_NUMBER_BROKEN', `步号不连续（期望第 ${stepNo} 步，记录为 ${p.step}）`);
    }
    if (typeof p.fromNodeId !== 'string' || typeof p.optionId !== 'string'
        || typeof p.toNodeId !== 'string' || !Number.isInteger(p.stateMask)) {
      return corrupt('STEP_FIELDS_MISSING', '缺少节点 / 选项 / 目标节点 / 状态字段');
    }
    if (p.fromNodeId !== curNodeId) {
      return corrupt('FROM_NODE_MISMATCH', `所在节点与上一步推演不一致（记录 ${p.fromNodeId}，应为 ${curNodeId}）`);
    }
    const node = nodesById.get(curNodeId);
    if (!node) return corrupt('NODE_MISSING_IN_VERSION', `节点 ${curNodeId} 在绑定版本中不存在`);
    if (node.isEnd) return corrupt('OPTION_AT_END_NODE', `结局节点 ${curNodeId} 上出现了已完成选择`);
    const option = node.options.find((o) => o.id === p.optionId);
    if (!option) {
      return corrupt('OPTION_MISSING_IN_VERSION',
        `节点「${node.title}」下不存在选项 ${p.optionId}（绑定版本内容与路径不一致）`);
    }
    if (!optionAvailable(option, curMask, scenario)) {
      return corrupt('CONDITION_NOT_SATISFIABLE',
        `第 ${stepNo} 步记录的选项「${option.label}」在当时现场状态下条件并不满足，该选择不可能发生`);
    }
    if (p.toNodeId !== option.toNodeId) {
      return corrupt('TARGET_MISMATCH',
        `选项「${option.label}」的目标节点与记录不一致（记录 ${p.toNodeId}，应为 ${option.toNodeId}）`);
    }
    const nextMask = applyChanges(option, curMask, scenario);
    if (p.stateMask !== nextMask) {
      return corrupt('STATE_MASK_MISMATCH',
        `第 ${stepNo} 步后的现场状态与选项变更推演不一致（记录掩码 ${p.stateMask}，应为 ${nextMask}）`);
    }

    // 该选择进入的覆盖项：进入节点 + 进入时（选择前）现场状态 + 所选项
    coveredKeys.add(`${curNodeId}|${curMask}|${option.id}`);
    curNodeId = option.toNodeId;
    curMask = nextMask;
  }

  // 路径复现完后，会话表的当前局面必须与推演终局一致，否则路径 / 会话状态已损坏
  if (session.current_node_id !== curNodeId) {
    return fail(500, 'SESSION_PATH_CORRUPT',
      `会话 ${session.code} 的当前节点（${session.current_node_id}）与其已完成路径推演结果（${curNodeId}）不一致，拒绝给出部分统计`,
      { reason: 'CURRENT_NODE_MISMATCH', sessionCode: session.code });
  }
  if (session.state_mask !== curMask) {
    return fail(500, 'SESSION_PATH_CORRUPT',
      `会话 ${session.code} 的当前现场状态与其已完成路径推演结果不一致，拒绝给出部分统计`,
      { reason: 'CURRENT_STATE_MISMATCH', sessionCode: session.code });
  }
  if (session.step_no !== sorted.length) {
    return fail(500, 'SESSION_PATH_CORRUPT',
      `会话 ${session.code} 的步号（${session.step_no}）与已完成路径步数（${sorted.length}）不一致，拒绝给出部分统计`,
      { reason: 'STEP_COUNT_MISMATCH', sessionCode: session.code });
  }
  const endNode = nodesById.get(curNodeId);
  const endedByPath = !!(endNode && endNode.isEnd);
  if ((session.status === 'ended') !== endedByPath) {
    return fail(500, 'SESSION_PATH_CORRUPT',
      `会话 ${session.code} 的结束状态（${session.status}）与其路径到达节点是否为结局不一致，拒绝给出部分统计`,
      { reason: 'STATUS_MISMATCH', sessionCode: session.code });
  }

  return { ok: true, coveredKeys };
}

/**
 * 生成处置覆盖报告。
 * @param db better-sqlite3 实例
 * @param params {scenarioId, version, uncoveredOnly}
 * @returns { ok:true, report } 或 { ok:false, status, errorCode, error, ... }
 */
function buildCoverageReport(db, { scenarioId, version, uncoveredOnly = false }) {
  const loaded = loadFrozenScenario(db, scenarioId, version);
  if (!loaded.ok) return loaded;
  const { scenario, scenarioTitle } = loaded;

  // 覆盖项全集（冻结版本，从初态可达）
  const itemMap = enumerateItems(scenario);

  // 只取精确绑定该 (情境, 版本) 的会话；其它版本绝不混入。
  const sessions = db.prepare(`
    SELECT code, status, current_node_id, state_mask, step_no, path,
           parent_code, fork_step_no, root_code
      FROM sessions
     WHERE scenario_id = ? AND version = ?
     ORDER BY created_at, code
  `).all(scenarioId, version);

  // 覆盖项 key -> 家族根会话码集合（同一家族多次练到同一处置只计一次）
  const familiesByItem = new Map();
  for (const key of itemMap.keys()) familiesByItem.set(key, new Set());

  let familyRootCount = 0;
  const seenRoots = new Set();

  for (const session of sessions) {
    const replayed = replaySession(scenario, session);
    if (!replayed.ok) return replayed; // 任一会话路径损坏：整体失败，不返回部分统计
    const rootCode = session.root_code || session.code;
    if (!seenRoots.has(rootCode)) { seenRoots.add(rootCode); familyRootCount += 1; }
    for (const key of replayed.coveredKeys) {
      // 只会命中本版本覆盖项（路径已按本版本复现校验）；防御性忽略未知 key
      const set = familiesByItem.get(key);
      if (set) set.add(rootCode);
    }
  }

  const items = [];
  let coveredCount = 0;
  for (const [key, base] of itemMap) {
    const familyRootCodes = [...familiesByItem.get(key)];
    const covered = familyRootCodes.length > 0;
    if (covered) coveredCount += 1;
    items.push({
      ...base,
      covered,
      familyCount: familyRootCodes.length,
      familyRootCodes,
    });
  }

  const total = items.length;
  const report = {
    scenarioId,
    scenarioTitle,
    version,
    generatedAt: new Date().toISOString(),
    scope: {
      rule: '仅统计精确绑定该冻结版本的会话中已完成的选择；同一家族（原始会话及其多级分支）对同一覆盖项至多贡献一次；进行中会话只计已完成步骤；其它版本不混入。',
      sessionCount: sessions.length,
      familyCount: familyRootCount,
    },
    summary: {
      total,
      covered: coveredCount,
      uncovered: total - coveredCount,
    },
    items: uncoveredOnly ? items.filter((it) => !it.covered) : items,
  };
  return { ok: true, report };
}

module.exports = { buildCoverageReport, loadFrozenScenario, enumerateItems, replaySession };
