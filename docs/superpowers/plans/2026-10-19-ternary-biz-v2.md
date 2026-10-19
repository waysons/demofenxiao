# 三三复制商业 V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 demofenxiao 模拟器中新增滑落模式 `ternary_biz_v2`：第 3 人扶持区、第 4 人起按 L/R 深度优先滑落帮扶，复投可挂点且零收益，成团后再邀不强制挂最新复投点。

**Architecture:** 全部逻辑仍在内存 `Simulation` 类。新增 `groupSlotOpen`（L/R 宽 2、DFS 先上下再左右）作为 V2 真人溢出与复投的统一找空；`usesTernaryBizV2()` 与现有 `usesTernaryBiz()` 并列；计团复用 biz 的 `countsForGroup` / `placeChild` 口径。不改后端、不改默认 `binary`。

**Tech Stack:** 原生 JS（浏览器 + `node:test`/`vm` 加载同一 engine）、HTML、无构建。

**Spec:** [`docs/superpowers/specs/2026-10-19-ternary-biz-v2-design.md`](../specs/2026-10-19-ternary-biz-v2-design.md)

## Global Constraints

- 范围：仅 `outputs/demofenxiao`；禁止改后端仓库
- 模式键：`ternary_biz_v2`；默认滑落仍为 `binary`
- 七人团：严格 **1+2+4**；扶持区不计团
- 金额：`PRICE = 19900` 分；测试：`node --test tests/*.test.cjs`
- 不改 `ternary_biz` / `ternary` / `binary` / `left` / `alternate` 既有语义
- `payOn` 已对 `recipient.reentry` 跳过入账；V2 保持该行为并加测覆盖

## File map

| File | Responsibility |
|------|----------------|
| `assets/simulation-engine.js` | `groupSlotOpen`、V2 挂点、复投可挂、计团、描述文案 |
| `tests/ternary-biz-v2.test.cjs` | V2 专用用例（新建） |
| `assets/simulation-ui.js` | badge / hint / 切换 toast |
| `index.html` | `<option>` + 规则说明一句 |
| `README.md` | 模式说明一行 |

---

### Task 1: `groupSlotOpen` + 模式开关骨架

**Files:**
- Create: `tests/ternary-biz-v2.test.cjs`
- Modify: `assets/simulation-engine.js`（`setSlideMode`、`usesTernaryBizV2`、`groupCountedChildren`、`placeChild` 条件、`groupSlotOpen`、`findSlideParent`）

**Interfaces:**
- Produces: `usesTernaryBizV2() => boolean`
- Produces: `usesBizGroupCount() => boolean`（`ternary_biz || ternary_biz_v2`，供 `groupCountedChildren` / `placeChild` / `countsForGroup` 共用）
- Produces: `groupSlotOpen(rootId) => User`（节点对象，含 `.id`）
- Consumes: 现有 `groupCountedChildren`、`get`

- [ ] **Step 1: 写失败测试（模式合法 + DFS 找空）**

新建 `tests/ternary-biz-v2.test.cjs`：

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
const fresh = (mode = 'ternary_biz_v2') => {
  const sim = new context.Simulation();
  sim.setSlideMode(mode);
  return sim;
};
const amount = (order, id, type) =>
  order.payouts.filter(p => p.userId === id && p.type === type).reduce((sum, p) => sum + p.cents, 0);

test('V2：setSlideMode 接受 ternary_biz_v2，非法值仍抛错', () => {
  const sim = fresh('binary');
  assert.equal(sim.setSlideMode('ternary_biz_v2'), 'ternary_biz_v2');
  assert.throws(() => sim.setSlideMode('ternary_biz_v3'), /滑落版本/);
});

