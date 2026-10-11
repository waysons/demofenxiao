
'use strict';
const $ = id => document.getElementById(id);
const money = cents => '¥' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let sim = new Simulation();
let selectedId = ROOT_ID;
let viewRoot = ROOT_ID;
let ledgerMode = 'orders';
let page = 0;
let toastTimer;
const PAGE_SIZE = 12;
const expanded = new Map();
const expandedRewards = new Set();

function showToast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

function userOptions() {
  return [...sim.users.values()].map(user => '<option value="' + escapeHTML(user.id) + '">' +
    escapeHTML(user.id) + ' · ' + sim.role(user.id) + '</option>').join('');
}

function renderStats() {
  const users = [...sim.users.values()];
  $('stat-users').textContent = users.length.toLocaleString('zh-CN');
  $('stat-sales').textContent = money(sim.orders.length * PRICE);
  $('stat-orders').textContent = sim.orders.length + ' 笔已结算订单';
  $('stat-bonus').textContent = money(users.reduce((sum, user) => sum + sim.income(user.id), 0));
  $('stat-groups').textContent = users.filter(user => user.groupAwarded).length;
  $('reset-open').disabled = sim.orders.length === 0;
}

function renderUser() {
  const user = sim.get(selectedId);
  $('operator').value = selectedId;
  $('user-avatar').textContent = user.id.length > 4 ? user.id.slice(0, 3) + '…' : user.id;
  $('user-name').textContent = user.id;
  $('user-role').textContent = sim.role(user.id);
  $('user-role').className = 'role-badge ' + (user.groupAwarded ? 'leader' : 'ordinary');
  $('user-parent').textContent = '直接推荐人 · ' + (user.referrerId || '无（根节点）');
  $('user-income').textContent = money(sim.income(user.id));
  $('user-spent').textContent = '模拟下单支出 ' + money(user.spent) + (user.id === ROOT_ID ? ' · 初始账号' : ' · 已模拟扣款');
  $('user-direct').textContent = user.children.length;
  $('user-team').textContent = user.teamSize;
  for (const type of Object.keys(REWARD_NAMES)) $('reward-' + type).textContent = money(user.wallet[type]);
  const progress = sim.groupProgress(user.id);
  $('user-group-members').textContent = '拼团区：' + [0, 1].map(index => user.children[index] || '第 ' + (index + 1) + ' 位待邀请').join(' / ');
  $('group-status').textContent = user.groupAwarded ? '已成团 ✓' : progress + ' / 7';
  $('group-dots').innerHTML = Array.from({ length: 7 }, (_, i) => '<span class="group-dot ' + (i < progress ? 'filled' : '') + '">' + (i < progress ? '✓' : '·') + '</span>').join('');
  $('group-hint').textContent = user.groupAwarded ? '已发拼团奖 29.85 元 + 管理奖 2.39 元，此团不重复结算。' : '本人 + 前两名直推 + 两人各自的前两名直推，满 7 人才能成为团长。';
  const expired = sim.needsRepurchase(user.id);
  $('qualification-status').textContent = expired
    ? '本轮已满八层，需复购 199 元恢复邀请资格。'
    : '可邀请 · 本轮已发展 ' + Math.max(0, user.maxDownlineDepth - user.renewedDepth) + ' / ' + REPURCHASE_LAYERS + ' 层（本人以下）';
  $('invite-open').disabled = expired;
  $('repurchase-open').hidden = !expired;
}

