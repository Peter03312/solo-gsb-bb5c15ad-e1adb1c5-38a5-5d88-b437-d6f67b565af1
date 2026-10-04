# 事故处置情境编排与演练（本地 Web 应用）

供**培训师**编排事故处置情境、供**学员**按现场状态进行处置选择的本地 Web 应用。

- 技术栈：Node.js + Express + SQLite（`better-sqlite3`）+ 原生浏览器界面（无需前端构建）
- 培训师定义：至多 **8 个布尔现场状态**、**情境节点**、带**状态条件 / 状态变更**的**选项**，并指定**起点**与**结局**
- 学员视角：展示当前情境描述、**可选项**、当前**现场状态**与**走过的路径**
- 发布前自动从初态枚举所有可达的（节点 × 状态组合）：
  - 非结局节点**不能无路可走**；
  - **不能存在可无限循环而不抵达结局的路径**；
  - 不满足则给出**可复现路径**（含每一步的状态快照，以及具体的循环段）并**拒绝发布**。
- 每次发布**冻结完整内容**为新版本：进行中的会话继续沿原版本完成，新会话使用最新版
- 每步选择必须携带**当前步号**；步号过期/重复、条件不满足、选项不存在等情况一律返回**原因和现状**，且不推进会话
- **培训师复盘分叉**：可凭「源会话码 + 分歧步号 + 所见源当前步号」，从任意历史局面创建**可继续选择的分支**；分支沿用源会话绑定的冻结版本，保留分歧步之前的路径与该步现场状态，原会话与其它分支不变；已结束会话也可从其此前的非结局步分叉（结局步不得分叉），分支还可再次分叉
- **选项评分**：培训师可为每个处置选项填写 **-10 至 10 的整数分值**与**评分说明**（留空按 0 分）；规则随版本冻结。学员每次有效选择后立即看到**本步得分、说明与累计分**；过期/重复/条件不符的选择不计分；分叉继承分歧前得分；历史会话按其绑定版本计算，旧版本无评分字段时各步按 0 分处理
- **处置覆盖报告**：培训师可针对任一**已发布冻结版本**查看覆盖情况——以该版本从初态可达的「**节点 × 进入时现场状态 × 可选选项**」组合为覆盖项，给出**总数 / 已覆盖 / 未覆盖**与逐项明细，可一键**只看未覆盖项**，方便找到学员还没练到的处置
- 草稿中的**无效引用**（不存在的状态/目标节点）与**矛盾条件**（同一状态同时要求是和否）在保存时即被拒绝；**非整数或越界分值**同样在保存时拒绝

---

## 一、一键启动（Docker Compose，推荐）

前置要求：已安装 Docker 与 Docker Compose 插件。

```bash
cd <本项目目录>
docker compose up -d --build
```

启动后访问：

> **http://localhost:8080**

健康检查地址：<http://localhost:8080/api/health>

停止 / 查看日志：

```bash
docker compose down          # 停止
docker compose logs -f       # 跟踪日志
docker compose up -d --build # 重新构建并启动
```

首次启动会自动：

1. 在 `./data/app.db` 创建 SQLite 数据库与全部表结构；
2. 写入一个**已发布的内置示例情境**「车间可燃气体泄漏初期处置」，可直接用于体验学员演练流程。

数据持久化在宿主机 `./data` 目录，删除容器不会丢数据；备份该目录即可备份全部情境与会话。

### 修改访问端口

默认占用宿主机 **8080**。改用其它端口（例如 9000）有两种方式：

```bash
# 方式一：临时环境变量
APP_PORT=9000 docker compose up -d

# 方式二：在项目根目录新建 .env 文件，写入
# APP_PORT=9000
```

随后访问 <http://localhost:9000>。

---

## 二、本地 Node 直接启动（不使用 Docker）

要求 Node.js ≥ 20（`better-sqlite3` 会在 `npm install` 时本地编译，需要 python3 / make / g++ 工具链）。

```bash
npm install
npm start
```

访问 **http://localhost:8080**。

---

## 三、配置项

