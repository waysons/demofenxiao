'use strict';

// 与后端 distRewardRules.settleCountedJoin / applyReentries 同一套口径。金额用整数分，显示时再换成元。
const PRICE = 19900;
const ROOT_ID = '张三';
const ORDER_LAYERS = 8;
const REENTRY_LIMIT = 100;
const REWARD_NAMES = {
  direct: '直推奖', group: '拼团奖', order: '订单奖', management: '管理奖',
  agent_county: '县级代理奖', agent_city: '市级代理奖', agent_province: '省级代理奖'
};
// 默认比例；实例可改，只影响之后新订单（删除重放按订单快照）。
const DEFAULT_REWARD_RATES = {
  direct: 25, group: 20, order: 15, management: 8,
  agent_county: 3, agent_city: 6, agent_province: 9
};
// 兼容旧 UI/测试：指向默认表；运行中请用 sim.rates。
const REWARD_RATES = DEFAULT_REWARD_RATES;
const AGENT_LEVELS = { '': '无', county: '县级代理', city: '市级代理', province: '省级代理' };
const AGENT_NAMES = { county: '县级', city: '市级', province: '省级' };
const RATE_KEYS = Object.keys(DEFAULT_REWARD_RATES);

class Simulation {
  constructor() {
    this.users = new Map();
    this.orders = [];
    this.nextOrderId = 1;
    this.nameCounters = new Map();
    this.rates = { ...DEFAULT_REWARD_RATES };
    // 真人入团单调序号：订单奖「第 3 名扶持区」按入团先后判定。
    this.joinSeq = 0;
    // 滑落版本：binary=二二；ternary=三三对照；ternary_biz=纯商业左下复投计团；ternary_biz_v2=商业V2 L/R DFS；left/alternate。
    this.slideMode = 'binary';
    // alternate 模式下：0=左链最底，1=右链最底；每次落一张后翻转。
    this.slideSide = 0;
    const root = this.makeUser(ROOT_ID, null, 0);
    root.joined = true;
    root.joinedAt = 0;
    root.joinSeq = 0;
    root.spent = 0;
    this.users.set(ROOT_ID, root);
  }

  makeUser(id, referrerId, depth) {
    return {
      id, userId: id, referrerId, inviteReferrerId: referrerId, depth, round: 1, children: [], markedChildren: [], agentLevel: '',
      reentry: false, countsForGroup: false, exited: false, reentered: false,
      joined: false, joinedAt: null, joinSeq: null, marketMarked: false, marketMarkedAt: null,
      teamSize: 1, groupAwarded: false, groupBonusCents: 0, managementAwarded: false,
      spent: 0, maxDownlineDepth: 0,
      wallet: {
        direct: 0, group: 0, order: 0, management: 0,
        agent_county: 0, agent_city: 0, agent_province: 0
      }
    };
  }

  get(id) { return this.users.get(id); }
  income(id) { return Object.values(this.get(id).wallet).reduce((sum, value) => sum + value, 0); }

  // 当前席位上的已入团真人（按入团顺序固定，不换位）。
  realChildren(id) {
    const user = this.get(id);
    return user
      ? user.children.filter(childId => {
          const child = this.get(childId);
          return child && !child.reentry && child.joined;
        })
      : [];
  }

  // 邀请侧直推（按入团序）：双轨下第 3 人可挂在别人树上，但仍算邀请人的直推。
  inviteOrderedRealChildren(id) {
    return [...this.users.values()]
      .filter(member => member.joined && !member.reentry && member.inviteReferrerId === id)
      .sort((left, right) => (left.joinSeq || 0) - (right.joinSeq || 0) || String(left.id).localeCompare(String(right.id)))
      .map(member => member.id);
  }

  role(id) {
    const user = this.get(id);
    if (!user) return '普通';
    if (user.reentry) return '复投';
    // 团长按邀请直推满 3（双轨滑落不挡升级）
    return this.inviteOrderedRealChildren(id).length >= 3 ? '团长' : '普通';
  }

  // 二二复制：本人树最多挂 2 真人，第 3 人起滑到空位。
  usesBinaryInvite() {
    return this.slideMode === 'binary';
  }

  // 三三复制对照：本人树最多挂 3 真人，第 4 人起滑到空位。
  usesTernaryInvite() {
    return this.slideMode === 'ternary';
  }

  // 三三纯商业版：邀请同 left（第 3+ 进本人扶持区）；复投左下且可计团。
  usesTernaryBiz() {
    return this.slideMode === 'ternary_biz';
  }

  usesTernaryBizV2() {
    return this.slideMode === 'ternary_biz_v2';
  }