function renderTree() {
  const root = sim.get(viewRoot);
  $('view-root').textContent = viewRoot;
  $('tree-count').textContent = root.teamSize + ' 位成员（含顶点）';
  $('root-tree').hidden = viewRoot === ROOT_ID;
  $('contribution-target').textContent = selectedId;
  // 按来源订单统计贡献，不累加分支收益，避免同一笔奖金被多层重复展示。
  const contributions = new Map();
  for (const order of sim.orders) {
    const rewards = contributions.get(order.buyerId) || Object.fromEntries(Object.keys(REWARD_NAMES).map(type => [type, 0]));
    for (const payout of order.payouts) {
      if (payout.userId === selectedId) rewards[payout.type] += payout.cents;
    }
    contributions.set(order.buyerId, rewards);
  }
  const renderNode = (id, depth) => {
    const user = sim.get(id);
    const children = user.children;
    const isOpen = expanded.get(id) ?? depth < 2;
    const selected = id === selectedId;
    const position = depth > 0 ? sim.get(user.referrerId).children.indexOf(id) + 1 : 0;
    const inGroupZone = position === 1 || position === 2;
    const zoneLabel = position ? (inGroupZone ? '拼团区' : '扶持区') + ' · 第 ' + position + ' 位' : '当前团队顶点';
    const zoneClass = position === 0 ? 'root-zone' : inGroupZone ? 'group-zone' : 'other-zone';
    const zone = position === 0 ? 'root' : inGroupZone ? 'group' : 'support';
    const edgeLabel = position ? '<span class="edge-label edge-' + zone + '">' + (inGroupZone ? '拼团区' : '扶持区') + '</span>' : '';
    const deleteLabel = id === ROOT_ID ? '清空全部成员与记录，恢复初始张三' : '删除 ' + id + ' 及全部下级和记录';
    const rewards = selected ? user.wallet : contributions.get(id) || {};
    const total = Object.values(rewards).reduce((sum, cents) => sum + cents, 0);
    const incomeLabel = selected ? '主节点 · 累计收益' : '贡献给 ' + selectedId;
    const rewardsOpen = expandedRewards.has(id);
    const node = '<div class="node-card ' + (selected ? 'selected' : '') + '"><button type="button" class="node ' + zoneClass + ' ' + (selected ? 'selected' : '') + '" data-user="' + escapeHTML(id) +
      '" aria-pressed="' + selected + '" aria-label="选择 ' + escapeHTML(id) + '，' + sim.role(id) + '，团队 ' + user.teamSize + ' 人，' + escapeHTML(incomeLabel) + ' ' + money(total) + '">' +
      '<span class="flex items-center gap-1.5 pr-6"><strong class="mono text-sm truncate min-w-0" title="' + escapeHTML(id) + '">' + escapeHTML(id) + '</strong><span class="role-badge ' + (user.groupAwarded ? 'leader' : 'ordinary') + '">' + sim.role(id) + '</span></span>' +
      '<span class="zone-label">' + zoneLabel + '</span>' +
      (sim.needsRepurchase(id) ? '<span class="block text-[10px] text-amber-300 mt-1">待复购 · 邀请暂停</span>' : '') +
      '<span class="block text-[10px] muted mt-2.5">团队 <b class="text-slate-300 font-normal mono">' + user.teamSize + '</b> 人 <span class="text-slate-600">/</span> 直推 ' + user.children.length + '</span>' +
      '<span class="block text-[10px] muted mt-2 break-words">' + escapeHTML(incomeLabel) + '</span><span class="node-income block mono text-sm text-blue-200 mt-1">' + money(total) + '</span></button>' +
      '<button type="button" class="node-reward-toggle" data-rewards-toggle="' + escapeHTML(id) + '" aria-expanded="' + rewardsOpen + '" aria-controls="node-rewards-' + escapeHTML(id) + '">' + (rewardsOpen ? '收起四奖明细 ▴' : '展开四奖明细 ▾') + '</button>' +
      '<div class="node-rewards" id="node-rewards-' + escapeHTML(id) + '"' + (rewardsOpen ? '' : ' hidden') + '>' + Object.entries(REWARD_NAMES).map(([type, name]) => '<span class="reward-tone-' + type + '">' + name + '<span class="mono" data-reward="' + type + '">' + money(rewards[type] || 0) + '</span></span>').join('') + '</div>' +
      '<button type="button" class="node-delete" data-delete="' + escapeHTML(id) + '" aria-label="' + escapeHTML(deleteLabel) + '" title="' + escapeHTML(deleteLabel) + '">×</button></div>';
    const toggle = children.length ? '<button class="branch-toggle" data-expand="' + escapeHTML(id) + '" aria-expanded="' + isOpen + '" aria-label="' + (isOpen ? '收起 ' : '展开 ') + escapeHTML(id) + ' 的下级">' + (isOpen ? '收起下级 −' : '展开下级 · ' + children.length + ' 人 ＋') + '</button>' : '';
    return '<li data-node="' + escapeHTML(id) + '" data-zone="' + zone + '">' + edgeLabel + node + toggle + (children.length && isOpen ? '<ul>' + children.map(child => renderNode(child, depth + 1)).join('') + '</ul>' : '') + '</li>';
  };
  $('tree').innerHTML = '<ul>' + renderNode(viewRoot, 0) + '</ul><div id="group-outlines" aria-hidden="true"></div>';
  $('tree-empty').hidden = root.children.length > 0;
  scheduleGroupOutlines();
}