| 配置 / 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | HTTP 监听端口 |
| `DB_PATH` | Docker 内 `/app/data/app.db`；本地运行时 `./data/app.db` | SQLite 数据库文件路径，所在目录会自动创建 |
| `APP_PORT`（仅 Compose） | `8080` | 宿主机映射端口，改它即可，无需改 Dockerfile |
| `TZ` | `Asia/Shanghai` | 容器时区（影响时间显示） |

数据库表：`scenarios`（情境及草稿）、`versions`（每次发布冻结的完整内容）、`sessions`（学员会话：步号、状态位掩码、已走路径、绑定版本，以及复盘分叉溯源列 `parent_code` / `fork_step_no` / `root_code`）。

---

## 四、使用说明

### 培训师（页面顶部“培训师编排”页）

1. **新建情境**：系统生成一个可直接编辑的最小模板。
2. 右侧维护**现场状态**（1–8 个布尔量，各自指定初始值）。
3. 中间维护**节点**：标题、情境描述；勾选“结局节点”标记结局；在顶部“起点”下拉中指定起点（至少一个结局）。
4. 非结局节点下添加**选项**：
   - **显示条件**：列出对状态的“要求为是/否”，全部满足时该选项才可选；
   - **状态变更**：选择后把若干状态“置为是/否”；
   - **跳转**：选择后进入的目标节点；
   - **评分**：填写 **-10 至 10 的整数分值**与**评分说明**。
     - 分值留空（或显式 0）视为 **0 分**；正确、关键的处置可给正分，违章/危险动作给负分；
     - 保存草稿时若分值不是整数或超出 -10..10（如 `3.5`、`11`、`"5"`）会返回 `OPTION_SCORE_INVALID` 并拒绝保存；评分说明为可选文本（≤ 500 字，超长返回 `OPTION_SCORE_NOTE_TOO_LONG`）；
     - 分值与说明随**发布版本冻结**：之后改分只影响新版本会话，进行中的会话仍按其绑定版本计分；
     - 学员在**选择前看不到分值与说明**（避免提前“照分作答”），仅在每次**有效选择后**展示本步得分、评分说明与当前累计分；过期/重复/条件不符的选择不推进、不计分。
5. 常用操作：
   - **保存草稿**：先做结构校验（无效引用、矛盾条件等直接拒绝，不写库），同时返回一份发布预检报告；
   - **发布前检查**：只检查不保存，查看死路/无限循环的可复现路径；
   - **发布新版本**：完整检查通过后，把当前草稿冻结为 `v+1`。已有进行中的会话不受影响，新会话走新版本。
6. 删除仍被选项条件/变更引用的状态时，界面会拦截并提示引用位置。
7. **处置覆盖报告**（“我的情境”卡片上的「📊 处置覆盖报告」，或编辑器顶部同名按钮）：
   - 先在右上角选择要查看的**冻结版本**（默认最新发布版）；
   - 顶部展示**覆盖项总数、已覆盖数、未覆盖数**，以及纳入统计的会话数/演练家族数；
   - 明细表逐行给出**进入时现场状态、所在节点、可选选项（处置动作）与覆盖家族数**（未覆盖项红色高亮，并列出贡献覆盖的家族根会话码）；
   - 勾选「**只看未覆盖项**」可快速聚焦学员还没练到的处置组合；
   - 统计严格以该冻结版本为准：版本不存在、冻结内容或任一会话路径损坏时页面明确报错，且不展示部分统计。

### 处置覆盖报告的统计口径

- **覆盖项**：对所选冻结版本，复用发布前的状态空间枚举，从「起点 + 初始状态」出发，取每个**可达的非结局局面**（节点 + 进入时现场状态）下**条件满足、确实可选的每个选项**，组成一个覆盖项；结局局面没有可选项，不计入。
- **只按已完成选择统计**：覆盖来自会话 `path` 中已提交成功的步骤；**进行中会话只计已完成步骤**，其当前停留、尚未提交的局面不计。
- **按演练家族去重**：同一 `root_code` 家族（原始会话与其全部多级分支）对同一覆盖项**至多贡献一次**。分支从源会话继承的路径前缀因此**不会被重复累计**；家族内任一会话（含多级分支的分支）练到过即算该家族覆盖，明细中的“覆盖家族数”是去重后的家族数，不是会话数。
- **版本隔离**：只统计 `scenario_id + version` 完全匹配本冻结版本的会话；更旧/更新版本的会话**不混入**，发布新版本不改变历史版本的报告。
- **全有或全无**：冻结版本 JSON 无法解析、结构损坏（无效引用等）、不再满足发布时的可达性不变量（死路/可无限循环），或任一会话的已存路径与该版本冻结规则严格重放不一致（步号、节点、选项、条件、状态掩码、结局状态对不上）时，返回 `VERSION_CONTENT_CORRUPT` / `SESSION_PATH_CORRUPT` 等明确错误，**不返回部分统计**。

