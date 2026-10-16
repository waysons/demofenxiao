# demofenxiao 市场排序与节点编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在静态模拟站 demofenxiao 中对齐后端成团门槛与团长定义，并支持同级市场重排、节点仅标记/模拟入团与购买时间编辑，便于演练族谱分裂与市场换位。

**Architecture:** 全部逻辑仍在内存 `Simulation` 类；`joined` / `joinedAt` / `marketMarked` 扩展用户节点；入团后对父节点调用 `sortMarketSiblings` 重排真人席位；成团改为「满 7 + 直推 ≥ 2」首次同时满足；UI 在侧栏「节点运营」操作标记与入团。不改 `YUANHE_express`。

**Tech Stack:** 原生 ES5-ish JS（浏览器 + `node:test`/`vm` 加载同一 engine）、HTML/CSS、无构建。

**Spec:** [`docs/2026-10-17-market-sort-sim-design.md`](../2026-10-17-market-sort-sim-design.md)

## Global Constraints

- 范围：仅 `outputs/demofenxiao`；禁止改 `YUANHE_express`
- 市场排序：有裂变（名下 ≥1 已入团真人）优先；同档 `joinedAt` 新→旧；再同 id 升序
- 成团：`groupProgress >= 7 && realDirectCount >= 2`；允许先满 7 后补第 2 直推补发
- 团长：`realChildren`（已入团真人）≥ 3，与是否七人成团无关
- 仅标记：不发佣金、不占 L/R、不进七人计数；模拟购买入团才结算
- 日常路径不冲正旧流水；删除分支重放仍保留为演练能力
- 金额：`PRICE = 19900` 分；测试命令：`node --test tests/*.test.cjs`

## File map

| File | Responsibility |
|------|----------------|
| `assets/simulation-engine.js` | 规则、席位、结算、标记/入团 API |
| `assets/simulation-ui.js` | 侧栏节点运营、树角标、邀请可选仅标记 |
| `index.html` | 表单控件与规则文案 |
| `assets/styles.css` | 「标记」角标样式 |
| `README.md` | 规则摘要 |
| `tests/reentry.test.cjs` | 单链不成团 / 补发 / 滑落 |
| `tests/peer-management.test.cjs` | 团长仅直推 3 |
| `tests/market-sort.test.cjs` | 新建：B3 挤到 L |
| `tests/node-ops.test.cjs` | 新建：仅标记 / 改时间 / 入团 |

---

### Task 1: 成团须直推 ≥ 2 + 团长仅直推 ≥ 3

**Files:**
- Modify: `assets/simulation-engine.js`（`role`、`settleGroup`、`describeNextInvite`、`groupMemberIds` 若需跳过未入团）
- Modify: `tests/reentry.test.cjs`
- Modify: `tests/peer-management.test.cjs`（断言团长时机若因定义变化失败则改期望）

**Interfaces:**
- Produces: `isGroupComplete(id) => boolean`；`role(id)` 不再要求七人满；`settleGroup` 按「首次同时满足」发奖

- [ ] **Step 1: 写失败测试（单链不成团 + 第 2 直推补发）**

把 `tests/reentry.test.cjs` 中「单链凑满七人后再滑落…」整段替换为：

```js
test('单链满 7 不成团；补第 2 直推后发拼团奖并滑落', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  let parent = 'A1';
  for (let i = 1; i <= 5; i++) {
    const id = 'B' + i;
    sim.addUser(parent, id);
    parent = id;
  }
  assert.ok(sim.groupProgress('张三') >= 7);
  assert.equal(sim.get('张三').groupAwarded, false);
  assert.equal(sim.get('张三').wallet.group, 0);
  assert.equal([...sim.users.values()].filter(u => u.reentry).length, 0);

  const second = sim.addUser('张三', 'A2');
  assert.equal(sim.get('张三').groupAwarded, true);
  assert.equal(amount(second, '张三', 'group'), 2985);
  assert.deepEqual([...second.reentryIds], ['张三:2']);
  assert.ok(sim.get('张三:2')?.reentry);
});
```

另在同文件或 `peer-management.test.cjs` 增加：