// 用独立覆盖层圈出前两名直推，保持原有扶持区排布和连线结构。
function drawGroupOutlines() {
  const layer = $('group-outlines');
  if (!layer) return;
  layer.replaceChildren();
  const origin = $('tree').getBoundingClientRect();
  $('tree').querySelectorAll('li[data-node]').forEach(parent => {
    const members = [...parent.querySelectorAll(':scope > ul > li')].slice(0, 2);
    if (!members.length) return;
    const rects = members.map(member => member.querySelector(':scope > .node-card').getBoundingClientRect());
    const left = Math.min(...rects.map(rect => rect.left));
    const top = Math.min(...rects.map(rect => rect.top));
    const right = Math.max(...rects.map(rect => rect.right));
    const bottom = Math.max(...rects.map(rect => rect.bottom));
    const frame = document.createElement('div');
    frame.className = 'group-outline';
    frame.dataset.groupOwner = parent.dataset.node;
    frame.dataset.members = members.map(member => member.dataset.node).join(',');
    const label = document.createElement('span');
    label.className = 'group-outline-label';
    label.textContent = parent.dataset.node + ' 的拼团区';
    frame.append(label);
    // DOM 矩形包含缩放，需要还原到画布坐标，防止虚线框二次缩放错位。
    frame.style.left = ((left - origin.left) / treePan.scale - 8) + 'px';
    frame.style.top = ((top - origin.top) / treePan.scale - 8) + 'px';
    frame.style.width = ((right - left) / treePan.scale + 16) + 'px';
    frame.style.height = ((bottom - top) / treePan.scale + 16) + 'px';
    layer.append(frame);
  });
}

function scheduleGroupOutlines() {
  if (window.requestAnimationFrame) window.requestAnimationFrame(drawGroupOutlines);
  else drawGroupOutlines();
}
window.addEventListener('resize', scheduleGroupOutlines);
if (window.ResizeObserver) new ResizeObserver(scheduleGroupOutlines).observe($('tree'));