### 学员（“学员演练”页）

1. 在“可演练情境”中选择已发布情境，可填写姓名后**开始新演练**（自动绑定最新发布版）；
2. 阅读当前情境，在右侧查看**现场状态**，从卡片中选择处置动作；
3. 条件不满足的选项会以 🔒 灰显并说明缺哪个条件；即使强行提交，服务端也会拒绝并返回原因与现状；
4. 右侧“已走路径”逐步记录：第几步、在哪个节点、选了什么、到达哪里、当时状态，以及**该步得分徽章与评分说明**；
5. 每次**有效选择**后页面顶部提示**本步得分、评分说明与当前累计分**，会话栏常驻显示累计分；到达结局后横幅给出总分；
6. 可凭 **10 位会话码** 或下方列表随时“继续”未完成的演练；到达结局后会话结束。
   - 过期步号、重复提交、条件不满足、选项不存在等无效选择一律**不推进、不计分**（返回原因与现状，成绩维持原值）；
   - 成绩完全按会话**绑定版本**的冻结规则与已完成路径计算：改分重发新版本不影响老会话；早于评分功能的旧版本没有分值字段时，各步一律按 0 分处理。

### 培训师复盘分叉（会话页右侧）

演练结束（或进行中）后，培训师可从某个**历史局面**另开一条分支，演练“当时如果换个选择会怎样”：

1. 凭 **10 位会话码** 打开源会话（已结局的会话也可以，从会话列表点「🌿 分叉」会直接定位到分叉面板）；
2. 在右侧「🌿 复盘分叉」卡片选择**分歧步号**（下拉列出第 0 步到当前步各自所在节点，**结局步禁选**），可填一个分支备注名；
3. 点「从此步创建分支」：系统生成一个**新会话码**，其
   - **冻结版本沿用源会话**（不跟随最新发布版，保证历史局面可精确复现）；
   - 保留**分歧步之前已完成的路径**与**该步现场状态**（第 0 步即该版本初态，路径为空）；
   - **继承截至分歧步已完成路径的得分**（响应中的 `inheritedScore`，即新会话的初始累计分），第 0 步分叉继承 0 分；
   - 当前步号 = 分歧步号，状态为「进行中」，可直接在该局面继续选择；
4. 后续选择**只推进分支、只计分支自己的得分**：源会话与其它分支的成绩和路径都不受影响，各自步号与版本绑定校验照旧（步号过期仍返回 `STEP_STALE`）；
5. **分支可以再次分叉**：打开任一分支，重复上述操作即可形成多级家族树；每次分叉都继承当时已完成路径的得分；
6. 「来源与分支对照」卡片以树状展示同一家族的**原始会话与全部分支**：每个节点标明来源会话、分歧步、当前节点/步数、状态、**会话总分**，并可展开各自的**完整后续路径**（每步带**逐步得分徽章与评分说明**）供横向对照；点击会话码即可跳转。

创建时以下情况会**说明原因、不创建分支**，且只要能定位到源会话就一并返回其**当前步号**（`sourceCurrent.stepNo`）：

| 情况 | HTTP / 错误码 |
| --- | --- |
| 所见源当前步号与服务端不一致（源会话已被推进/页面过期） | `409 STEP_STALE` |
| 分歧步号越界（`<0` 或 `> 源当前步号`） | `409 FORK_STEP_OUT_OF_RANGE` |
| 分歧点是结局步 | `409 FORK_AT_END_STEP` |
| 源会话不存在 | `404 SESSION_NOT_FOUND` |
| 源绑定的冻结版本内容缺失 | `500 VERSION_MISSING`（同样返回源当前步号） |
| 缺少/非法的 `forkStepNo`、`observedStepNo` | `400` |

---