```js
test('直推满 3 人即为团长，无需自身七人成团', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  assert.equal(sim.role('张三'), '普通');
  sim.addUser('张三', 'A3');
  assert.equal(sim.role('张三'), '团长');
  assert.ok(sim.groupProgress('张三') < 7);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd outputs/demofenxiao && node --test tests/reentry.test.cjs tests/peer-management.test.cjs`

Expected: 新用例 FAIL（当前单链仍会 `groupAwarded`；团长仍要七人满）

- [ ] **Step 3: 改 engine**

在 `simulation-engine.js`：

1. `makeUser` 增加字段（根节点 `joined: false`，其余由入团路径置位）：

```js
joined: false,
joinedAt: null,
marketMarked: false,
marketMarkedAt: null,
```

根在 `constructor` 里保持 `joined: false`（教学根）。`addUser` / `addReentry` 成功后设 `user.joined = true`；`joinedAt` 默认 `Date.now()`（Task 3 再支持自定义）。

2. `realChildren` 只返回已入团真人：

```js
realChildren(id) {
  const user = this.get(id);
  return user
    ? user.children.filter(childId => {
        const child = this.get(childId);
        return child && !child.reentry && child.joined;
      })
    : [];
}
```

3. `role`：

```js
role(id) {
  const user = this.get(id);
  if (!user) return '普通';
  if (user.reentry) return '复投';
  return this.realChildren(id).length >= 3 ? '团长' : '普通';
}
```

4. 新增并导出给测试可用（类方法即可）：

```js
isGroupComplete(id) {
  const user = this.get(id);
  if (!user || user.reentry || !user.joined) return false;
  return this.groupProgress(id) >= 7 && this.realChildren(id).length >= 2;
}
```

注意：根未 `joined` 时，若仍要能开团，将根在首次有直推结算时视为可成团候选——保持现有行为：根虽 `joined: false`，但 `groupMemberIds` / `settleGroup` 仍把根放进 candidates。为此：`isGroupComplete` 对根放宽 `!user.joined` 限制，或构造时给根 `joined: true` 且 `spent: 0`。**选定：根 `joined: true`、`joinedAt: 0`、`spent: 0`，表示教学顶点已在网，无 199 支出。**

5. `settleGroup` 改为首次同时满足（对齐后端补发）：

```js
settleGroup(candidates, progressBefore, pay, sourceId) {
  const completed = [];
  const groupBonus = this.percentCents(REWARD_RATES.group);
  for (const candidate of candidates) {
    if (candidate.reentry || candidate.groupAwarded) continue;
    if (!this.isGroupComplete(candidate.id)) continue;
    candidate.groupAwarded = true;
    candidate.groupBonusCents = groupBonus;
    completed.push(candidate.id);
    pay(candidate, 'group', groupBonus, '首次完成七人团 · 实付 × 15%', sourceId);
  }
  return completed;
}
```

（`progressBefore` 可保留参数以免改调用点，但不再用「跨过 7」判断。）

6. 更新 `describeNextInvite` 文案中「满 7 人发一次」→「满 7 人且直推满 2 人发一次」；团长句改为「真人直推满 3 人即为团长（与是否七人成团无关）」。