function renderLedger() {
  document.querySelectorAll('[data-ledger]').forEach(button => {
    const active = button.dataset.ledger === ledgerMode;
    button.setAttribute('aria-selected', active);
    button.tabIndex = active ? 0 : -1;
  });
  $('ledger-content').setAttribute('aria-labelledby', 'tab-' + ledgerMode);
  let rows;
  if (ledgerMode === 'income') {
    rows = sim.orders.slice().reverse().flatMap(order => order.payouts.filter(p => p.userId === selectedId).map(payout => ({ order, payout })));
    $('ledger-label').textContent = selectedId + ' · ' + rows.length + ' 笔入账';
  } else {
    rows = sim.orders.slice().reverse();
    $('ledger-label').textContent = '全系统 · ' + rows.length + ' 笔订单';
  }
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  page = Math.min(page, pages - 1);
  $('pagination').hidden = rows.length <= PAGE_SIZE;
  $('page-label').textContent = '第 ' + (page + 1) + ' / ' + pages + ' 页';
  $('page-prev').disabled = page === 0;
  $('page-next').disabled = page >= pages - 1;
  if (!rows.length) {
    $('ledger-content').innerHTML = '<div class="text-center px-5 py-10"><div class="w-10 h-10 grid place-items-center rounded-xl border border-slate-700 text-slate-500 mx-auto mb-3" aria-hidden="true">≡</div><p class="text-sm text-slate-300">' + (ledgerMode === 'income' ? '这里记录每一笔收益' : '第一笔订单，等待发生') + '</p><p class="text-[11px] muted mt-2">' + (ledgerMode === 'income' ? escapeHTML(selectedId) + ' 暂无收益；符合规则的奖金将在下单后自动入账。' : '新增成员后，可在这里展开查看订单的全部奖金分配。') + '</p></div>';
    return;
  }
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  if (ledgerMode === 'income') {
    $('ledger-content').innerHTML = '<div class="table-scroll"><table><thead><tr><th>来源订单</th><th>奖金类型</th><th>结算说明</th><th class="text-right">入账金额</th></tr></thead><tbody>' + visible.map(({ order, payout }) => '<tr><td><span class="mono text-slate-300">#' + String(order.id).padStart(4, '0') + '</span><span class="block text-[10px] muted mt-1">下单人 ' + escapeHTML(order.buyerId) + '</span></td><td><span class="reward-tag reward-tone-' + payout.type + '">' + REWARD_NAMES[payout.type] + '</span></td><td class="muted text-[11px]">' + escapeHTML(payout.note) + '</td><td class="text-right mono text-emerald-300">+' + money(payout.cents) + '</td></tr>').join('') + '</tbody></table></div>';
  } else {
    $('ledger-content').innerHTML = '<div class="table-scroll"><table><thead><tr><th>订单 / 时间</th><th>下单人</th><th>模拟扣款</th><th>分配详情</th></tr></thead><tbody>' + visible.map(order => '<tr><td class="align-top"><span class="mono text-slate-300">#' + String(order.id).padStart(4, '0') + '</span><span class="block text-[10px] muted mt-1 mono">' + order.time + '</span></td><td class="align-top mono">' + escapeHTML(order.buyerId) + (order.type === 'repurchase' ? '<span class="block text-[10px] text-amber-200 mt-1">复购 · 恢复邀请资格</span>' : '<span class="block text-[10px] muted mt-1">推荐 ' + escapeHTML(order.referrerId) + '</span><span class="reward-tag mt-2 reward-tone-' + (order.zone === 'group' ? 'group' : 'order') + '">' + (order.zone === 'group' ? '拼团区' : '扶持区') + ' · 第 ' + order.position + ' 位</span>') + '</td><td class="align-top"><span class="mono">−' + money(order.cents) + '</span><span class="block text-[10px] text-emerald-300 mt-1">模拟支付成功</span></td><td class="align-top"><details><summary class="text-blue-300">奖金 ' + money(order.payouts.reduce((s, p) => s + p.cents, 0)) + ' · 展开</summary><div class="space-y-2 mt-3">' + order.payouts.map(p => '<div class="reward-card reward-tone-' + p.type + ' text-[11px]"><span class="mono font-semibold">' + escapeHTML(p.userId) + '</span> ' + REWARD_NAMES[p.type] + ' <span class="mono">+' + money(p.cents) + '</span><span class="block text-[10px] mt-1 opacity-80">' + escapeHTML(p.note) + '</span></div>').join('') + '</div></details></td></tr>').join('') + '</tbody></table></div>';
  }
}

function renderAll() {
  $('operator').innerHTML = userOptions();
  document.querySelectorAll('[data-reward-rate]').forEach(label => {
    label.textContent = REWARD_RATES[label.dataset.rewardRate] + '%';
  });
  renderStats();
  renderUser();
  renderTree();
  renderLedger();
}

function selectUser(id) {
  if (!sim.get(id)) return;
  selectedId = id;
  page = 0;
  renderUser();
  renderTree();
  renderLedger();
}

function updateInvitePreview() {
  const id = $('invite-referrer').value;
  const generated = sim.nextName(id);
  $('invite-name').placeholder = generated + '（自动生成）';
  $('name-hint').textContent = '默认生成 ' + generated + '；也可输入字母组 + 数字，小写会自动转大写。';
  const position = sim.get(id).children.length + 1;
  $('invite-reward-preview').textContent = sim.needsRepurchase(id)
    ? '该推荐人本轮已满八层，请先切换到此人并复购 199 元，再继续邀请。'
    : position <= 2
      ? '第 ' + position + ' 位直推进入拼团区：推荐人获得直推奖 39.80 元，不发订单奖；若补满七人团，团长另获拼团奖 29.85 元和管理奖 2.39 元。'
      : '第 ' + position + ' 位直推进入扶持区：推荐人获得直推奖 39.80 元 + 订单奖 19.90 元，不触发拼团奖或管理奖。';
  $('invite-submit').disabled = sim.needsRepurchase(id);
  $('invite-error').hidden = true;
}