## 五、发布检查规则（核心）

系统把每个可达局面表示为 `(节点, 状态组合)`，从 `(起点, 初始状态)` 出发做完整状态空间枚举（至多 8 个布尔状态，组合数 ≤ 256 × 节点数）：

1. **无路可走（死路）**：某个可达的非结局局面下没有任何条件满足的选项 → 拒绝发布，并给出从初态到该局面的逐步路径。
2. **可无限循环**：采用“安全局面”收缩判定 —— 结局是安全的；一个非结局局面，当且仅当它存在可选边**且所有**可选边都通向安全局面时才安全。收缩后仍不安全的可达局面即可能被学员无限走下去而永不抵达结局 → 拒绝发布，报告中给出：
   - 从初态到达该局面的**可复现路径**；
   - 从该局面出发的**具体循环段**（重复执行其中的选择即可永不抵达结局）。
3. **不可达节点**只作为警告，不阻止发布。

结构问题（独立于发布检查，**保存草稿时**即拒绝）：状态数量不在 1–8、id 非法/重复、标题为空、起点不存在、无结局、选项目标节点不存在、条件/变更引用不存在的状态、同一选项对同一状态同时要求“是”和“否”、结局节点携带选项等。

### 会话推进规则

每步请求必须带 `stepNo`（当前步号，从 0 开始）：

- `stepNo` 与服务端当前步号不一致（过期页面、重复提交、并发双击）→ `409 STEP_STALE`，返回现状，不推进；
- 条件不满足 → `409 CONDITION_NOT_MET`，逐条列出哪个状态需要是/否，返回现状，不推进；
- 选项不属于当前节点 → `400 OPTION_NOT_FOUND`；会话已结束 → `409 SESSION_ENDED`。

**计分规则**：只有成功推进的有效选择计分（取该选项在**会话绑定冻结版本**中的 `score`，无该字段时按 0），累加到 `totalScore`，并在响应中通过 `lastMove` 返回本步得分与说明；任何上述失败都不改变成绩，返回现状中的 `totalScore` 为当前累计分。历史会话（含分支）的成绩始终由“绑定版本规则 + 已完成路径”实时计算，版本重发、改分均不影响已冻结的旧会话。

---

## 六、主要 HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/published` | 已发布情境列表（学员） |
| POST | `/api/sessions` | `{scenarioId, traineeName?}` 开始新会话（绑定最新版） |
| GET | `/api/sessions/:code` | 查询会话现状（可选项/状态/路径） |
| POST | `/api/sessions/:code/move` | `{optionId, stepNo}` 执行一步；失败返回原因与现状 |
| POST | `/api/sessions/:code/fork` | `{forkStepNo, observedStepNo, traineeName?}` 培训师复盘分叉，返回新分支会话快照（201） |
| GET | `/api/sessions/:code/lineage` | 来源与分支对照树（同一家族的原始会话与全部分支，含各自路径） |
| GET | `/api/sessions` | 最近会话列表（含 `parent_code` / `fork_step_no` / `root_code` 溯源字段，以及实时计算的 `total_score` 总分） |
| GET | `/api/scenarios` | 培训师情境列表 |
| POST | `/api/scenarios` | 新建（首版草稿，结构校验） |
| GET | `/api/scenarios/:id` | 草稿 + 版本清单 |
| PUT | `/api/scenarios/:id/draft` | 保存草稿（无效引用/矛盾条件拒绝） |
| POST | `/api/scenarios/:id/analyze` | 发布前检查（可带未保存草稿） |
| POST | `/api/scenarios/:id/publish` | 发布冻结新版本（检查不过返回 422 与可复现路径） |
| GET | `/api/scenarios/:id/versions/:version/coverage` | **处置覆盖报告**（可加 `?uncovered=1` 只列未覆盖项；计数始终基于全量） |

### 评分相关字段（随版本冻结，旧版本/旧会话自动按 0 分兜底）