  // 纯商业 / V2：成团计数可含 countsForGroup 复投
  usesBizGroupCount() {
    return this.usesTernaryBiz() || this.usesTernaryBizV2();
  }

  // 宽轨邀请（二二/三三对照）：挂点由 Open 算法决定，而非第 3 人进本人扶持区。
  usesWideInvite() {
    return this.usesBinaryInvite() || this.usesTernaryInvite();
  }

  // 成团计数下级：默认仅真人；纯商业版另含 countsForGroup 的复投。
  groupCountedChildren(id) {
    if (!this.usesBizGroupCount()) return this.realChildren(id);
    const user = this.get(id);
    if (!user) return [];
    return user.children.filter(childId => {
      const child = this.get(childId);
      if (!child || !child.joined) return false;
      if (!child.reentry) return true;
      return !!child.countsForGroup;
    });
  }

  // 成团：严格 1+2+4；计数用 groupCountedChildren（商业版复投可凑叶）。
  isGroupComplete(id) {
    const user = this.get(id);
    if (!user || user.reentry || !user.joined) return false;
    const branches = this.groupCountedChildren(id);
    if (branches.length < 2) return false;
    const [b1, b2] = branches;
    return this.groupCountedChildren(b1).length >= 2 && this.groupCountedChildren(b2).length >= 2;
  }

  subtreeOrders(id) { return this.get(id).teamSize - 1; }

  // 原号最新复投点（round 最大）；无则返回 null。
  latestReentryId(ownerId) {
    let best = null;
    let bestRound = 0;
    for (const member of this.users.values()) {
      if (!member.reentry || member.userId !== ownerId) continue;
      const round = member.round || 0;
      if (round >= bestRound) {
        bestRound = round;
        best = member.id;
      }
    }
    return best;
  }

  // parentId 可为复投点（纯商业版挂复投支时按挂点深度取名）。
  nextName(parentId) {
    const parent = this.get(parentId);
    if (!parent) throw new Error('直接推荐人不存在。');
    let n = parent.depth + 1;
    let prefix = '';
    while (n > 0) {
      n--;
      prefix = String.fromCharCode(65 + n % 26) + prefix;
      n = Math.floor(n / 26);
    }
    return prefix + ((this.nameCounters.get(prefix) || 0) + 1);
  }

  ancestors(startId, parentKey) {
    const result = [];
    let current = this.get(startId);
    while (current) {
      result.push(current);
      current = this.get(current[parentKey]);
    }
    return result;
  }

  placeChild(parent, childId) {
    const buyer = this.get(childId);
    const rest = parent.children.filter(item => item !== childId);
    if (this.usesBizGroupCount()) {
      // 商业版：计团复投与真人同列；不计团复投仍在扶持区之后
      const counted = [];
      const support = [];
      for (const id of rest) {
        const node = this.get(id);
        if (node?.reentry && !node.countsForGroup) support.push(id);
        else counted.push(id);
      }
      if (buyer?.reentry && !buyer.countsForGroup) support.push(childId);
      else counted.push(childId);
      parent.children = [...counted, ...support];
      return;
    }
    const real = rest.filter(item => !this.get(item)?.reentry);
    const slides = rest.filter(item => this.get(item)?.reentry);
    if (buyer?.reentry) slides.push(childId);
    else real.push(childId);
    // 真人占前两席（L/R），复投始终排在真人之后（扶持区），绝不与左右位对换
    parent.children = [...real, ...slides];
  }

  // 席位：0=L，1=R，2=扶持区；商业版计团复投可占 L/R。
  childSlot(parentId, childId) {
    const parent = this.get(parentId);
    const child = this.get(childId);
    if (!parent || !child?.joined) return null;
    if (child.reentry && !child.countsForGroup) return 2;
    const index = this.groupCountedChildren(parentId).indexOf(childId);
    if (index >= 0) return Math.min(2, index);
    if (child.reentry) return 2;
    const realIndex = this.realChildren(parentId).indexOf(childId);
    return realIndex < 0 ? null : Math.min(2, realIndex);
  }

  // 树展示：左右位给成团计数前两席；仅 1 席却有扶持/复投时插入空右位。
  treeDisplayChildren(id) {
    const user = this.get(id);
    if (!user) return [];
    const counted = this.groupCountedChildren(id);
    const lr = counted.slice(0, 2);
    const supportCounted = counted.slice(2);
    const supportSlides = user.children.filter(childId => {
      const child = this.get(childId);
      return child?.reentry && !child.countsForGroup;
    });
    const marked = user.markedChildren || [];
    const result = [...lr];
    if (lr.length === 1 && (supportSlides.length > 0 || supportCounted.length > 0)) result.push(null);
    result.push(...supportCounted, ...supportSlides, ...marked);
    return result;
  }