// 平移和缩放只改变查看位置；Pointer Events 同时支持鼠标、触控和触控笔拖动。
const treeStage = $('tree-stage');
const treePan = { x: 0, y: 0, scale: 1 };
const MIN_TREE_SCALE = 0.35;
const MAX_TREE_SCALE = 2;
let treeDrag = null;
let suppressTreeClick = false;

function applyTreePan() {
  $('tree-canvas').style.setProperty('--pan-x', treePan.x + 'px');
  $('tree-canvas').style.setProperty('--pan-y', treePan.y + 'px');
  $('tree-canvas').style.setProperty('--tree-scale', treePan.scale);
  $('zoom-reset').textContent = Math.round(treePan.scale * 100) + '%';
  $('zoom-out').disabled = treePan.scale <= MIN_TREE_SCALE;
  $('zoom-in').disabled = treePan.scale >= MAX_TREE_SCALE;
}

function zoomTree(scale, anchorX = 0, anchorY = treeStage.clientHeight / 2) {
  const next = Math.max(MIN_TREE_SCALE, Math.min(MAX_TREE_SCALE, scale));
  const ratio = next / treePan.scale;
  // 保持鼠标指向的位置不变；工具栏按钮以显示区中心为缩放中心。
  treePan.x = anchorX - (anchorX - treePan.x) * ratio;
  treePan.y = anchorY - (anchorY - treePan.y) * ratio;
  treePan.scale = next;
  applyTreePan();
}

function resetTreePan() {
  treePan.x = treePan.y = 0;
  suppressTreeClick = false;
  applyTreePan();
}

treeStage.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.isPrimary === false || treeDrag) return;
  suppressTreeClick = false;
  if (event.target.closest('[data-delete], [data-rewards-toggle]')) return;
  treeDrag = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
    originX: treePan.x, originY: treePan.y, moved: false, target: event.target };
  // 捕获在原目标上，轻点节点时仍会正常触发该节点的 click。
  event.target.setPointerCapture?.(event.pointerId);
});

treeStage.addEventListener('pointermove', event => {
  if (!treeDrag || event.pointerId !== treeDrag.id) return;
  const dx = event.clientX - treeDrag.startX;
  const dy = event.clientY - treeDrag.startY;
  if (!treeDrag.moved && Math.hypot(dx, dy) < 5) return;
  treeDrag.moved = true;
  treeStage.classList.add('dragging');
  treePan.x = treeDrag.originX + dx;
  treePan.y = treeDrag.originY + dy;
  applyTreePan();
  event.preventDefault();
});

function endTreeDrag(event) {
  if (!treeDrag || event.pointerId !== treeDrag.id) return;
  const drag = treeDrag;
  treeDrag = null;
  suppressTreeClick = drag.moved;
  treeStage.classList.remove('dragging');
  if (drag.target.hasPointerCapture?.(drag.id)) drag.target.releasePointerCapture(drag.id);
}

['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => treeStage.addEventListener(type, endTreeDrag));
treeStage.addEventListener('click', event => {
  if (suppressTreeClick && event.detail !== 0) {
    event.preventDefault();
    event.stopPropagation();
    suppressTreeClick = false;
  }
}, true);
treeStage.addEventListener('keydown', event => {
  if (event.target !== treeStage) return;
  if (event.key === 'Home') { event.preventDefault(); resetTreePan(); return; }
  if (['+', '=', '-'].includes(event.key)) {
    event.preventDefault();
    zoomTree(treePan.scale * (event.key === '-' ? 1 / 1.2 : 1.2));
    return;
  }
  const moves = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
  if (!moves[event.key]) return;
  event.preventDefault();
  treePan.x += moves[event.key][0];
  treePan.y += moves[event.key][1];
  applyTreePan();
});
treeStage.addEventListener('wheel', event => {
  event.preventDefault();
  if (treeDrag) return;
  const rect = treeStage.getBoundingClientRect();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? treeStage.clientHeight : 1);
  zoomTree(treePan.scale * Math.exp(-Math.max(-250, Math.min(250, delta)) * 0.002),
    event.clientX - rect.left - rect.width / 2, event.clientY - rect.top);
}, { passive: false });
$('zoom-in').addEventListener('click', () => zoomTree(treePan.scale * 1.2));
$('zoom-out').addEventListener('click', () => zoomTree(treePan.scale / 1.2));
$('zoom-reset').addEventListener('click', () => { treePan.scale = 1; resetTreePan(); });
$('center-tree').addEventListener('click', resetTreePan);