- **草稿 / 冻结版本中的选项**新增：`score`（-10..10 整数；缺省/`null` 视为 0）、`scoreNote`（评分说明文本，可空）。保存草稿时非整数、越界或说明类型/长度不合法都会被拒绝（错误码 `OPTION_SCORE_INVALID` / `OPTION_SCORE_NOTE_INVALID` / `OPTION_SCORE_NOTE_TOO_LONG`，HTTP 400，且不写库）。
- **会话快照**（开始会话、查询、分叉、会话家族树的每个节点）新增：
  - 顶层 `totalScore`：当前会话已完成路径的累计分（按其绑定版本实时计算）；
  - `path[]` 每步新增 `score`（该步得分）与 `scoreNote`（该选项的评分说明，可能为空串）。
  - 学员选择前的 `availableOptions` / `unavailableOptions` **不包含**分值与说明。
- **`POST /api/sessions/:code/move` 成功响应**额外携带 `lastMove`：`{ step, optionId, optionLabel, score, scoreNote, totalScore }`，即本步得分、说明与得分后的累计分。校验失败（`STEP_STALE` / `CONDITION_NOT_MET` / `OPTION_NOT_FOUND` / `SESSION_ENDED` 等）不推进、不产生 `lastMove`，响应中的现状 `current.totalScore` 维持原值。
- **`POST /api/sessions/:code/fork` 成功响应**额外携带 `inheritedScore`：分支继承的、截至分歧步已完成路径的得分（等于该分支此刻的 `totalScore`；第 0 步分叉为 0）。
- **GET `/api/sessions`** 每行新增 `total_score`（沿用列表的下划线命名）。
- 以上均为**增量字段**，既有的错误码、HTTP 状态码、`current` / `sourceCurrent` 回传结构、会话查询/推进/分叉/对照接口的字段约定保持兼容。

### 评分相关 HTTP 调用示例

```bash
# 保存带分值的草稿：score 为 -10..10 整数，缺省按 0；非整数/越界返回 400
curl -s -X PUT localhost:8080/api/scenarios/<id>/draft \
  -H 'Content-Type: application/json' \
  -d '{"title":"…","states":[…],"startNodeId":"n1","nodes":[
        {"id":"n1","title":"起","narrative":"","isEnd":false,"options":[
          {"id":"o1","label":"先断电","conditions":[],"changes":[],
           "toNodeId":"n2","score":3,"scoreNote":"第一时间消除点火源"}]}],
        {"id":"n2","title":"结局","narrative":"","isEnd":true,"options":[]}]}'
# -> { "ok":true, "publishReport":{ ... } }

# 非法分值（3.5 非整数）被拒绝
# 400 { "error":"草稿校验失败，未保存",
#       "errors":[{"code":"OPTION_SCORE_INVALID","message":"选项「先断电」的分值非法：3.5（必须是 -10..10 的整数；留空视为 0）", ...}] }

# 有效选择后返回本步得分 / 说明 / 累计分
curl -s -X POST localhost:8080/api/sessions/1a2b3c4d5e/move \
  -H 'Content-Type: application/json' -d '{"optionId":"o1","stepNo":0}'
# -> { "ok":true, "stepNo":1, "totalScore":3,
#      "lastMove":{"step":1,"optionId":"o1","optionLabel":"先断电",
#                  "score":3,"scoreNote":"第一时间消除点火源","totalScore":3},
#      "path":[{"step":1, ..., "score":3, "scoreNote":"第一时间消除点火源"}], ... }

# 分叉：inheritedScore 为继承的已完成路径得分
curl -s -X POST localhost:8080/api/sessions/1a2b3c4d5e/fork \
  -H 'Content-Type: application/json' -d '{"forkStepNo":1,"observedStepNo":2}'
# -> { "ok":true, ..., "totalScore":3, "inheritedScore":3 }
```

### 复盘分叉 HTTP 调用示例

以下示例基于内置示例情境（会话码请按实际返回替换）。