  groupMemberIds(id) {
    const user = this.get(id);
    if (!user || !user.joined) return [];
    if (user.reentry) return [user.id];
    const result = [user.id];
    const seen = new Set([user.id]);
    for (const branchId of this.groupCountedChildren(id).slice(0, 2)) {
      if (seen.has(branchId)) continue;
      seen.add(branchId);
      result.push(branchId);
      for (const leafId of this.groupCountedChildren(branchId).slice(0, 2)) {
        if (seen.has(leafId)) continue;
        seen.add(leafId);
        result.push(leafId);
      }
    }
    return result;
  }

  groupProgress(id) { return this.groupMemberIds(id).length; }

  setSlideMode(mode) {
    if (mode !== 'binary' && mode !== 'ternary' && mode !== 'ternary_biz' && mode !== 'ternary_biz_v2' && mode !== 'left' && mode !== 'alternate') {
      throw new Error('滑落版本须为 binary、ternary、ternary_biz、ternary_biz_v2、left 或 alternate');
    }
    this.slideMode = mode;
    this.slideSide = 0;
    return this.slideMode;
  }

  // side: 0=左链，1=右链。沿该侧真人往下，停在没有该侧已入团真人子节点处。
  sidemostOpen(id, side = 0) {
    const preferRight = Number(side) === 1;
    let node = this.get(id);
    const seen = new Set();
    while (node && !seen.has(node.id)) {
      if (node.reentry) throw new Error('复投点不能作为滑落落点');
      seen.add(node.id);
      const reals = this.realChildren(node.id).filter(childId => this.get(childId)?.joined);
      const nextId = preferRight ? reals[1] : reals[0];
      if (!nextId) return node;
      node = this.get(nextId);
    }
    throw new Error('拼团滑落链存在循环');
  }

  // 左链最底挂复投（对照旧口径）。
  leftmostOpen(id) { return this.sidemostOpen(id, 0); }

  // 宽轨 BFS：从上到下、从左到右，找第一个真人直推未满 width 的节点。
  // 复投仍进扶持区、不占 L/R、不计入七人团；只改「挂在谁下面」。
  wideOpen(id, width, label) {
    const start = this.get(id);
    if (!start) throw new Error('滑落起点不存在');
    if (start.reentry) throw new Error('复投点不能作为滑落落点');
    const queue = [start];
    const seen = new Set();
    while (queue.length) {
      const node = queue.shift();
      if (!node || seen.has(node.id)) continue;
      seen.add(node.id);
      if (node.reentry) continue;
      const reals = this.realChildren(node.id).filter(childId => this.get(childId)?.joined);
      if (reals.length < width) return node;
      for (const childId of reals.slice(0, width)) {
        const child = this.get(childId);
        if (child && !seen.has(child.id)) queue.push(child);
      }
    }
    throw new Error(label + '滑落未找到空位');
  }

  // 二二复制：宽度 2。
  binaryOpen(id) { return this.wideOpen(id, 2, '二二复制'); }

  // 三三复制对照：宽度 3。
  ternaryOpen(id) { return this.wideOpen(id, 3, '三三复制'); }