$('operator').addEventListener('change', event => selectUser(event.target.value));
$('tree').addEventListener('click', event => {
  const remove = event.target.closest('[data-delete]');
  if (remove) { openDeleteDialog(remove.dataset.delete); return; }
  const rewardsToggle = event.target.closest('[data-rewards-toggle]');
  if (rewardsToggle) {
    const id = rewardsToggle.dataset.rewardsToggle;
    expandedRewards.has(id) ? expandedRewards.delete(id) : expandedRewards.add(id);
    renderTree();
    $('tree').querySelector('[data-rewards-toggle="' + id + '"]')?.focus({ preventScroll: true });
    return;
  }
  const node = event.target.closest('[data-user]');
  if (node) { selectUser(node.dataset.user); return; }
  const toggle = event.target.closest('[data-expand]');
  if (toggle) {
    const key = toggle.dataset.expand;
    expanded.set(key, toggle.getAttribute('aria-expanded') !== 'true');
    renderTree();
    // 替换 DOM 后恢复键盘焦点。
    $('tree').querySelector('[data-expand="' + toggle.dataset.expand + '"]')?.focus({ preventScroll: true });
  }
});
$('collapse-tree').addEventListener('click', () => {
  for (const id of sim.users.keys()) expanded.set(id, false);
  renderTree();
});
$('expand-tree').addEventListener('click', () => {
  for (const id of sim.users.keys()) expanded.set(id, true);
  renderTree();
});
$('collapse-rewards').addEventListener('click', () => { expandedRewards.clear(); renderTree(); });
$('expand-rewards').addEventListener('click', () => {
  for (const id of sim.users.keys()) expandedRewards.add(id);
  renderTree();
});

let pendingDeleteId = null;
function openDeleteDialog(id) {
  const ids = new Set(sim.branchIds(id));
  const orderCount = sim.orders.filter(order => ids.has(order.buyerId)).length;
  pendingDeleteId = id;
  $('delete-title').textContent = id === ROOT_ID ? '清空全部模拟数据？' : '删除 ' + id + ' 的整个分支？';
  $('delete-description').textContent = id === ROOT_ID
    ? '将清除 ' + (ids.size - 1) + ' 名新增成员、' + orderCount + ' 笔订单及全部奖金记录，恢复初始账号张三。'
    : '将删除 ' + ids.size + ' 名成员（含 ' + id + '）、' + orderCount + ' 笔订单及相关奖金记录。';
  $('delete-confirm').textContent = id === ROOT_ID ? '清空并恢复张三' : '删除分支与记录';
  $('delete-error').hidden = true;
  $('delete-dialog').showModal();
}
$('delete-cancel').addEventListener('click', () => { pendingDeleteId = null; $('delete-dialog').close(); });
$('delete-confirm').addEventListener('click', () => {
  if (!pendingDeleteId || !$('delete-dialog').open || $('delete-confirm').disabled) return;
  $('delete-confirm').disabled = true;
  try {
    const id = pendingDeleteId;
    const fallback = sim.get(id).referrerId || ROOT_ID;
    const result = sim.deleteBranch(id);
    if (!sim.get(selectedId)) selectedId = fallback;
    if (!sim.get(viewRoot)) viewRoot = fallback;
    for (const expandedId of expanded.keys()) if (!sim.get(expandedId) || id === ROOT_ID) expanded.delete(expandedId);
    for (const id of expandedRewards) if (!sim.get(id) || pendingDeleteId === ROOT_ID) expandedRewards.delete(id);
    page = 0;
    if (id === ROOT_ID) ledgerMode = 'orders';
    pendingDeleteId = null;
    $('delete-dialog').close();
    renderAll();
    resetTreePan();
    showToast(id === ROOT_ID ? '已清空全部记录并恢复初始张三。'
      : '已删除 ' + result.removedIds.length + ' 名成员和 ' + result.orderCount + ' 笔订单，剩余收益已重新结算。');
  } catch (error) {
    $('delete-error').textContent = error.message;
    $('delete-error').hidden = false;
  } finally { $('delete-confirm').disabled = false; }
});
$('focus-tree').addEventListener('click', () => { viewRoot = selectedId; renderTree(); resetTreePan(); });
$('root-tree').addEventListener('click', () => { viewRoot = ROOT_ID; renderTree(); resetTreePan(); });
document.querySelectorAll('[data-ledger]').forEach(button => button.addEventListener('click', () => { ledgerMode = button.dataset.ledger; page = 0; renderLedger(); }));
document.querySelectorAll('[role="tablist"]').forEach(list => list.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const current = tabs.indexOf(document.activeElement);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); tabs[index].focus(); tabs[index].click();
}));
$('page-prev').addEventListener('click', () => { page--; renderLedger(); });
$('page-next').addEventListener('click', () => { page++; renderLedger(); });