```bash
# 0) 开始一个源会话并走两步（stepNo 严格携带当前步号）
curl -s localhost:8080/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"scenarioId":"<scenarioId>","traineeName":"张三"}'
# -> { "code": "1a2b3c4d5e", "version": 1, "stepNo": 0, ... }

curl -s localhost:8080/api/sessions/1a2b3c4d5e/move \
  -H 'Content-Type: application/json' -d '{"optionId":"o_cut_power","stepNo":0}'
curl -s localhost:8080/api/sessions/1a2b3c4d5e/move \
  -H 'Content-Type: application/json' -d '{"optionId":"o_evac","stepNo":1}'
# 此时源会话当前步号 = 2

# 1) 从源会话的“第 1 步”历史局面分叉：
#    forkStepNo     = 分歧步号（要回到的历史步）
#    observedStepNo = 培训师“所见的源当前步号”（乐观锁，防止基于过期局面分叉）
curl -s -X POST localhost:8080/api/sessions/1a2b3c4d5e/fork \
  -H 'Content-Type: application/json' \
  -d '{"forkStepNo":1,"observedStepNo":2,"traineeName":"复盘-换一种处置"}'
# 201 ->
# { "code":"f0e1d2c3b4", "forkStepNo":1, "forkedFrom":"1a2b3c4d5e",
#   "version":1,                       # 沿用源绑定的冻结版本
#   "stepNo":1, "status":"active",     # 位于第 1 步局面，可继续选择
#   "currentNode":{"id":"n_scene",...},
#   "path":[ {第 1 步: 断电→查明泄漏点, ...} ],   # 保留分歧步之前的路径
#   "lineage":{"rootCode":"1a2b3c4d5e","parentCode":"1a2b3c4d5e",
#              "forkStepNo":1,"isBranch":true} }

# 2) 在分支上继续选择（步号从分歧步号 1 开始；只推进分支）
curl -s localhost:8080/api/sessions/f0e1d2c3b4/move \
  -H 'Content-Type: application/json' -d '{"optionId":"o_tighten","stepNo":1}'

# 3) 分支再次分叉（从该已结局分支的第 0 步初态另走）
curl -s -X POST localhost:8080/api/sessions/f0e1d2c3b4/fork \
  -H 'Content-Type: application/json' -d '{"forkStepNo":0,"observedStepNo":2}'

# 4) 查看来源与分支对照树（任一家族成员码均可，返回同一棵树）
curl -s localhost:8080/api/sessions/1a2b3c4d5e/lineage
# -> { "rootCode":"1a2b3c4d5e", "tree":{ code, lineage, path, status, stepNo,
#                                        currentNode, children:[ ...分支... ] } }
```

典型失败响应（**不创建分支**；能定位源会话时回传其当前步号）：

```bash
# 源步号已变化（页面上看到的是第 2 步，实际源已走到第 4 步）
curl -s -X POST localhost:8080/api/sessions/1a2b3c4d5e/fork \
  -H 'Content-Type: application/json' -d '{"forkStepNo":2,"observedStepNo":2}'
# 409 { "errorCode":"STEP_STALE",
#       "error":"源会话步号已变化：你看到的是第 2 步，源会话当前为第 4 步，未创建分支…",
#       "sourceCurrent":{"code":"1a2b3c4d5e","stepNo":4},   # ← 源当前真实步号
#       "current":{ ...源会话最新现状快照... } }

# 分歧点越界
curl -s -X POST localhost:8080/api/sessions/1a2b3c4d5e/fork \
  -H 'Content-Type: application/json' -d '{"forkStepNo":99,"observedStepNo":4}'
# 409 { "errorCode":"FORK_STEP_OUT_OF_RANGE", "sourceCurrent":{"stepNo":4}, ... }

# 结局步不得分叉（已结束会话可改用其之前的非结局步）
curl -s -X POST localhost:8080/api/sessions/1a2b3c4d5e/fork \
  -H 'Content-Type: application/json' -d '{"forkStepNo":4,"observedStepNo":4}'
# 409 { "errorCode":"FORK_AT_END_STEP", "sourceCurrent":{"stepNo":4}, ... }

# 源会话不存在
# 404 { "errorCode":"SESSION_NOT_FOUND", ... }   （无法定位源，故无 sourceCurrent）
```

---

## 六之二、处置覆盖报告接口

`GET /api/scenarios/:id/versions/:version/coverage`

- `:version` 必须是已发布（已冻结）的版本号（≥1）；可加查询参数 `?uncovered=1`（或 `true`/`yes`），此时 `items` 只包含未覆盖项，但 `totals` 仍按全量覆盖项统计。
- 统计口径见上文「处置覆盖报告的统计口径」：只统计绑定该版本的会话、按家族去重、进行中只计已完成步骤、其它版本不混入、损坏即整体失败。

返回结构（节选）：