  // V2：L/R 宽 2，DFS 先左支向下再右（先上下、再左右）
  groupSlotOpen(id) {
    const start = this.get(id);
    if (!start) throw new Error('滑落起点不存在');
    const self = this;
    function dfs(node) {
      if (!node) return null;
      const counted = self.groupCountedChildren(node.id);
      if (counted.length < 2) return node;
      // 支层（相对起点深度≥1）L/R 已满则不再往叶层钻，交给 DFS 下一同级支
      if (node.depth - start.depth >= 1) return null;
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

  // 按当前滑落版本解析复投挂点。
  findSlideParent(exitedId) {
    if (this.slideMode === 'binary') return this.binaryOpen(exitedId);
    if (this.slideMode === 'ternary') return this.ternaryOpen(exitedId);
    if (this.slideMode === 'ternary_biz_v2') return this.groupSlotOpen(exitedId);
    // ternary_biz / left：最左下方
    if (this.slideMode === 'ternary_biz' || this.slideMode === 'left') {
      return this.leftmostOpen(exitedId);
    }
    let side = 0;
    if (this.slideMode === 'alternate') {
      side = this.slideSide;
      this.slideSide = 1 - this.slideSide;
    }
    return this.sidemostOpen(exitedId, side);
  }

  setAgentLevel(id, level) {
    if (!Object.prototype.hasOwnProperty.call(AGENT_LEVELS, level)) throw new Error('代理等级无效。');
    const user = this.get(id);
    if (!user) throw new Error('该账号不存在。');
    if (user.reentry) throw new Error('复投点不能设置代理等级。');
    user.agentLevel = level;
    return user;
  }

  // 修改奖金比例，只影响之后新订单；已记流水不回改。删除重放按订单快照。
  setRewardRates(partial = {}) {
    const next = { ...this.rates };
    for (const key of RATE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(partial, key)) continue;
      const value = Number(partial[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(REWARD_NAMES[key] + ' 比例须在 0–100 之间。');
      }
      next[key] = Math.round(value * 100) / 100;
    }
    this.rates = next;
    return { ...this.rates };
  }

  snapshotRates() { return { ...this.rates }; }

  percentCents(rate) {
    const cents = Math.round(PRICE * rate / 100);
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('奖金金额无效');
    return cents;
  }

  needsRepurchase() { return false; }

  repurchase() { throw new Error('当前规则不暂停邀请，无需复购。'); }

  describeNextInvite(referrerId) {
    const referrer = this.get(referrerId);
    if (!referrer) return '请先选择推荐人。';
    if (referrer.reentry) return '复投点不能再邀请下级。请改选真人推荐人。';
    const invitePos = this.inviteOrderedRealChildren(referrerId).length + 1;
    const rates = this.rates;
    const direct = this.percentCents(rates.direct);
    let zone;
    if (this.usesBinaryInvite()) {
      zone = this.realChildren(referrerId).length < 2
        ? '左右位（挂在本人树下），计入该推荐人的七人团'
        : '双轨滑落：本人左右已满，新人挂到团队内第一个真人未满 2 的空位（占落点 L/R，帮落点凑 1+2+4）';
    } else if (this.usesTernaryInvite()) {
      const treeCount = this.realChildren(referrerId).length;
      zone = treeCount < 3
        ? (treeCount < 2
          ? '左右位（挂在本人树下），计入该推荐人的七人团'
          : '本人第 3 支（树上挂点，对本人仍属扶持区、不计七人团）')
        : '三轨滑落：本人树已满 3，新人挂到团队内第一个真人未满 3 的空位';
    } else if (this.usesTernaryBiz()) {
      const reId = this.latestReentryId(referrerId);
      if (reId && invitePos >= 4) {
        const under = this.realChildren(reId).length;
        zone = under < 2
          ? '第 4 人起挂在复投点 ' + reId + ' 拼团区'
          : '第 4 人起挂在复投点 ' + reId + ' 扶持区';
      } else {
        zone = invitePos <= 2
          ? '左右位，计入该推荐人的七人团'
          : '扶持区（第 3 人不滑落），不计入该推荐人自己的七人团';
      }
    } else {
      // left / alternate：第 3+ 进本人扶持区
      zone = invitePos <= 2 ? '左右位，计入该推荐人的七人团' : '扶持区，不计入该推荐人自己的七人团';
    }
    const orderNote = invitePos === 2
      ? '这是第 2 名直推，会从该推荐人的直接上级向上最多 8 层找订单奖：落在某上级第 3 名及以后邀请分支才发实付的 ' + rates.order + '%；若付款前支线根已是团长（邀请直推满 3）则截流不再向上。'
      : invitePos === 1
        ? '第 1 名直推不触发订单奖。'
        : '第 3 名及以后本身不发订单奖。等这位成员自己邀到第 2 名直推时，才可能沿上级链发订单奖。';
    const slideNote = this.slideMode === 'binary'
      ? '成团后按二二复制找空位滑落 1 张复投（复投进扶持区，不计入七人团、不发直推奖、不占左右位）'
      : this.slideMode === 'ternary'
        ? '成团后按三三复制找空位滑落 1 张复投（复投进扶持区，不计入七人团、不发直推奖、不占左右位）'
        : this.slideMode === 'ternary_biz'
          ? '成团后复投滑到最左下方并可计团；第 3 人仍进原号扶持区，第 4 人起才挂到最新复投点分支下'
          : this.slideMode === 'alternate'
            ? '成团后按左右轮换滑落 1 张复投（复投进扶持区，不计入七人团、不发直推奖、不占左右位）'
            : '成团后向左链最底滑落 1 张复投（复投进扶持区，不计入七人团、不发直推奖、不占左右位）';
    return '第 ' + invitePos + ' 位邀请直推（' + zone + '）。推荐人获得直推奖 ' + (direct / 100).toFixed(2) +
      ' 元。' + orderNote + ' 七人团须严格 1+2+4 才发一次拼团奖（' + rates.group + '%），' + slideNote +
      '。邀请直推满 3 人即为团长。双方都是团长后，按该下级拼团奖的 ' + rates.management + '% 给邀请上级一次管理奖。';
  }

  snapshotAgentLevels() {
    return Object.fromEntries([...this.users].filter(([, member]) => member.agentLevel && !member.reentry).map(([memberId, member]) => [memberId, member.agentLevel]));
  }

  payOn(order, recipient, type, cents, note, sourceId) {
    if (!recipient || recipient.reentry || cents <= 0) return;
    recipient.wallet[type] += cents;
    order.payouts.push({ userId: recipient.id, type, cents, note, ...(sourceId ? { sourceId } : {}) });
  }

  settleGroup(candidates, progressBefore, pay, sourceId) {
    const completed = [];
    const groupBonus = this.percentCents(this.rates.group);
    for (const candidate of candidates) {
      if (candidate.reentry || candidate.groupAwarded) continue;
      if (!this.isGroupComplete(candidate.id)) continue;
      candidate.groupAwarded = true;
      candidate.groupBonusCents = groupBonus;
      completed.push(candidate.id);
      pay(candidate, 'group', groupBonus, '首次完成七人团 · 实付 × ' + this.rates.group + '%', sourceId);
    }
    return completed;
  }

  settleManagement(candidates, pay) {
    const sources = new Set(candidates.flatMap(item => [item.id, ...item.children]));
    for (const sourceId of sources) {
      const source = this.get(sourceId);
      // 管理奖发给邀请上级（双轨下滑落挂点可能不是邀请人）
      const parentId = source?.inviteReferrerId || source?.referrerId;
      const parent = parentId ? this.get(parentId) : null;
      if (!source || source.reentry || source.managementAwarded || !parent || parent.reentry) continue;
      if (this.role(sourceId) === '团长' && this.role(parent.id) === '团长' && source.groupBonusCents > 0) {
        source.managementAwarded = true;
        const cents = Math.round(source.groupBonusCents * this.rates.management / 100);
        pay(parent, 'management', cents,
          sourceId + ' 与邀请人 ' + parent.id + ' 均已成为团长 · 拼团奖 × ' + this.rates.management + '%', sourceId);
      }
    }
  }

  settleAgents(ancestors, pay, sourceId) {
    for (const ancestor of ancestors) {
      if (ancestor.reentry) continue;
      const tier = ancestor.agentLevel;
      if (!['county', 'city', 'province'].includes(tier)) continue;
      const rate = this.rates['agent_' + tier];
      pay(ancestor, 'agent_' + tier, this.percentCents(rate),
        AGENT_NAMES[tier] + '代理奖 · 实付 × ' + rate + '%', sourceId);
    }
  }

  // nameParentId：自动取名时用的挂点（纯商业成团后为最新复投点）。
  _resolveInviteId(referrerId, requestedId, nameParentId = null) {
    const referrer = this.get(referrerId);
    if (!referrer) throw new Error('直接推荐人不存在，请重新选择。');
    if (referrer.reentry) throw new Error('复投点不能再邀请下级。');
    if (!referrer.joined) throw new Error('推荐人尚未入团，请先模拟购买入团后再邀请或标记下级。');
    const nameFrom = nameParentId || referrerId;
    const id = requestedId.trim().toUpperCase() || this.nextName(nameFrom);
    if (!/^[A-Z]{1,8}[1-9]\d{0,5}$/.test(id)) {
      throw new Error('账号格式为大写字母组 + 正整数，例如 B1、C12；最多 8 位字母和 6 位数字。');
    }
    if (this.users.has(id)) throw new Error('该账号已存在，请使用其他名称。');
    return { referrer, id };
  }

  // 纯商业版：有复投后，第 1–3 人仍挂原号（第 3=扶持区）；第 4 人起才挂最新复投点。
  resolveInviteHost(inviteReferrerId) {
    const referrer = this.get(inviteReferrerId);
    if (!referrer) throw new Error('直接推荐人不存在，请重新选择。');
    if (this.usesTernaryBiz()) {
      const reentryId = this.latestReentryId(inviteReferrerId);
      const nextPos = this.inviteOrderedRealChildren(inviteReferrerId).length + 1;
      if (reentryId && nextPos >= 4) return this.get(reentryId);
    }
    return referrer;
  }

  addMarkedUser(referrerId, requestedId = '') {
    const host = this.resolveInviteHost(referrerId);
    const { referrer, id } = this._resolveInviteId(referrerId, requestedId, host.id);
    // 树上挂点与入团邀请一致（成团后挂复投点）；邀请关系仍记原号
    const user = this.makeUser(id, host.id, host.depth + 1);
    user.inviteReferrerId = referrerId;
    user.marketMarked = true;
    user.marketMarkedAt = this._defaultJoinAt ?? (this._defaultJoinAt = Date.now());
    host.markedChildren = host.markedChildren || [];
    host.markedChildren.push(id);
    this.users.set(id, user);
    const [, prefix, suffix] = id.match(/^([A-Z]+)(\d+)$/);
    this.nameCounters.set(prefix, Math.max(this.nameCounters.get(prefix) || 0, Number(suffix)));
    return user;
  }

  clearMarketMark(id) {
    const user = this.get(id);
    if (!user) throw new Error('该账号不存在。');
    if (!user.marketMarked) throw new Error('该节点未仅标记。');
    const parent = user.referrerId ? this.get(user.referrerId) : null;
    if (parent) parent.markedChildren = parent.markedChildren.filter(item => item !== id);
    user.marketMarked = false;
    user.marketMarkedAt = null;
    if (!user.joined) this.users.delete(id);
    return user;
  }

  joinMarkedUser(id, joinedAtMs) {
    const user = this.get(id);
    if (!user) throw new Error('该账号不存在。');
    if (!user.marketMarked || user.joined) throw new Error('须为已标记且未入团的节点。');
    const referrerId = user.referrerId;
    const parent = this.get(referrerId);
    if (parent) parent.markedChildren = parent.markedChildren.filter(item => item !== id);
    this.users.delete(id);
    const options = joinedAtMs != null ? { joinedAt: joinedAtMs } : {};
    return this.addUser(referrerId, id, options);
  }

  // 改时间仅更新展示与重放快照，不触发换位、不重发奖。
  setJoinedAt(id, ms) {
    const user = this.get(id);
    if (!user) throw new Error('该账号不存在。');
    if (user.reentry) throw new Error('复投点不能改购买时间。');
    if (!user.joined) throw new Error('未入团节点请改标记时间。');
    user.joinedAt = ms;
    const own = this.orders.find(order => order.type !== 'reentry' && order.buyerId === id);
    if (own) own.joinedAt = ms;
    return user;
  }

  addUser(referrerId, requestedId = '', options = {}) {
    const inviteReferrerId = referrerId;
    // 先解析挂点（纯商业：第 4 人起 → 最新复投点），再取名
    let hostPreview = this.resolveInviteHost(inviteReferrerId);
    const { referrer, id } = this._resolveInviteId(referrerId, requestedId, hostPreview.id);
    const previousInviteCount = this.inviteOrderedRealChildren(inviteReferrerId).length;

    // 宽轨邀请：二二最多 2 / 三三最多 3；满则 BFS 找空位。对照 left/alternate 仍第 3+ 进本人扶持区。
    // 纯商业：有复投后第 1–3 挂原号，第 4 人起挂最新复投点。
    let host = referrer;
    let slid = false;
    if (this.usesBinaryInvite()) {
      host = this.binaryOpen(inviteReferrerId);
      slid = host.id !== inviteReferrerId;
    } else if (this.usesTernaryInvite()) {
      host = this.ternaryOpen(inviteReferrerId);
      slid = host.id !== inviteReferrerId;
    } else if (this.usesTernaryBiz()) {
      host = this.resolveInviteHost(inviteReferrerId);
    }

    const positionAncestors = this.ancestors(host.id, 'referrerId');
    const inviteAncestors = this.ancestors(inviteReferrerId, 'inviteReferrerId');
    const user = this.makeUser(id, host.id, host.depth + 1);
    user.inviteReferrerId = inviteReferrerId;
    const candidates = [user, ...positionAncestors];
    const progressBefore = new Map(positionAncestors.map(item => [item.id, this.groupProgress(item.id)]));
    const leaderBefore = new Map(inviteAncestors.map(item => [item.id, this.role(item.id) === '团长']));
    const rates = this.snapshotRates();
    const order = {
      id: this.nextOrderId++, buyerId: id, referrerId: inviteReferrerId, positionParentId: host.id,
      position: 0, zone: 'group', cents: PRICE, payouts: [],
      agentLevels: this.snapshotAgentLevels(), prizeRates: rates, reentryIds: [],
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    };

    this.users.set(id, user);
    this.placeChild(host, id);
    user.joined = true;
    user.joinSeq = ++this.joinSeq;
    user.marketMarked = false;
    user.marketMarkedAt = null;
    if (options.joinedAt != null) user.joinedAt = options.joinedAt;
    else if (user.joinedAt == null) user.joinedAt = this._defaultJoinAt ?? (this._defaultJoinAt = Date.now());
    order.joinedAt = user.joinedAt;
    order.joinSeq = user.joinSeq;

    const invitePosition = previousInviteCount + 1;
    const treeSlot = this.realChildren(host.id).indexOf(id);
    let zone;
    if (slid) zone = this.usesTernaryInvite() ? 'ternary_slide' : 'binary_slide';
    // 纯商业：区席按挂点树位（成团后挂复投支时不能用原号邀请序号）
    else if (this.usesTernaryBiz()) zone = treeSlot < 2 ? 'group' : 'support';
    else if (!this.usesWideInvite() && invitePosition > 2) zone = 'support';
    else zone = treeSlot < 2 ? 'group' : 'support';
    order.position = invitePosition;
    order.zone = zone;
    user.spent = PRICE;
    const [, prefix, suffix] = id.match(/^([A-Z]+)(\d+)$/);
    this.nameCounters.set(prefix, Math.max(this.nameCounters.get(prefix) || 0, Number(suffix)));
    for (const ancestor of positionAncestors) {
      ancestor.teamSize++;
      ancestor.maxDownlineDepth = Math.max(ancestor.maxDownlineDepth, user.depth - ancestor.depth);
    }

    const pay = (recipient, type, cents, note, sourceId) => this.payOn(order, recipient, type, cents, note, sourceId);
    const underReentry = this.usesTernaryBiz() && host.reentry;
    const placeNote = slid
      ? (this.usesTernaryInvite() ? '（三轨滑落挂在 ' + host.id + '）' : '（双轨滑落挂在 ' + host.id + '）')
      : underReentry
        ? '（第 4 人起挂在复投点 ' + host.id + '）'
        : '';
    pay(referrer, 'direct', this.percentCents(rates.direct),
      '第 ' + invitePosition + ' 位直推 ' + id + placeNote + ' · 实付 × ' + rates.direct + '%');

    // 订单奖：按邀请链判定「第 2 名直推」与「是否第 3+ 邀请分支」
    if (previousInviteCount === 1) {
      let supportRoot = referrer;
      for (const ancestor of inviteAncestors.slice(1, ORDER_LAYERS + 1)) {
        if (leaderBefore.get(supportRoot.id)) break;
        const branch = this.inviteOrderedRealChildren(ancestor.id).indexOf(supportRoot.id);
        if (branch >= 2) {
          pay(ancestor, 'order', this.percentCents(rates.order),
            supportRoot.id + ' 的第 2 名直推触发订单奖 · 实付 × ' + rates.order + '%', id);
        }
        supportRoot = ancestor;
      }
    }

    this.settleAgents(positionAncestors, pay, id);
    const completed = this.settleGroup(candidates, progressBefore, pay, id);
    this.settleManagement(candidates, pay);
    this.orders.push(order);
    this.applyReentries(completed, order);
    return order;
  }

  applyReentries(completed, trigger) {
    const queue = [...completed];
    const created = new Set();
    let steps = 0;
    while (queue.length) {
      if (++steps > REENTRY_LIMIT) throw new Error('复投滑落连续超过上限，已停止结算');
      const exited = this.get(String(queue.shift()));
      if (!exited?.groupAwarded || exited.reentry || exited.reentered || created.has(exited.id)) continue;
      exited.exited = true;
      exited.reentered = true;
      const parent = this.findSlideParent(exited.id);
      const round = (exited.round || 1) + 1;
      const ownerId = exited.userId || exited.id;
      const positionId = ownerId + ':' + round;
      created.add(positionId);
      const reentryOrder = this.addReentry({ positionId, ownerId, round, parent, exited });
      if (trigger) trigger.reentryIds.push(positionId);
      queue.push(...reentryOrder.completed.filter(id => {
        const member = this.get(id);
        return member && !member.reentry && !member.reentered && !created.has(member.id);
      }));
    }
  }

  addReentry({ positionId, ownerId, round, parent, exited }) {
    if (parent.reentry) throw new Error('复投点不能挂下级');
    if (this.users.has(positionId)) throw new Error('复投点已存在');
    const user = this.makeUser(positionId, parent.id, parent.depth + 1);
    user.reentry = true;
    // 纯商业版：落点成团计数未满 2 时复投占拼团区并计团
    user.countsForGroup = this.usesBizGroupCount() && this.groupCountedChildren(parent.id).length < 2;
    user.userId = ownerId;
    user.round = round;
    user.joined = true;
    user.joinedAt = this._defaultJoinAt ?? (this._defaultJoinAt = Date.now());
    user.spent = PRICE;
    const ancestors = this.ancestors(parent.id, 'referrerId');
    const candidates = [user, ...ancestors];
    const progressBefore = new Map(ancestors.map(item => [item.id, this.groupProgress(item.id)]));
    const rates = this.snapshotRates();
    this.users.set(positionId, user);
    this.placeChild(parent, positionId);
    for (const ancestor of ancestors) {
      ancestor.maxDownlineDepth = Math.max(ancestor.maxDownlineDepth, user.depth - ancestor.depth);
    }
    const slot = this.childSlot(parent.id, positionId);
    const zone = user.countsForGroup && slot != null && slot < 2 ? 'group' : 'support';
    const order = {
      id: this.nextOrderId++, type: 'reentry', buyerId: positionId, ownerId, referrerId: parent.id,
      exitedId: exited.id, position: 0, zone, cents: PRICE, payouts: [], completed: [],
      agentLevels: this.snapshotAgentLevels(), prizeRates: rates,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    };
    const pay = (recipient, type, cents, note, sourceId) => this.payOn(order, recipient, type, cents, note, sourceId);
    // 不发直推奖/代理奖；商业版计团复投可触发落点成团。
    order.completed = this.settleGroup(candidates, progressBefore, pay, ownerId);
    this.settleManagement(candidates, pay);
    this.orders.push(order);
    return order;
  }

  branchIds(id) {
    if (!this.get(id)) throw new Error('该节点不存在。');
    const ids = [id];
    for (let index = 0; index < ids.length; index++) {
      const node = this.get(ids[index]);
      ids.push(...node.children, ...(node.markedChildren || []));
    }
    return ids;
  }

  deleteBranch(id) {
    const removedIds = this.branchIds(id);
    const removed = new Set(removedIds);
    const keptOrders = this.orders.filter(order => order.type !== 'reentry' && !removed.has(order.buyerId));
    const keptLevels = new Map([...this.users].filter(([userId, user]) => !removed.has(userId) && !user.reentry).map(([userId, user]) => [userId, user.agentLevel]));
    const orderCount = this.orders.filter(order => removed.has(order.buyerId)).length;
    const keptMarked = [...this.users.values()]
      .filter(user => user.marketMarked && !user.joined && !removed.has(user.id))
      .map(user => ({ id: user.id, referrerId: user.referrerId, markedAt: user.marketMarkedAt }));
    const savedCounters = new Map(this.nameCounters);
    const savedNextOrderId = this.nextOrderId;
    const savedRates = this.snapshotRates();
    const savedSlideMode = this.slideMode;
    const rebuilt = new Simulation();
    rebuilt.rates = { ...savedRates };
    rebuilt.setSlideMode(savedSlideMode);
    for (const previous of keptOrders) {
      if (previous.prizeRates) rebuilt.setRewardRates(previous.prizeRates);
      for (const [userId, level] of Object.entries(previous.agentLevels || {})) {
        const member = rebuilt.get(userId);
        if (member && !member.reentry) member.agentLevel = level;
      }
      const order = rebuilt.addUser(previous.referrerId, previous.buyerId,
        previous.joinedAt != null ? { joinedAt: previous.joinedAt } : {});
      order.id = previous.id;
      order.time = previous.time;
      order.agentLevels = previous.agentLevels || {};
      order.prizeRates = previous.prizeRates || rebuilt.snapshotRates();
    }
    rebuilt.setRewardRates(savedRates);
    for (const [userId, level] of keptLevels) {
      const member = rebuilt.get(userId);
      if (member && !member.reentry) member.agentLevel = level;
    }
    for (const mark of keptMarked) {
      const marked = rebuilt.addMarkedUser(mark.referrerId, mark.id);
      marked.marketMarkedAt = mark.markedAt;
    }
    if (id !== ROOT_ID) {
      rebuilt.nameCounters = savedCounters;
      const used = new Set(rebuilt.orders.filter(order => order.type !== 'reentry').map(order => order.id));
      let nextId = savedNextOrderId;
      for (const order of rebuilt.orders) {
        if (order.type !== 'reentry') continue;
        while (used.has(nextId)) nextId++;
        order.id = nextId;
        used.add(nextId);
        nextId++;
      }
      rebuilt.nextOrderId = nextId;
    }
    this.users = rebuilt.users;
    this.orders = rebuilt.orders;
    this.nameCounters = rebuilt.nameCounters;
    this.nextOrderId = rebuilt.nextOrderId;
    this.joinSeq = rebuilt.joinSeq;
    this.slideMode = rebuilt.slideMode;
    this.slideSide = rebuilt.slideSide;
    this.rates = rebuilt.rates;
    return { removedIds, orderCount };
  }
}