7. `addUser` 末尾：`user.joined = true; if (user.joinedAt == null) user.joinedAt = Date.now();`  
   `addReentry`：`user.joined = true; user.joinedAt = Date.now();`

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/*.test.cjs`  
Expected: 全部 PASS（若 peer 里「第三人成团长」依赖七人满，按新定义改断言：直推到 3 即团长）

- [ ] **Step 5: Commit**

```bash
git add assets/simulation-engine.js tests/reentry.test.cjs tests/peer-management.test.cjs
git commit -m "fix(sim): 成团须直推满 2，团长仅看直推满 3"
```

---

### Task 2: 同级市场重排 sortMarketSiblings

**Files:**
- Modify: `assets/simulation-engine.js`（`placeChild` 后、`sortMarketSiblings`、`hasFission`）
- Create: `tests/market-sort.test.cjs`

**Interfaces:**
- Consumes: `joined` / `joinedAt` / `realChildren`（Task 1）
- Produces: `hasFission(id) => boolean`；`sortMarketSiblings(parentId) => void`；`addUser` 在 `placeChild` 后对 referrer 及买家祖先链上每个父节点调用重排（至少对 `referrerId`；买家入团后其上级的兄弟序也可能因「裂变」变化——**对 `referrerId` 调用一次；再对 `user.id` 的父不需要。裂变发生在 B3 下加人时，应 `sortMarketSiblings(B3.referrerId)` 即 A**）

- [ ] **Step 1: 写失败测试**

`tests/market-sort.test.cjs`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '../assets/simulation-engine.js'), 'utf8') +
    '\nthis.Simulation = Simulation;',
  context
);
const fresh = () => new context.Simulation();

test('仅 B3 裂变时，B3 排到左位，B1/B2 后移', () => {
  const sim = fresh();
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addUser('张三', 'B3');
  assert.deepEqual(sim.realChildren('张三'), ['B1', 'B2', 'B3']);
  sim.addUser('B3', 'C1');
  assert.deepEqual(sim.realChildren('张三'), ['B3', 'B1', 'B2']);
  assert.equal(sim.get('张三').children.indexOf('B3'), 0);
});

test('同档都无裂变时按 joinedAt 新→旧', () => {
  const sim = fresh();
  const o1 = sim.addUser('张三', 'B1');
  const o2 = sim.addUser('张三', 'B2');
  sim.get('B1').joinedAt = 1000;
  sim.get('B2').joinedAt = 2000;
  sim.sortMarketSiblings('张三');
  assert.deepEqual(sim.realChildren('张三'), ['B2', 'B1']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/market-sort.test.cjs`  
Expected: FAIL（仍为邀请序 B1,B2,B3）

- [ ] **Step 3: 实现重排**

```js
hasFission(id) {
  return this.realChildren(id).length > 0;
}

sortMarketSiblings(parentId) {
  const parent = this.get(parentId);
  if (!parent) return;
  const real = parent.children.filter(id => {
    const c = this.get(id);
    return c && !c.reentry && c.joined;
  });
  const slides = parent.children.filter(id => this.get(id)?.reentry);
  real.sort((a, b) => {
    const fa = this.hasFission(a) ? 1 : 0;
    const fb = this.hasFission(b) ? 1 : 0;
    if (fb !== fa) return fb - fa;
    const ta = this.get(a).joinedAt || 0;
    const tb = this.get(b).joinedAt || 0;
    if (tb !== ta) return tb - ta;
    return String(a).localeCompare(String(b));
  });
  parent.children = [...real, ...slides];
}
```

在 `addUser` 中：`this.placeChild(referrer, id);` 之后：

```js
this.sortMarketSiblings(referrerId);
```

在 `addUser` 结算完、且买家可能给上级带来「裂变」时，已对 referrer 排过；当 `sim.addUser('B3','C1')` 时 `referrerId=B3`，还需：

```js
if (referrer.referrerId) this.sortMarketSiblings(referrer.referrerId);
```

（对推荐人的父重排，使 B3 在张三下前移。）

`addReentry` 的 `placeChild` 后只 `sortMarketSiblings(parent.id)`（复投不进 real 段，顺序仍真人在前）。

`setJoinedAt(id, ms)` 在 Task 3 实现时，改时间后对 `user.referrerId` 调用 `sortMarketSiblings`。

直推奖备注里的 `position`：在 `placeChild` + **第一次** `sortMarketSiblings(referrerId)` 之后再算：

```js
const position = this.realChildren(referrerId).indexOf(id) + 1;
```

（不要再用 `previousDirectCount + 1` 作为最终 position；订单奖「从 1 增至 2」仍用入团**前**的 `previousDirectCount === 1`。）

- [ ] **Step 4: 跑测试**

Run: `node --test tests/*.test.cjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add assets/simulation-engine.js tests/market-sort.test.cjs
git commit -m "feat(sim): 同级按裂变与入团时间做市场重排"
```

---

### Task 3: 仅标记 / 模拟入团 / 改购买时间 API

**Files:**
- Modify: `assets/simulation-engine.js`
- Create: `tests/node-ops.test.cjs`

**Interfaces:**
- Produces:
  - `addMarkedUser(referrerId, requestedId='') => user` — `joined:false`，`marketMarked:true`，**不**入 `children`，挂 `parent.markedChildren` 数组
  - `clearMarketMark(id) => user`
  - `joinMarkedUser(id, joinedAtMs?) => order` — 要求已标记未入团；转入 `placeChild` + 全套结算（复用 `addUser` 内部或抽 `settleJoin`）
  - `setJoinedAt(id, ms) => user` — 已入团可改；触发 `sortMarketSiblings(referrerId)`；不重发奖
  - `addUser(referrerId, requestedId, options?: { joinedAt })` — 可选时间

实现建议：`makeUser` 增加 `markedChildren: []`。树渲染时合并 `children` 与 `markedChildren`。

`joinMarkedUser` 最小实现：从 `markedChildren` 移除，调用与 `addUser` 相同结算（可把 `addUser` 拆成「创建节点」+「settleNewMember」）。若拆分成本高：删除标记节点后 `addUser(referrer, sameId)` 并写 `joinedAt`（注意 nameCounters）。

- [ ] **Step 1: 失败测试**

```js
test('仅标记不占席位不发奖', () => {
  const sim = fresh();
  const marked = sim.addMarkedUser('张三', 'M1');
  assert.equal(marked.marketMarked, true);
  assert.equal(marked.joined, false);
  assert.deepEqual(sim.realChildren('张三'), []);
  assert.equal(sim.orders.length, 0);
  assert.equal(sim.get('张三').wallet.direct, 0);
});

test('标记后模拟入团发直推奖', () => {
  const sim = fresh();
  sim.addMarkedUser('张三', 'M1');
  const order = sim.joinMarkedUser('M1', 5000);
  assert.equal(sim.get('M1').joined, true);
  assert.equal(sim.get('M1').joinedAt, 5000);
  assert.equal(order.cents, 19900);
  assert.equal(sim.get('张三').wallet.direct, 3980);
});

test('改 joinedAt 触发重排但不改旧钱包', () => {
  const sim = fresh();
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  const before = sim.get('张三').wallet.direct;
  sim.get('B1').joinedAt = 100;
  sim.get('B2').joinedAt = 200;
  sim.setJoinedAt('B1', 300);
  assert.deepEqual(sim.realChildren('张三'), ['B1', 'B2']);
  assert.equal(sim.get('张三').wallet.direct, before);
});
```

- [ ] **Step 2: 跑测 FAIL → Step 3 实现 → Step 4 PASS → Step 5 Commit**

```bash
git add assets/simulation-engine.js tests/node-ops.test.cjs
git commit -m "feat(sim): 节点仅标记、模拟入团与购买时间"
```

---

### Task 4: 侧栏节点运营 UI + 文案

**Files:**
- Modify: `index.html`
- Modify: `assets/simulation-ui.js`
- Modify: `assets/styles.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 3 全部 API；已有 `setAgentLevel`

- [ ] **Step 1: HTML 在代理等级下方增加节点运营区**

在 `#agent-level` 所在块后插入：

```html
<div id="node-ops" class="rounded-xl border border-slate-700/50 p-3.5 mb-4 space-y-3" aria-label="节点运营">
  <div class="flex items-center justify-between">
    <p class="text-xs text-slate-300 font-medium">节点运营</p>
    <span class="text-[10px] text-slate-500">模拟族谱 · 不改后端</span>
  </div>
  <label for="node-joined-at" class="block text-[11px] muted">购买 / 入团时间</label>
  <input id="node-joined-at" type="datetime-local" class="field text-xs" />
  <div class="flex flex-wrap gap-2">
    <button type="button" id="node-save-time" class="secondary text-[10px] !py-1.5">保存时间</button>
    <button type="button" id="node-mark" class="secondary text-[10px] !py-1.5">仅标记已购</button>
    <button type="button" id="node-unmark" class="secondary text-[10px] !py-1.5">取消标记</button>
    <button type="button" id="node-join" class="primary text-[10px] !py-1.5">模拟购买入团</button>
  </div>
  <p id="node-ops-hint" class="text-[10px] muted leading-relaxed"></p>
</div>
```

邀请弹窗增加可选：

```html
<label class="flex items-center gap-2 text-xs text-slate-300 mt-4">
  <input type="checkbox" id="invite-mark-only" />
  仅标记（不模拟支付 199，不占左右位）
</label>
```

- [ ] **Step 2: UI 绑定**

在 `simulation-ui.js` 的 `renderUser`：根据 `reentry` / `joined` / `marketMarked` 禁用按钮；填充 `datetime-local`（从 `joinedAt` 或 `marketMarkedAt`）。

事件：

- `#node-save-time` → `sim.setJoinedAt` 或写 `marketMarkedAt`
- `#node-mark` → 若无节点则不可；对当前选中：若尚未存在用 `addMarkedUser` 不合理；**标记当前未入团节点**或对已存在用户 `user.marketMarked=true`。规范：选中推荐人后点「仅标记」应打开邀请并勾选 mark-only，或对**当前选中的未入团标记候选**。更简单：邀请勾选仅标记 → `addMarkedUser`；侧栏「仅标记」若当前用户已 joined 则只打标展示（`marketMarked` 附加角标，仍保持 joined）。按 spec：**仅标记**用于未结算占位 → 侧栏按钮在选中根/真人时 `addMarkedUser(selectedId)` 弹名或自动 `nextName`。

实现选定：

```js
$('node-mark').onclick = () => {
  const id = sim.addMarkedUser(state.selectedId).id;
  selectUser(id);
  showToast(id + ' 已仅标记（未入团）');
  refresh();
};
$('node-join').onclick = () => {
  const at = parseDatetimeLocal($('node-joined-at').value);
  sim.joinMarkedUser(state.selectedId, at);
  refresh();
};
```

树节点：`marketMarked && !joined` 显示角标「标记」；class `node-marked`。

邀请 submit：若 `#invite-mark-only` checked → `addMarkedUser`，否则 `addUser`。

- [ ] **Step 3: 文案同步**

替换 `index.html` / `README.md` 中：

- 「邀请顺序不换位 / 席位不自动换位」→ 「席位按市场动态：有裂变优先，同档入团时间新→旧；新单按当前席位结算，已记流水不回改；删除分支重放除外」
- 成团：「满 7 人且真人直推满 2」
- 团长：「真人直推满 3 即可，与是否七人成团无关」
- 管理奖段落删除「只直推满 3、七人团还没满就不是团长」类冲突句；保留「双方都是团长且下级已拿拼团奖才发管理奖」

Cache-bust：`simulation-*.js?v=20261017-market`

- [ ] **Step 4: 浏览器手工验收清单**

1. 打开 `index.html`：张三邀 B1/B2/B3，仅 B3 下再邀 C1 → 树序 B3 在左  
2. 仅标记 M1 → 无订单、无直推奖、角标「标记」  
3. 对 M1 模拟入团 → 出现 199 单与直推奖  
4. 单链满 7 → 不成团；再邀第 2 直推 → 成团滑落  

- [ ] **Step 5: Commit**

```bash
git add index.html assets/simulation-ui.js assets/styles.css README.md
git commit -m "feat(sim): 节点运营 UI 与市场规则文案"
```

---

### Task 5: 全量回归与 README 定稿核对

- [ ] **Step 1:** `node --test tests/*.test.cjs` → 全部 PASS  
- [ ] **Step 2:** 对照 spec 验收表逐条勾选  
- [ ] **Step 3:** 若有遗漏文案/角标，小修后 commit `docs: 同步模拟规则说明`

---

## Spec coverage check

| Spec 项 | Task |
|---------|------|
| 成团直推 ≥ 2 / 单链补发 | 1 |
| 团长仅直推 ≥ 3 | 1 |
| 市场重排 A + 例 B3→L | 2 |
| 混合结算不冲正旧账 | 2–3（不重放钱包）；删除重放保留并 README 说明 | 4 |
| joinedAt / 仅标记 / 入团 | 3–4 |
| 代理等级（已有） | 4 沿用侧栏 |
| 成团滑落（已有，门槛变） | 1 |
| 不改 YUANHE_express | Global |

## Placeholder scan

无 TBD；API 名与测试一致：`sortMarketSiblings`、`addMarkedUser`、`joinMarkedUser`、`setJoinedAt`、`isGroupComplete`、`hasFission`。