```json
{
  "ok": true,
  "scenarioId": "sc_…",
  "scenarioTitle": "示例：车间可燃气体泄漏初期处置",
  "version": 1,
  "versionPublishedAt": "2026-10-04 02:53:17",
  "totals": {
    "total": 8,            // 覆盖项总数（可达局面 × 可选项）
    "covered": 3,          // 已被至少一个家族覆盖的数量
    "uncovered": 5,        // 未覆盖数量
    "sessionsConsidered": 4,   // 绑定该版本的会话数（含进行中、零步）
    "familiesConsidered": 2,   // 演练家族数（按 root_code 去重）
    "familiesWithCoverage": 2
  },
  "items": [
    {
      "nodeId": "n_scene",
      "nodeTitle": "查明泄漏点",
      "entryStates": [ {"id":"power","name":"厂区电源已切断","value":true}, … ],
      "option": {
        "id": "o_evac", "label": "组织全员撤离至安全区并清点人数",
        "conditions": [], "changes": [ … ],
        "toNodeId": "n_command", "toNodeTitle": "安全区建立指挥点",
        "score": 4, "scoreNote": "…"
      },
      "covered": true,
      "coveredFamilies": 1,       // 覆盖该项的家族数（同家族原始/多级分支只算 1）
      "familyCodes": ["9dcaff3c20"]  // 贡献覆盖的家族根会话码
    }
  ]
}
```

调用示例：

```bash
# 查看 v1 的完整覆盖报告
curl -s localhost:8080/api/scenarios/sc_14f5505a2f47a3a3/versions/1/coverage | jq '.totals'
# -> { total: 8, covered: 0, uncovered: 8, sessionsConsidered: 0, … }

# 只取未覆盖项（totals 仍是全量计数），便于脚本驱动补练
curl -s 'localhost:8080/api/scenarios/sc_14f5505a2f47a3a3/versions/1/coverage?uncovered=1' \
  | jq '.items[] | {node: .nodeTitle, states: [.entryStates[] | select(.value).name], action: .option.label}'

# 用 Node 取报告（等价的 HTTP 调用）
node -e 'fetch("http://localhost:8080/api/scenarios/sc_14f5505a2f47a3a3/versions/1/coverage")
  .then(r=>r.json()).then(r=>console.log(`${r.totals.covered}/${r.totals.total} 已覆盖，未覆盖 ${r.totals.uncovered} 项`))'
```

错误响应（**不返回任何 items/部分统计**）：

| 情况 | HTTP / errorCode |
| --- | --- |
| 版本号不是 ≥1 的整数 | `400 VERSION_INVALID` |
| 情境不存在 | `404 SCENARIO_NOT_FOUND` |
| 该版本未发布/不存在 | `404 VERSION_NOT_FOUND` |
| 冻结内容无法解析、结构损坏或不再满足发布不变量（死路/可无限循环） | `500 VERSION_CONTENT_CORRUPT` |
| 某绑定会话的路径与冻结规则重放不一致（步号/节点/选项/条件/状态/结局对不上） | `500 SESSION_PATH_CORRUPT`（`detail.sessionCode` 指出损坏会话） |

---

## 七、目录结构

```
.
├── Dockerfile
├── docker-compose.yml
├── package.json / package-lock.json
├── server/
│   ├── server.js      # Express 路由（编排 / 发布 / 会话 / 复盘分叉 / 处置覆盖报告接口）
│   ├── db.js          # SQLite 连接、建表（含老库加列迁移）、id 生成
│   ├── scenario.js    # 草稿校验 + 状态空间可达性/死路/循环分析
│   ├── session.js     # 会话快照、“带步号的一步”推进、forkSession 分叉、loadLineage 对照树
│   ├── coverage.js    # 处置覆盖报告：覆盖项枚举 + 按家族去重的已完成路径回放（损坏整体报错）
│   └── seed.js        # 内置示例情境（首启写入）
├── public/
│   ├── index.html     # 单页界面（学员演练 / 培训师编排两个页签，编排内含处置覆盖报告视图）
│   ├── styles.css
│   └── app.js         # 含复盘分叉面板、来源/分支对照树与处置覆盖报告视图
└── data/              # 运行后生成：SQLite 数据库（持久化卷）
```

