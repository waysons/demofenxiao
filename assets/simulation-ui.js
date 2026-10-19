
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

function msToDatetimeLocal(ms) {
  if (ms == null || Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function parseDatetimeLocal(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function treeChildIds(user) {
  return [...user.children, ...(user.markedChildren || [])];
}

function showToast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

function syncSlideModeUi() {
  const mode = sim.slideMode || 'binary';
  const select = $('slide-mode');
  if (select && select.value !== mode) select.value = mode;
  const badge = $('slide-mode-badge');
  const hint = $('slide-mode-hint');
  if (mode === 'binary') {
    if (badge) {
      badge.textContent = '双轨邀请 · 复投不计团';
      badge.className = 'text-[10px] px-2 py-0.5 rounded-full border border-sky-500/40 text-sky-200';
    }
    if (hint) {
      hint.textContent = '二二复制+双轨邀请：本人树最多 2 真人，第 3 人起滑到空位占落点 L/R（加速落点成团）；成团复投另按找空位挂扶持区且不计团。';
    }
  } else if (mode === 'ternary') {
    if (badge) {
      badge.textContent = '三三复制 · 复投不计团';
      badge.className = 'text-[10px] px-2 py-0.5 rounded-full border border-violet-500/40 text-violet-200';
    }
    if (hint) {
      hint.textContent = '三三复制+三轨邀请：本人树最多 3 真人，第 4 人起滑到空位；成团复投按未满 3 找空挂扶持区且不计团。七人团仍只认前两支。';
    }
  } else if (mode === 'ternary_biz') {
    if (badge) {
      badge.textContent = '纯商业 · 左下复投计团';
      badge.className = 'text-[10px] px-2 py-0.5 rounded-full border border-rose-500/40 text-rose-200';
    }
    if (hint) {
      hint.textContent = '三三纯商业版：第 1–2 拼团区、第 3 人本人扶持区（不滑落）；成团复投最左下方可计团；第 4 人起才挂到最新复投点分支下。';
    }
  } else if (mode === 'ternary_biz_v2') {
    if (badge) {
      badge.textContent = '商业V2 · L/R帮扶 · 复投零收益';
      badge.className = 'text-[10px] px-2 py-0.5 rounded-full border border-fuchsia-500/40 text-fuchsia-200';
    }
    if (hint) {
      hint.textContent = '三三复制商业V2：第1–2拼团区、第3扶持区；第4人起L/R滑落；计团复投给挂点发帮扶直推并计团长席+1（复投点零收益）；成团后再邀不强制挂复投点。';
    }
  } else if (mode === 'alternate') {
    if (badge) {
      badge.textContent = '试验 · 左右轮换';
      badge.className = 'text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-200';
    }
    if (hint) hint.textContent = '试验版：奇次左链 / 偶次右链最底挂复投；复投进扶持区，不计入七人团、不占左右位、不发直推奖。';
  } else {
    if (badge) {
      badge.textContent = '左链滑落 · 复投不计团';
      badge.className = 'text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300';
    }
    if (hint) hint.textContent = '复投滑到左链最底扶持区；不计入七人团（防单链）、不占左右位、不发直推奖。';
  }
}

function softResetSimulation(slideMode) {
  const mode = slideMode || sim.slideMode || 'binary';
  sim = new Simulation();
  sim.setSlideMode(mode);
  selectedId = viewRoot = ROOT_ID;
  ledgerMode = 'orders';
  page = 0;
  expanded.clear();
}

function currentRates() {
  return sim.rates || DEFAULT_REWARD_RATES;
}

function syncRateInputs() {
  const rates = currentRates();
  document.querySelectorAll('[data-rate-key]').forEach(input => {
    input.value = rates[input.dataset.rateKey];
  });
  document.querySelectorAll('[data-reward-rate]').forEach(label => {
    label.textContent = rates[label.dataset.rewardRate] + '%';
  });
  const agentSelect = $('agent-level');
  if (!agentSelect) return;
  [...agentSelect.options].forEach(opt => {
    if (opt.value === 'county') opt.textContent = '县级代理 · ' + rates.agent_county + '%';
    if (opt.value === 'city') opt.textContent = '市级代理 · ' + rates.agent_city + '%';
    if (opt.value === 'province') opt.textContent = '省级代理 · ' + rates.agent_province + '%';
  });
}

function orderZoneLabel(order) {
  if (order.zone === 'group') return '左右位';
  if (order.zone === 'binary_slide' || order.zone === 'v2_slide') return '滑落帮扶';
  return '扶持区';
}

function userOptions() {
  return [...sim.users.values()].map(user => '<option value="' + escapeHTML(user.id) + '">' +
    escapeHTML(user.id) + ' · ' + sim.role(user.id) + '</option>').join('');
}

// 邀请推荐人下拉：已入团真人；V2 另允许复投点（挂点记复投、邀请记原号）。
function referrerOptions() {
  const allowReentry = sim.slideMode === 'ternary_biz_v2';
  return [...sim.users.values()].filter(user => {
    if (!user.joined) return false;
    if (user.reentry) return allowReentry;
    return true;
  }).map(user =>
    '<option value="' + escapeHTML(user.id) + '">' + escapeHTML(user.id) + ' · ' + sim.role(user.id) + '</option>').join('');
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
  $('user-role').className = 'role-badge ' + (sim.role(user.id) === '团长' ? 'leader' : 'ordinary');
  $('user-parent').textContent = '直接推荐人 · ' + (user.referrerId || '无（根节点）');
  $('user-income').textContent = money(sim.income(user.id));
  $('user-spent').textContent = '模拟下单支出 ' + money(user.spent) + (user.id === ROOT_ID ? ' · 初始账号' : ' · 已模拟扣款');
  $('user-direct').textContent = sim.realChildren(user.id).length;
  $('user-team').textContent = user.teamSize;
  $('agent-level').value = user.agentLevel || '';
  $('agent-level').disabled = user.reentry;
  for (const type of Object.keys(REWARD_NAMES)) $('reward-' + type).textContent = money(user.wallet[type] || 0);
  const members = sim.groupMemberIds(user.id);
  const progress = Math.min(members.length, 7);
  $('user-group-members').textContent = '计入七人团 ' + members.length + ' 人：' + members.join('、');
  $('group-status').textContent = user.groupAwarded ? '已成团 ✓' : members.length + ' / 7';
  $('group-dots').innerHTML = Array.from({ length: 7 }, (_, i) => '<span class="group-dot ' + (i < progress ? 'filled' : '') + '">' + (i < progress ? '✓' : '·') + '</span>').join('');
  const leaders = user.children.filter(id => sim.role(id) === '团长').length;
  const rates = currentRates();
  const groupBonus = money(Math.round(PRICE * rates.group / 100));
  const managementBonus = money(Math.round(Math.round(PRICE * rates.group / 100) * rates.management / 100));
  const realDirect = sim.realChildren(user.id).length;
  const leaderGap = sim.role(user.id) === '团长'
    ? '已是团长（真人直推满 3）。'
    : (realDirect >= 3 ? '' : '还差 ' + (3 - realDirect) + ' 名真人直推') + '才是团长，与七人团是否满员无关。';
  const groupGate = sim.realChildren(user.id).length >= 2 ? '' : ' · 真人直推满 2 才触发成团';
  $('group-hint').textContent = (user.groupAwarded ? '已发拼团奖 ' + groupBonus + '，此团不重复结算。' : '前两名直推的整棵下级树加上本人满 7 人，且真人直推满 2，获得一次拼团奖 ' + groupBonus + '。') +
    leaderGap + groupGate + ' 已有 ' + leaders + ' 名直推成为团长；双方都是团长且下级已拿拼团奖，每名直推产生一次管理奖 ' + managementBonus + '，累计 ' + money(user.wallet.management) + '。';
  $('qualification-status').textContent = '可继续邀请。订单奖从触发人的直接上级向上最多 ' + ORDER_LAYERS + ' 层；当前向下最深 ' + user.maxDownlineDepth + ' 层。邀请不暂停。';
  // V2 允许从复投点发起邀请（引擎记原号）；其它模式仍禁用
  $('invite-open').disabled = user.reentry && sim.slideMode !== 'ternary_biz_v2';
  renderNodeOps(user);
}

function renderNodeOps(user) {
  const readOnly = user.reentry;
  const markedOnly = user.marketMarked && !user.joined;
  const joined = user.joined && !user.reentry;
  const timeMs = joined ? user.joinedAt : markedOnly ? user.marketMarkedAt : null;
  $('node-joined-at').value = msToDatetimeLocal(timeMs);
  $('node-joined-at').disabled = readOnly || (!joined && !markedOnly);
  $('node-save-time').disabled = readOnly || (!joined && !markedOnly);
  // 未入团 / 仅标记节点下不能再嵌套标记。
  $('node-mark').disabled = readOnly || !joined;
  $('node-unmark').disabled = readOnly || !markedOnly;
  $('node-join').disabled = readOnly || !markedOnly;
  let hint = '';
  if (readOnly) hint = '复投 (PS) 节点只读，不可改代理或购买时间。';
  else if (markedOnly) hint = '当前为仅标记：不占左右位、无 199 流水。可改标记时间，或「模拟购买入团」走完整结算。';
  else if (joined) hint = '已入团：保存时间会重排同级席位，不重发历史奖金。';
  else hint = '已入团节点下可「仅标记已购」占位；未入团 / 仅标记节点下不能邀请或标记。';
  $('node-ops-hint').textContent = hint;
}

function renderTree() {
  const root = sim.get(viewRoot);
  $('view-root').textContent = viewRoot;
  $('tree-count').textContent = root.teamSize + ' 位成员（含顶点）';
  $('root-tree').hidden = viewRoot === ROOT_ID;
  $('contribution-target').textContent = selectedId;
  // 按来源订单统计贡献，不累加分支收益，避免同一笔奖金被多层重复展示。
  const contributions = new Map();
  const managementContributions = new Map();
  for (const order of sim.orders) {
    const rewards = contributions.get(order.buyerId) || Object.fromEntries(Object.keys(REWARD_NAMES).map(type => [type, 0]));
    for (const payout of order.payouts) {
      if (payout.userId !== selectedId) continue;
      // 拼团奖放在拼团区，管理奖放在产生奖励的直推节点下。
      if (payout.type === 'management') {
        managementContributions.set(payout.sourceId, (managementContributions.get(payout.sourceId) || 0) + payout.cents);
      } else if (payout.type !== 'group') rewards[payout.type] += payout.cents;
    }
    contributions.set(order.buyerId, rewards);
  }
  const renderNode = (id, depth) => {
    const user = sim.get(id);
    const children = treeChildIds(user);
    const isOpen = expanded.get(id) ?? depth < 2;
    const selected = id === selectedId;
    const isMarkedOnly = user.marketMarked && !user.joined;
    const position = depth > 0 && !isMarkedOnly && user.joined && !user.reentry
      ? sim.realChildren(user.referrerId).indexOf(id) + 1
      : 0;
    const inGroupZone = position === 1 || position === 2;
    const agentShort = { county: '县代', city: '市代', province: '省代' }[user.agentLevel] || '';
    const zoneLabel = isMarkedOnly ? '仅标记 · 未入团' : position ? (inGroupZone ? '' : '扶持区 · ') + '第 ' + position + ' 位' : '当前团队顶点';
    const zoneClass = position === 0 ? 'root-zone' : inGroupZone ? 'group-zone' : 'other-zone';
    const zone = position === 0 ? 'root' : inGroupZone ? 'group' : 'support';
    const edgeLabel = position && !inGroupZone ? '<span class="edge-label edge-support">扶持区</span>' : '';
    const deleteLabel = id === ROOT_ID ? '清空全部成员与记录，恢复初始张三' : '删除 ' + id + ' 及全部下级和记录';
    const rewards = selected ? user.wallet : contributions.get(id) || {};
    const total = Object.values(rewards).reduce((sum, cents) => sum + cents, 0);
    const incomeLabel = selected ? '主节点 · 累计收益' : '贡献给 ' + selectedId;
    const rewardTerms = Object.entries(REWARD_NAMES).filter(([type]) => !selected && rewards[type] > 0).map(([type, name]) =>
      '<span class="reward-term reward-tone-' + type + '">' + name + ' <span class="mono" data-reward="' + type + '">' + money(rewards[type]) + '</span></span>');
    const markedClass = isMarkedOnly ? ' node-marked' : '';
    const node = '<div class="node-card ' + (selected ? 'selected' : '') + '"><button type="button" class="node ' + zoneClass + markedClass + ' ' + (selected ? 'selected' : '') + '" data-user="' + escapeHTML(id) +
      '" aria-pressed="' + selected + '" aria-label="选择 ' + escapeHTML(id) + '，' + sim.role(id) + '，团队 ' + user.teamSize + ' 人，' + escapeHTML(incomeLabel) + ' ' + money(total) + '">' +
      '<span class="flex items-center gap-1.5 pr-6"><strong class="mono text-sm truncate min-w-0" title="' + escapeHTML(id) + '">' + escapeHTML(id) + '</strong><span class="role-badge ' + (sim.role(id) === '团长' ? 'leader' : 'ordinary') + '">' + sim.role(id) + '</span>' +
      (isMarkedOnly ? '<span class="mark-badge">标记</span>' : '') +
      (agentShort ? '<span class="role-badge ordinary">' + agentShort + '</span>' : '') + '</span>' +
      '<span class="zone-label">' + zoneLabel + '</span>' +
      '<span class="block text-[10px] muted mt-2.5">团队 <b class="text-slate-300 font-normal mono">' + user.teamSize + '</b> 人 <span class="text-slate-600">/</span> 直推 ' + sim.realChildren(id).length + (user.markedChildren?.length ? '+' + user.markedChildren.length + '标记' : '') + ' <span class="text-slate-600">/</span> 成团 ' + sim.groupProgress(id) + '/7</span>' +
      '<span class="block text-[10px] muted mt-2 break-words">' + escapeHTML(incomeLabel) + '</span>' +
      '<span class="node-contribution"><span class="contribution-total">' + (selected ? '总收益 ' : '总贡献 ') + '<span class="node-income mono">' + money(total) + '</span></span>' +
      (rewardTerms.length ? '<span class="reward-equation"><span class="muted">= </span>' + rewardTerms.join('<span class="muted"> + </span>') + '</span>' : '') + '</span></button>' +
      '<button type="button" class="node-delete" data-delete="' + escapeHTML(id) + '" aria-label="' + escapeHTML(deleteLabel) + '" title="' + escapeHTML(deleteLabel) + '">×</button></div>';
    const toggle = children.length ? '<button class="branch-toggle" data-expand="' + escapeHTML(id) + '" aria-expanded="' + isOpen + '" aria-label="' + (isOpen ? '收起 ' : '展开 ') + escapeHTML(id) + ' 的下级">' + (isOpen ? '收起下级 −' : '展开下级 · ' + children.length + ' 人 ＋') + '</button>' : '';
    const management = managementContributions.get(id) || 0;
    const managementLabel = user.referrerId === selectedId
      ? '<div class="management-outline reward-tone-management" data-management-source="' + escapeHTML(id) + '">管理奖 <span class="mono" data-reward="management">' + money(management) + '</span><span class="block">' +
        (management ? '给 ' + escapeHTML(selectedId) + ' · 已结算一次' : '待双方均为团长且下级已拿拼团奖') + '</span></div>' : '';
    const markedAttr = isMarkedOnly ? ' data-marked-only="true"' : '';
    return '<li data-node="' + escapeHTML(id) + '" data-zone="' + zone + '"' + markedAttr + '>' + edgeLabel + node + managementLabel + toggle + (children.length && isOpen ? '<ul>' + children.map(child => renderNode(child, depth + 1)).join('') + '</ul>' : '') + '</li>';
  };
  $('tree').innerHTML = '<ul>' + renderNode(viewRoot, 0) + '</ul><div id="group-outlines"></div>';
  $('tree-empty').hidden = treeChildIds(root).length > 0;
  scheduleGroupOutlines();
}

// 用独立覆盖层圈出前两名直推，保持原有扶持区排布和连线结构。
function drawGroupOutlines() {
  const layer = $('group-outlines');
  if (!layer) return;
  layer.replaceChildren();
  const origin = $('tree').getBoundingClientRect();
  $('tree').querySelectorAll('li[data-node]').forEach(parent => {
    const members = [...parent.querySelectorAll(':scope > ul > li')]
      .filter(li => !li.hasAttribute('data-marked-only') && !li.querySelector('.mark-badge'))
      .slice(0, 2);
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
    frame.setAttribute('role', 'group');
    frame.setAttribute('aria-label', parent.dataset.node + ' 的拼团区');
    const label = document.createElement('span');
    label.className = 'group-outline-label';
    label.textContent = '拼团区';
    frame.append(label);
    if (parent.dataset.node === selectedId) {
      const contribution = document.createElement('span');
      contribution.className = 'group-contribution reward-tone-group';
      contribution.innerHTML = '拼团奖 <span class="mono" data-reward="group">' + money(sim.get(selectedId).wallet.group) + '</span>';
      frame.append(contribution);
    }
    // DOM 矩形包含缩放，需要还原到画布坐标，防止虚线框二次缩放错位。
    frame.style.left = ((left - origin.left) / treePan.scale - 8) + 'px';
    frame.style.top = ((top - origin.top) / treePan.scale - 44) + 'px';
    frame.style.width = ((right - left) / treePan.scale + 16) + 'px';
    frame.style.height = ((bottom - top) / treePan.scale + 52) + 'px';
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
    $('ledger-content').innerHTML = '<div class="table-scroll"><table><thead><tr><th>订单 / 时间</th><th>下单人</th><th>模拟扣款</th><th>分配详情</th></tr></thead><tbody>' + visible.map(order => '<tr><td class="align-top"><span class="mono text-slate-300">#' + String(order.id).padStart(4, '0') + '</span><span class="block text-[10px] muted mt-1 mono">' + order.time + '</span></td><td class="align-top mono">' + escapeHTML(order.buyerId) + (order.type === 'repurchase' ? '<span class="block text-[10px] text-amber-200 mt-1">复购 · 恢复邀请资格</span>' : '<span class="block text-[10px] muted mt-1">推荐 ' + escapeHTML(order.referrerId) + '</span><span class="reward-tag mt-2 reward-tone-' + (order.zone === 'group' ? 'group' : 'order') + '">' + orderZoneLabel(order) + ' · 第 ' + order.position + ' 位</span>') + '</td><td class="align-top"><span class="mono">−' + money(order.cents) + '</span><span class="block text-[10px] text-emerald-300 mt-1">模拟支付成功</span></td><td class="align-top"><details><summary class="text-blue-300">奖金 ' + money(order.payouts.reduce((s, p) => s + p.cents, 0)) + ' · 展开</summary><div class="space-y-2 mt-3">' + order.payouts.map(p => '<div class="reward-card reward-tone-' + p.type + ' text-[11px]"><span class="mono font-semibold">' + escapeHTML(p.userId) + '</span> ' + REWARD_NAMES[p.type] + ' <span class="mono">+' + money(p.cents) + '</span><span class="block text-[10px] mt-1 opacity-80">' + escapeHTML(p.note) + '</span></div>').join('') + '</div></details></td></tr>').join('') + '</tbody></table></div>';
  }
}

function renderAll() {
  $('operator').innerHTML = userOptions();
  syncSlideModeUi();
  syncRateInputs();
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

const MAX_BATCH_INVITES = 100;

function inviteCount() {
  const n = Number($('invite-count').value);
  if (!Number.isInteger(n) || n < 1 || n > 20) return null;
  return n;
}

function inviteLevels() {
  const n = Number($('invite-levels').value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

// 每层每人再邀 count 人：总数 = count + count² + … + count^levels
function projectedInviteTotal(count, levels) {
  if (count === 1) return levels;
  let total = 0;
  let layer = 1;
  for (let i = 0; i < levels; i++) {
    layer *= count;
    total += layer;
  }
  return total;
}

function updateInvitePreview() {
  const id = $('invite-referrer').value;
  const generated = sim.nextName(id);
  const markOnly = $('invite-mark-only').checked;
  const count = inviteCount() || 1;
  const levels = inviteLevels() || 1;
  const total = projectedInviteTotal(count, levels);
  const single = count === 1 && levels === 1;
  $('invite-name').placeholder = generated + '（自动生成）';
  $('invite-name').disabled = !single;
  if (levels > 1 && markOnly) {
    $('name-hint').textContent = '仅标记模式只支持 1 层；请把向下层数改为 1。';
  } else if (!single) {
    $('name-hint').textContent = '将按「每层 ' + count + ' 人 × ' + levels + ' 层」自动生成约 ' + total +
      ' 人（从 ' + generated + ' 起）。合计超过 ' + MAX_BATCH_INVITES + ' 人会拒绝。';
  } else {
    $('name-hint').textContent = '默认生成 ' + generated + '；也可输入字母组 + 数字，小写会自动转大写。';
  }
  $('invite-total-cost').textContent = markOnly ? '¥0.00' : money(PRICE * total);
  if (markOnly && levels > 1) {
    $('invite-reward-preview').textContent = '仅标记不能多层扩展，请将向下层数设为 1。';
  } else if (markOnly) {
    $('invite-reward-preview').textContent = count > 1
      ? '仅标记 ' + count + ' 人：树上显示角标，不扣 199、不占左右位、不发直推奖。'
      : '仅标记：树上显示角标，不扣 199、不占左右位、不发直推奖。';
  } else if (levels > 1) {
    $('invite-reward-preview').textContent = '将生成 ' + levels + ' 层、约 ' + total + ' 人并逐笔结算。首层：' +
      sim.describeNextInvite(id);
  } else if (count > 1) {
    $('invite-reward-preview').textContent = '将依次邀请 ' + count + ' 人并各自结算。' + sim.describeNextInvite(id);
  } else {
    $('invite-reward-preview').textContent = sim.describeNextInvite(id);
  }
  $('invite-submit').textContent = markOnly
    ? (count > 1 ? '确认仅标记 ' + count + ' 人' : '确认仅标记')
    : (total > 1 ? '确认邀请约 ' + total + ' 人并模拟下单' : '确认邀请并模拟下单');
  $('invite-submit').disabled = false;
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
  if (event.target.closest('[data-delete]')) return;
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
$('agent-level').addEventListener('change', event => {
  sim.setAgentLevel(selectedId, event.target.value);
  renderUser();
  renderTree();
});

$('node-save-time').addEventListener('click', () => {
  const user = sim.get(selectedId);
  const ms = parseDatetimeLocal($('node-joined-at').value);
  if (ms == null) { showToast('请填写有效时间'); return; }
  // datetime-local 只到分钟：与原时间同一分钟视为未修改，避免秒级差异引起无意义重排。
  const current = user.marketMarked && !user.joined ? user.marketMarkedAt : user.joinedAt;
  if (current != null && msToDatetimeLocal(current) === msToDatetimeLocal(ms)) { showToast('时间未变化'); return; }
  try {
    if (user.marketMarked && !user.joined) {
      user.marketMarkedAt = ms;
      showToast(selectedId + ' 标记时间已更新');
    } else {
      sim.setJoinedAt(selectedId, ms);
      showToast(selectedId + ' 入团时间已保存并重排同级');
    }
    renderAll();
  } catch (error) { showToast(error.message); }
});

$('node-mark').addEventListener('click', () => {
  try {
    const created = sim.addMarkedUser(selectedId);
    selectUser(created.id);
    showToast(created.id + ' 已仅标记（未入团）');
    renderAll();
  } catch (error) { showToast(error.message); }
});

$('node-unmark').addEventListener('click', () => {
  try {
    const id = selectedId;
    const fallback = sim.get(id).referrerId || ROOT_ID;
    sim.clearMarketMark(id);
    if (selectedId === id) selectedId = fallback;
    showToast(id + ' 已取消仅标记');
    renderAll();
  } catch (error) { showToast(error.message); }
});

$('node-join').addEventListener('click', () => {
  try {
    const at = parseDatetimeLocal($('node-joined-at').value);
    const order = sim.joinMarkedUser(selectedId, at);
    showToast(order.buyerId + ' 已模拟入团 · 扣款 199 · 奖金已结算');
    renderAll();
  } catch (error) { showToast(error.message); }
});

$('rate-save').addEventListener('click', () => {
  try {
    const partial = {};
    document.querySelectorAll('[data-rate-key]').forEach(input => {
      partial[input.dataset.rateKey] = input.value;
    });
    sim.setRewardRates(partial);
    syncRateInputs();
    renderUser();
    showToast('奖金比例已保存，之后新订单按新比例结算');
  } catch (error) {
    $('rate-ops-hint').textContent = error.message;
    showToast(error.message);
  }
});

$('rate-reset').addEventListener('click', () => {
  sim.setRewardRates(DEFAULT_REWARD_RATES);
  syncRateInputs();
  renderUser();
  $('rate-ops-hint').textContent = '已恢复默认比例；之后新订单按默认结算。';
  showToast('已恢复默认奖金比例');
});

$('tree').addEventListener('click', event => {
  const remove = event.target.closest('[data-delete]');
  if (remove) { openDeleteDialog(remove.dataset.delete); return; }
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
  $('invite-referrer').innerHTML = referrerOptions();
  // 当前选中未入团则退回根；V2 允许选中复投点作为挂点推荐人。
  const picked = sim.get(selectedId);
  const allowReentryPick = sim.slideMode === 'ternary_biz_v2' && picked?.reentry;
  $('invite-referrer').value = picked && picked.joined && (!picked.reentry || allowReentryPick)
    ? selectedId
    : ROOT_ID;
  $('invite-name').value = '';
  $('invite-count').value = '1';
  $('invite-levels').value = '1';
  $('invite-mark-only').checked = false;
  updateInvitePreview();
  $('invite-dialog').showModal();
  $('invite-count').focus();
});
$('invite-close').addEventListener('click', () => $('invite-dialog').close());
$('invite-referrer').addEventListener('change', updateInvitePreview);
$('invite-mark-only').addEventListener('change', updateInvitePreview);
$('invite-count').addEventListener('input', updateInvitePreview);
$('invite-levels').addEventListener('input', updateInvitePreview);
$('invite-name').addEventListener('input', () => { $('invite-error').hidden = true; });
$('invite-form').addEventListener('submit', event => {
  event.preventDefault();
  const submit = $('invite-submit');
  if (submit.disabled || !$('invite-dialog').open) return;
  submit.disabled = true;
  try {
    const referrerId = $('invite-referrer').value;
    const count = inviteCount();
    const levels = inviteLevels();
    if (count == null) throw new Error('每层人数须为 1–20 的整数。');
    if (levels == null) throw new Error('向下层数须为 1–5 的整数。');
    const markOnly = $('invite-mark-only').checked;
    if (markOnly && levels > 1) throw new Error('仅标记模式只支持 1 层。');
    const total = projectedInviteTotal(count, levels);
    if (total > MAX_BATCH_INVITES) {
      throw new Error('预计新增 ' + total + ' 人，超过上限 ' + MAX_BATCH_INVITES + '，请减小人数或层数。');
    }
    const customName = count === 1 && levels === 1 ? $('invite-name').value : '';
    const created = [];
    let frontier = [referrerId];
    for (let level = 0; level < levels; level++) {
      const next = [];
      for (const parent of frontier) {
        for (let i = 0; i < count; i++) {
          const name = level === 0 && i === 0 ? customName : '';
          if (markOnly) {
            const id = sim.addMarkedUser(parent, name).id;
            created.push(id);
            next.push(id);
          } else {
            const id = sim.addUser(parent, name).buyerId;
            created.push(id);
            next.push(id);
          }
        }
      }
      frontier = next;
    }
    selectedId = referrerId;
    page = 0;
    $('invite-dialog').close();
    renderAll();
    const preview = created.length <= 8 ? created.join('、') : created.slice(0, 6).join('、') + '…等 ' + created.length + ' 人';
    showToast(markOnly
      ? (created.length === 1 ? created[0] + ' 已仅标记（未入团）' : '已仅标记 ' + created.length + ' 人：' + preview)
      : (created.length === 1
        ? created[0] + ' 已加入 · 模拟扣款 199 元 · 奖金已结算'
        : '已邀请 ' + created.length + ' 人（' + levels + ' 层 × 每层 ' + count + '）· ' + preview +
          ' · 共模拟扣款 ' + money(PRICE * created.length)));
  } catch (error) {
    $('invite-error').textContent = error.message;
    $('invite-error').hidden = false;
  } finally { submit.disabled = false; }
});
$('reset-open').addEventListener('click', () => $('reset-dialog').showModal());
$('reset-cancel').addEventListener('click', () => $('reset-dialog').close());
$('reset-confirm').addEventListener('click', () => {
  softResetSimulation(sim.slideMode || 'binary');
  $('reset-dialog').close();
  renderAll();
  resetTreePan();
  showToast('已恢复初始账号张三，可以重新开始模拟。');
});
$('slide-mode').addEventListener('change', event => {
  const raw = event.target.value;
  const next = raw === 'ternary' || raw === 'ternary_biz' || raw === 'ternary_biz_v2' || raw === 'left' || raw === 'alternate' ? raw : 'binary';
  if (next === (sim.slideMode || 'binary')) return;
  softResetSimulation(next);
  renderAll();
  resetTreePan();
  const toast = next === 'binary'
    ? '已切换为二二复制+双轨邀请（模拟已重置）'
    : next === 'ternary'
      ? '已切换为三三复制+三轨邀请（模拟已重置）'
      : next === 'ternary_biz'
        ? '已切换为三三纯商业版（扶持区邀请 · 左下复投计团，模拟已重置）'
        : next === 'ternary_biz_v2'
          ? '已切换为三三复制商业V2（L/R帮扶滑落 · 复投可挂点，模拟已重置）'
          : next === 'alternate'
            ? '已切换为试验版：左右轮换（邀请仍挂本人，模拟已重置）'
            : '已切换为左链对照（第3人进扶持区，模拟已重置）';
  showToast(toast);
});
renderAll();