$('invite-open').addEventListener('click', () => {
  $('invite-referrer').innerHTML = userOptions();
  $('invite-referrer').value = selectedId;
  $('invite-name').value = '';
  updateInvitePreview();
  $('invite-dialog').showModal();
  $('invite-name').focus();
});
$('invite-close').addEventListener('click', () => $('invite-dialog').close());
$('invite-referrer').addEventListener('change', updateInvitePreview);
$('invite-name').addEventListener('input', () => { $('invite-error').hidden = true; });
$('invite-form').addEventListener('submit', event => {
  event.preventDefault();
  const submit = $('invite-submit');
  if (submit.disabled || !$('invite-dialog').open) return;
  submit.disabled = true;
  try {
    const referrerId = $('invite-referrer').value;
    const order = sim.addUser(referrerId, $('invite-name').value);
    selectedId = referrerId; // 继续观察推荐人的收益，方便连续邀请。
    page = 0;
    $('invite-dialog').close();
    renderAll();
    showToast(order.buyerId + ' 已加入 · 模拟扣款 199 元 · 奖金已结算');
  } catch (error) {
    $('invite-error').textContent = error.message;
    $('invite-error').hidden = false;
  } finally { submit.disabled = false; }
});
let pendingRepurchaseId = null;
$('repurchase-open').addEventListener('click', () => {
  pendingRepurchaseId = selectedId;
  $('repurchase-description').textContent = selectedId + ' 本轮已满八层。模拟支付 199 元后恢复邀请资格，再延伸八层需再次复购；保留现有团队与收益，本次复购不新增成员、不重复发奖。';
  $('repurchase-dialog').showModal();
});
$('repurchase-cancel').addEventListener('click', () => {
  pendingRepurchaseId = null;
  $('repurchase-dialog').close();
});
$('repurchase-confirm').addEventListener('click', () => {
  if (!pendingRepurchaseId || !$('repurchase-dialog').open) return;
  try {
    const order = sim.repurchase(pendingRepurchaseId);
    selectedId = pendingRepurchaseId;
    pendingRepurchaseId = null;
    page = 0;
    ledgerMode = 'orders';
    $('repurchase-dialog').close();
    renderAll();
    showToast(order.buyerId + ' 已复购 199 元，邀请资格已恢复。');
  } catch (error) { showToast(error.message); }
});
$('reset-open').addEventListener('click', () => $('reset-dialog').showModal());
$('reset-cancel').addEventListener('click', () => $('reset-dialog').close());
$('reset-confirm').addEventListener('click', () => {
  sim = new Simulation();
  selectedId = viewRoot = ROOT_ID; ledgerMode = 'orders'; page = 0;
  expanded.clear();
  expandedRewards.clear();
  $('reset-dialog').close();
  renderAll();
  resetTreePan();
  showToast('已恢复初始账号张三，可以重新开始模拟。');
});
renderAll();