test('V2：groupSlotOpen 优先最左支未满 L/R 的节点', () => {
  const sim = fresh();
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addUser('张三', 'B3');
  // 此时 L/R 已满，下一空位应是 B1
  const open = sim.groupSlotOpen('张三');
  assert.equal(open.id, 'B1');
  sim.addUser('B1', 'C1');
  assert.equal(sim.groupSlotOpen('张三').id, 'B1');
  sim.addUser('B1', 'C2');
  assert.equal(sim.groupSlotOpen('张三').id, 'B2');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd outputs/demofenxiao && node --test tests/ternary-biz-v2.test.cjs`

Expected: FAIL（`setSlideMode` 拒收或无 `groupSlotOpen`）

- [ ] **Step 3: 最小实现**

在 `simulation-engine.js`：

1. 注释中补充 `ternary_biz_v2`。
2. 新增：

```js
usesTernaryBizV2() {
  return this.slideMode === 'ternary_biz_v2';
}

// 纯商业 / V2：成团计数可含 countsForGroup 复投
usesBizGroupCount() {
  return this.usesTernaryBiz() || this.usesTernaryBizV2();
}
```

3. 将 `groupCountedChildren` / `placeChild` 内 `usesTernaryBiz()` 改为 `usesBizGroupCount()`。
4. `setSlideMode` 白名单加入 `'ternary_biz_v2'`。
5. 新增：

```js
// V2：L/R 宽 2，DFS 先左支向下再右（先上下、再左右）
groupSlotOpen(id) {
  const start = this.get(id);
  if (!start) throw new Error('滑落起点不存在');
  const self = this;
  function dfs(node) {
    if (!node) return null;
    const counted = self.groupCountedChildren(node.id);
    if (counted.length < 2) return node;
    for (const childId of counted.slice(0, 2)) {
      const found = dfs(self.get(childId));
      if (found) return found;
    }
    return null;
  }
  const hit = dfs(start);
  if (!hit) throw new Error('商业V2滑落未找到空位');
  return hit;
}
```

6. `findSlideParent`：

```js
if (this.slideMode === 'ternary_biz_v2') return this.groupSlotOpen(exitedId);
```

（放在 `ternary` 分支之后、`ternary_biz || left` 之前。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/ternary-biz-v2.test.cjs`

Expected: PASS（注意：Step 1 第二测若 `addUser` 尚未按 V2 挂 B3，可能需先只断言 `setSlideMode`；若第二测因挂点未实现失败，把第二测的 `addUser('张三','B3')` 改为直接手动摆树，或延到 Task 2。推荐本 Task 第二测改为手动：）

若 `addUser` 仍走非 V2 路径导致 B3 行为不对，将第二测改为：

```js
test('V2：groupSlotOpen 优先最左支未满 L/R 的节点', () => {
  const sim = fresh();
  // 手动构造：张三→B1,B2（不依赖 V2 邀请）
  sim.setSlideMode('left');
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.setSlideMode('ternary_biz_v2');
  assert.equal(sim.groupSlotOpen('张三').id, 'B1');
  sim.setSlideMode('left');
  sim.addUser('B1', 'C1');
  sim.setSlideMode('ternary_biz_v2');
  assert.equal(sim.groupSlotOpen('张三').id, 'B1');
  sim.setSlideMode('left');
  sim.addUser('B1', 'C2');
  sim.setSlideMode('ternary_biz_v2');
  assert.equal(sim.groupSlotOpen('张三').id, 'B2');
});
```

- [ ] **Step 5: Commit**

```bash
cd outputs/demofenxiao
git add assets/simulation-engine.js tests/ternary-biz-v2.test.cjs
git commit -m "$(cat <<'EOF'
feat(sim): 商业V2 模式开关与 groupSlotOpen

新增 ternary_biz_v2 与 L/R DFS 找空，供邀请溢出与复投共用。
EOF
)"
```

---

### Task 2: V2 邀请挂点（第 1–3 本人 / 第 4+ 滑落）

**Files:**
- Modify: `assets/simulation-engine.js`（`resolveInviteHost` 或 `addUser` 挂点分支、`describeNextInvite`、zone）
- Modify: `tests/ternary-biz-v2.test.cjs`

**Interfaces:**
- Consumes: `groupSlotOpen(rootId)`、`realChildren`、`inviteOrderedRealChildren`
- Produces: V2 下 `addUser` 挂点规则；`slid` 标记与 zone `binary_slide` 同类文案可用 `v2_slide` 或复用 `binary_slide`

- [ ] **Step 1: 写失败测试**

追加到 `tests/ternary-biz-v2.test.cjs`：

```js
test('V2：未成团时第 1–2 拼团区、第 3 扶持区', () => {
  const sim = fresh();
  const o1 = sim.addUser('张三', 'B1');
  const o2 = sim.addUser('张三', 'B2');
  const o3 = sim.addUser('张三', 'B3');
  assert.equal(o1.zone, 'group');
  assert.equal(o2.zone, 'group');
  assert.equal(o3.zone, 'support');
  assert.deepEqual([...sim.realChildren('张三')], ['B1', 'B2', 'B3']);
  assert.equal(sim.groupMemberIds('张三').includes('B3'), false);
  assert.equal(sim.get('B3').inviteReferrerId, '张三');
});

test('V2：第 4 人滑到 B1 的 L，直推奖仍给邀请人', () => {
  const sim = fresh();
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addUser('张三', 'B3');
  const o4 = sim.addUser('张三', 'B4');
  assert.equal(sim.get('B4').referrerId, 'B1');
  assert.equal(sim.get('B4').inviteReferrerId, '张三');
  assert.equal(sim.childSlot('B1', 'B4'), 0);
  assert.equal(amount(o4, '张三', 'direct'), 4975);
  assert.equal(amount(o4, 'B1', 'direct'), 0);
  assert.ok(o4.zone === 'binary_slide' || o4.zone === 'v2_slide' || o4.zone === 'group');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/ternary-biz-v2.test.cjs`

Expected: FAIL（B3/B4 挂点不对）

- [ ] **Step 3: 实现邀请挂点**

在 `addUser` 中，宽轨分支旁增加：

```js
} else if (this.usesTernaryBizV2()) {
  const treeCount = this.realChildren(inviteReferrerId).length;
  if (treeCount < 3) {
    host = this.get(inviteReferrerId);
    slid = false;
  } else {
    host = this.groupSlotOpen(inviteReferrerId);
    slid = host.id !== inviteReferrerId;
  }
}
```

`resolveInviteHost`：V2 **不要**走 `latestReentryId`。可改为：

```js
resolveInviteHost(inviteReferrerId) {
  const referrer = this.get(inviteReferrerId);
  if (!referrer) throw new Error('直接推荐人不存在，请重新选择。');
  if (this.usesTernaryBiz()) {
    const reentryId = this.latestReentryId(inviteReferrerId);
    const nextPos = this.inviteOrderedRealChildren(inviteReferrerId).length + 1;
    if (reentryId && nextPos >= 4) return this.get(reentryId);
  }
  // V2：预览挂点与 addUser 一致（满 3 则 groupSlotOpen）
  if (this.usesTernaryBizV2()) {
    if (this.realChildren(inviteReferrerId).length < 3) return referrer;
    return this.groupSlotOpen(inviteReferrerId);
  }
  return referrer;
}
```

zone 分支：V2 未滑落时按 `treeSlot < 2 ? 'group' : 'support'`；滑落时设 `zone = 'v2_slide'`（或 `'binary_slide'`，与 UI 展示兼容即可，测试用上面的 `ok` 断言）。

`describeNextInvite`：为 `usesTernaryBizV2()` 增加文案分支（第 3=扶持；第 4+=L/R DFS；成团复投同算法、可挂点零收益）。

`_resolveInviteId`：若 `referrer.reentry`，在 V2 下改为用 `referrer.userId` 作为邀请人（见 Task 3）；本 Task 可暂保持抛错，Task 3 再放开。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/ternary-biz-v2.test.cjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add assets/simulation-engine.js tests/ternary-biz-v2.test.cjs
git commit -m "$(cat <<'EOF'
feat(sim): 商业V2 邀请第3扶持、第4起 L/R 滑落

直推奖仍归邀请原号，树上挂点走 groupSlotOpen。
EOF
)"
```

---

### Task 3: 成团、订单奖、复投可挂点与零收益

**Files:**
- Modify: `assets/simulation-engine.js`（`addReentry` 的 `countsForGroup`、允许复投下挂、`_resolveInviteId` / `addUser` 邀请原号解析）
- Modify: `tests/ternary-biz-v2.test.cjs`

**Interfaces:**
- Consumes: `groupSlotOpen`、`usesBizGroupCount`、`payOn`（已跳过 reentry）
- Produces: V2 复投 `countsForGroup`；复投点可作 `referrerId` 挂点；从复投点发起邀请时 `inviteReferrerId = userId`

- [ ] **Step 1: 写失败测试**

```js
function formSevenV2(sim, root = '张三') {
  sim.addUser(root, 'B1');
  sim.addUser(root, 'B2');
  sim.addUser(root, 'B3');
  sim.addUser('B1', 'C1');
  sim.addUser('B1', 'C2');
  sim.addUser('B2', 'C3');
  return sim.addUser('B2', 'C4');
}

test('V2：1+2+4 成团发拼团奖；复投挂 L/R 可计团且钱包为 0', () => {
  const sim = fresh();
  const last = formSevenV2(sim);
  assert.equal(amount(last, '张三', 'group'), 3980);
  assert.equal(sim.get('张三').groupAwarded, true);
  const re = sim.get('张三:2');
  assert.ok(re?.reentry);
  assert.equal(re.countsForGroup, true);
  assert.equal(sim.income('张三:2'), 0);
  assert.equal(sim.childSlot(re.referrerId, '张三:2') < 2, true);
});

test('V2：B3 直推满 2 人时 A 拿订单奖', () => {
  const sim = fresh();
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addUser('张三', 'B3');
  sim.addUser('B3', 'D1');
  const o = sim.addUser('B3', 'D2');
  assert.equal(amount(o, '张三', 'order'), 2985);
});

test('V2：复投点下可挂真人；直推奖给邀请原号；复投无 payout', () => {
  const sim = fresh();
  formSevenV2(sim);
  const reId = '张三:2';
  assert.ok(sim.get(reId)?.reentry);
  // 从复投点发起：邀请人应记原号
  const order = sim.addUser(reId, 'X1');
  assert.equal(sim.get('X1').inviteReferrerId, '张三');
  assert.equal(sim.get('X1').referrerId, reId);
  assert.equal(amount(order, '张三', 'direct'), 4975);
  assert.equal(amount(order, reId, 'direct'), 0);
  assert.equal(sim.income(reId), 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/ternary-biz-v2.test.cjs`

Expected: FAIL（复投计团 / 挂下级 / 订单奖路径之一）

- [ ] **Step 3: 实现**

1. `addReentry`：

```js
user.countsForGroup = this.usesBizGroupCount() && this.groupCountedChildren(parent.id).length < 2;
```

并去掉或放宽：

```js
if (parent.reentry) throw new Error('复投点不能挂下级');
```

改为：仅非 V2（且非 biz 若也不需要）时禁止；**V2 允许** `parent.reentry`。建议：

```js
if (parent.reentry && !this.usesTernaryBizV2()) {
  throw new Error('复投点不能挂下级');
}
```

注意：`findSlideParent` / `groupSlotOpen` 可能返回复投点作为挂复投的 parent——若业务上复投不应挂在复投下，DFS 进入复投子树即可，但「真人挂在复投下」必须允许。`addReentry` 的 parent 若来自 `groupSlotOpen`，通常是真人；保持 `addReentry` 禁止「复投挂复投」即可：

```js
if (parent.reentry) throw new Error('复投点不能挂复投下级');
```

真人 `addUser` 挂到复投点时走 `placeChild`，不走上述检查。

2. `_resolveInviteId`：

```js
_resolveInviteId(referrerId, requestedId, nameParentId = null) {
  let referrer = this.get(referrerId);
  if (!referrer) throw new Error('直接推荐人不存在，请重新选择。');
  let inviteReferrerId = referrerId;
  if (referrer.reentry) {
    if (!this.usesTernaryBizV2()) throw new Error('复投点不能再邀请下级。');
    inviteReferrerId = referrer.userId;
    referrer = this.get(inviteReferrerId);
    if (!referrer || referrer.reentry) throw new Error('复投点原号不存在。');
  }
  // ... 其余校验用 referrer（原号），返回 { referrer, id, inviteReferrerId }
}
```

同步改 `addUser`：用返回的 `inviteReferrerId` 记邀请关系；挂点仍：

- 若调用方传入的是复投点 id：V2 下 `host` 可直接为该复投点（挂在其下），**不要**再对原号做 `groupSlotOpen` 而把人滑走。

明确规则：

```js
addUser(referrerId, requestedId = '', options = {}) {
  const clicked = this.get(referrerId);
  // V2 且点选复投点：邀请记原号，树上挂该复投点
  if (this.usesTernaryBizV2() && clicked?.reentry) {
    const inviteReferrerId = clicked.userId;
    const { referrer, id } = this._resolveInviteId(inviteReferrerId, requestedId, clicked.id);
    const host = clicked;
    // ... 后续与常规相同，previousInviteCount 用 inviteReferrerId
  }
  // 原有逻辑...
}
```

为减少分叉，也可在开头：

```js
let inviteReferrerId = referrerId;
let forcedHost = null;
const clicked = this.get(referrerId);
if (this.usesTernaryBizV2() && clicked?.reentry) {
  inviteReferrerId = clicked.userId;
  forcedHost = clicked;
}
```

然后 `_resolveInviteId(inviteReferrerId, ...)`，挂点：

```js
if (forcedHost) {
  host = forcedHost;
  slid = false;
} else if (this.usesTernaryBizV2()) {
  // Task 2 逻辑
}
```

3. `describeNextInvite`：复投点在 V2 下改为引导「将记原号邀请并挂本复投点」，或仍提示改选——与实现一致即可；推荐允许并描述清楚。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/ternary-biz-v2.test.cjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add assets/simulation-engine.js tests/ternary-biz-v2.test.cjs
git commit -m "$(cat <<'EOF'
feat(sim): 商业V2 成团复投计团、可挂点与订单奖

复投零收益保持 payOn 跳过；点选复投邀请记原号。
EOF
)"
```

---

### Task 4: 成团后再邀不强制挂复投点

**Files:**
- Modify: `tests/ternary-biz-v2.test.cjs`
- Modify: `assets/simulation-engine.js`（确认 `resolveInviteHost` / `addUser` 无 `latestReentryId` 分支残留）

**Interfaces:**
- Consumes: Task 2–3 挂点逻辑
- Produces: 成团后 `addUser(原号)` → `groupSlotOpen`，可与复投点并列存在于树上

- [ ] **Step 1: 写失败测试**

```js
test('V2：成团后再邀不强制挂最新复投点，按 groupSlotOpen', () => {
  const sim = fresh();
  formSevenV2(sim);
  const reId = sim.latestReentryId('张三');
  assert.ok(reId);
  // 复投已占某 L/R；再邀应补同一落点的另一侧或下一空位，而非「必须挂 reId」
  const order = sim.addUser('张三', 'X9');
  const hostId = sim.get('X9').referrerId;
  assert.equal(sim.get('X9').inviteReferrerId, '张三');
  // 若复投计团占了 B1 的 L，则 X9 应挂 B1（R）或其它 open，允许 hostId === reId 仅当算法选中
  assert.equal(hostId, sim.groupSlotOpen('张三').id === hostId
    ? hostId
    : hostId);
  // 更稳：挂点的成团计数在挂上前应 < 2；且不是「仅因 latestReentry 而挂」
  // 断言：X9 的 parent 在挂上后 groupCounted 包含 X9，且 invite 仍为张三
  assert.ok(sim.groupCountedChildren(hostId).includes('X9') || sim.realChildren(hostId).includes('X9'));
  // 关键：不得在「张三本人扶持区」再堆第 4+（张三 realChildren 仍为 B1,B2,B3）
  assert.equal(sim.get('张三').children.includes('X9'), false);
  assert.equal(amount(order, '张三', 'direct'), 4975);
});
```

（实现时把中间那行无意义三元删掉，只保留「不进张三 children」+ 直推给张三。）

精简版断言（以此为准）：

```js
test('V2：成团后再邀不强制挂最新复投点，按 groupSlotOpen', () => {
  const sim = fresh();
  formSevenV2(sim);
  assert.ok(sim.latestReentryId('张三'));
  const before = sim.groupSlotOpen('张三').id;
  const order = sim.addUser('张三', 'X9');
  assert.equal(sim.get('X9').referrerId, before);
  assert.equal(sim.get('X9').inviteReferrerId, '张三');
  assert.equal(sim.get('张三').children.includes('X9'), false);
  assert.equal(amount(order, '张三', 'direct'), 4975);
});
```

- [ ] **Step 2: 跑测试确认失败或已通过**

若 Task 2 已正确实现，本测可能已绿；若仍走 `ternary_biz` 的 `latestReentryId`，会 FAIL。

- [ ] **Step 3: 修残留**

确认 `usesTernaryBiz()` 与 `usesTernaryBizV2()` 分支分离；V2 绝不进入：

```js
if (reentryId && nextPos >= 4) return this.get(reentryId);
```

- [ ] **Step 4: 跑测试**

Run: `node --test tests/ternary-biz-v2.test.cjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add assets/simulation-engine.js tests/ternary-biz-v2.test.cjs
git commit -m "$(cat <<'EOF'
fix(sim): 商业V2 成团后再邀走 groupSlotOpen

与纯商业版 latestReentry 挂点分离，避免堆复投支。
EOF
)"
```

---

### Task 5: UI / README + 全量回归

**Files:**
- Modify: `index.html`（`<select id="slide-mode">` 增 option；规则区补一句）
- Modify: `assets/simulation-ui.js`（`syncSlideModeChrome`、切换成功文案）
- Modify: `README.md`

**Interfaces:**
- Consumes: `sim.setSlideMode('ternary_biz_v2')`
- Produces: 操作中心可选「三三复制商业V2」

- [ ] **Step 1: 改 `index.html`**

在 `ternary_biz` option 后插入：

```html
<option value="ternary_biz_v2">三三复制商业V2（L/R帮扶滑落 · 复投可挂点）</option>
```

规则说明段（拼团区/成团那段）追加一句：

```html
<strong class="text-slate-300">三三复制商业V2：</strong>第 3 人扶持区；第 4 人起按最左支 L/R、先上下再左右滑落帮扶；复投可挂点但零收益；成团后再邀不强制挂最新复投点。
```

- [ ] **Step 2: 改 `simulation-ui.js`**

在 `ternary_biz` 分支后增加：

```js
} else if (mode === 'ternary_biz_v2') {
  if (badge) {
    badge.textContent = '商业V2 · L/R帮扶 · 复投零收益';
    badge.className = 'text-[10px] px-2 py-0.5 rounded-full border border-fuchsia-500/40 text-fuchsia-200';
  }
  if (hint) {
    hint.textContent = '三三复制商业V2：第1–2拼团区、第3扶持区；第4人起L/R深度优先滑落帮扶；成团复投同算法可计团可挂点但零收益；成团后再邀不强制挂复投点。';
  }
}
```

切换 toast（`slide-mode` change 处）增加对应中文成功句。

- [ ] **Step 3: 改 `README.md`**

在模式列表增加一行：

```markdown
- **三三复制商业V2**：第 3 人扶持区；第 4 人起 L/R DFS 滑落帮扶；复投可挂点零收益；成团后再邀走同一找空，不强制挂最新复投点。
```

- [ ] **Step 4: 全量测试**

Run: `cd outputs/demofenxiao && node --test tests/*.test.cjs`

Expected: 全部 PASS（含原有 ternary_biz 用例不被破坏）

- [ ] **Step 5: Commit**

```bash
git add index.html assets/simulation-ui.js README.md
git commit -m "$(cat <<'EOF'
docs(ui): 操作中心接入三三复制商业V2

下拉、badge、README 与规则说明对齐引擎行为。
EOF
)"
```

---

## Spec coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| 模式键 `ternary_biz_v2` | 1, 5 |
| 第 1–2 group / 第 3 support | 2 |
| 第 4+ `groupSlotOpen` DFS | 1, 2 |
| 直推奖给邀请人 | 2, 3 |
| 1+2+4 拼团奖 | 3 |
| B3 两直推 → 订单奖 | 3 |
| 复投 `groupSlotOpen` + 可计团 | 1, 3 |
| 复投可挂下级、零收益 | 3 |
| 成团后再邀不强制最新复投点 | 2, 4 |
| UI / README | 5 |
| 不改其它模式 / 后端 | Global Constraints |

无 TBD；方法名全程统一为 `groupSlotOpen` / `usesTernaryBizV2` / `usesBizGroupCount`。
