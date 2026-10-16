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
const REWARD_RATES = {
  direct: 20, group: 15, order: 10, management: 8,
  agent_county: 3, agent_city: 6, agent_province: 9
};
const AGENT_LEVELS = { '': '无', county: '县级代理', city: '市级代理', province: '省级代理' };
const AGENT_NAMES = { county: '县级', city: '市级', province: '省级' };

class Simulation {
  constructor() {
    this.users = new Map();
    this.orders = [];
    this.nextOrderId = 1;
    this.nameCounters = new Map();
    const root = this.makeUser(ROOT_ID, null, 0);
    root.joined = true;
    root.joinedAt = 0;
    root.spent = 0;
    this.users.set(ROOT_ID, root);
  }

  makeUser(id, referrerId, depth) {
    return {
      id, userId: id, referrerId, depth, round: 1, children: [], markedChildren: [], agentLevel: '',
      reentry: false, exited: false, reentered: false,
      joined: false, joinedAt: null, marketMarked: false, marketMarkedAt: null,
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

  // 真人按邀请顺序占位。复投点只排在后面，不占左右位，也不算直推人数。
  realChildren(id) {
    const user = this.get(id);
    return user
      ? user.children.filter(childId => {
          const child = this.get(childId);
          return child && !child.reentry && child.joined;
        })
      : [];
  }

  // 团长：已入团真人直推满 3 人，与七人成团无关。复投点不能成为团长。
  role(id) {
    const user = this.get(id);
    if (!user) return '普通';
    if (user.reentry) return '复投';
    return this.realChildren(id).length >= 3 ? '团长' : '普通';
  }

  isGroupComplete(id) {
    const user = this.get(id);
    if (!user || user.reentry || !user.joined) return false;
    return this.groupProgress(id) >= 7 && this.realChildren(id).length >= 2;
  }

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

  subtreeOrders(id) { return this.get(id).teamSize - 1; }

  nextName(referrerId) {
    const parent = this.get(referrerId);
    if (!parent || parent.reentry) throw new Error('直接推荐人不存在。');
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

  // 真人在前，复投点永远排在扶持区末尾。
  placeChild(parent, childId) {
    const buyer = this.get(childId);
    const rest = parent.children.filter(item => item !== childId);
    const real = rest.filter(item => !this.get(item)?.reentry);
    const slides = rest.filter(item => this.get(item)?.reentry);
    if (buyer?.reentry) slides.push(childId);
    else real.push(childId);
    parent.children = [...real, ...slides];
  }

  // 本人 + 名下复投点 + 前两名真人直推各自整棵下级（含里面的复投点）。
  groupMemberIds(id) {
    const user = this.get(id);
    if (!user || !user.joined) return [];
    if (user.reentry) return [user.id];
    const result = [user.id];
    const seen = new Set([user.id]);
    const countReentries = node => {
      for (const childId of node.children) {
        const child = this.get(childId);
        if (!child?.reentry || !child.joined || seen.has(childId)) continue;
        seen.add(childId);
        result.push(childId);
      }
    };
    countReentries(user);
    const pending = this.realChildren(id).slice(0, 2);
    while (pending.length) {
      const childId = pending.pop();
      if (seen.has(childId)) continue;
      seen.add(childId);
      const child = this.get(childId);
      if (!child || child.reentry || !child.joined) continue;
      result.push(childId);
      countReentries(child);
      pending.push(...this.realChildren(childId));
    }
    return result;
  }

  groupProgress(id) { return this.groupMemberIds(id).length; }

  // 只沿真人左子点向下，停在没有真人左子的位置。复投点不能当落点。
  leftmostOpen(id) {
    let node = this.get(id);
    const seen = new Set();
    while (node && !seen.has(node.id)) {
      if (node.reentry) throw new Error('复投点不能作为滑落落点');
      seen.add(node.id);
      const leftId = this.realChildren(node.id).find(childId => this.get(childId)?.joined);
      if (!leftId) return node;
      node = this.get(leftId);
    }
    throw new Error('拼团左链存在循环');
  }

  setAgentLevel(id, level) {
    if (!Object.prototype.hasOwnProperty.call(AGENT_LEVELS, level)) throw new Error('代理等级无效。');
    const user = this.get(id);
    if (!user) throw new Error('该账号不存在。');
    if (user.reentry) throw new Error('复投点不能设置代理等级。');
    user.agentLevel = level;
    return user;
  }

  percentCents(rate) {
    const cents = Math.round(PRICE * rate / 100);
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('奖金金额无效');
    return cents;
  }

  // 八层只限制订单奖向上查找，不再暂停邀请。成团后的复投是自动滑落，不是复购门槛。
  needsRepurchase() { return false; }

  repurchase() { throw new Error('当前规则不暂停邀请，无需复购。'); }

  describeNextInvite(referrerId) {
    const referrer = this.get(referrerId);
    if (!referrer) return '请先选择推荐人。';
    if (referrer.reentry) return '复投点不能再邀请下级。请改选真人推荐人。';
    const position = this.realChildren(referrerId).length + 1;
    const direct = this.percentCents(REWARD_RATES.direct);
    const zone = position <= 2 ? '左右位，计入该推荐人的七人团' : '扶持区，不计入该推荐人自己的七人团';
    const orderNote = position === 2
      ? '这是第 2 名直推，会从该推荐人的直接上级向上最多 8 层找订单奖：落在某上级第 3 名及以后分支才发实付的 10%，左右位跳过并继续向上；付款前该上级或对应分支根已是团长则停止。'
      : position === 1
        ? '第 1 名直推不触发订单奖。'
        : '第 3 名及以后本身不发订单奖。等这位成员自己邀到第 2 名直推时，才可能沿上级链发扶持区订单奖。';
    return '第 ' + position + ' 位直推（' + zone + '）。推荐人获得直推奖 ' + (direct / 100).toFixed(2) +
      ' 元。' + orderNote + ' 七人团满 7 人且直推满 2 人发一次拼团奖，并立刻向左链最底滑落 1 张复投单：给落点发直推奖，算落点及其上级的 1 人，复投点落在扶持区且不能再邀请。真人直推满 3 人即为团长（与是否七人成团无关）。双方都是团长后，按该下级拼团奖的 8% 给直接上级一次管理奖。邀请不因层数暂停。';
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

  settleManagement(candidates, pay) {
    const sources = new Set(candidates.flatMap(item => [item.id, ...item.children]));
    for (const sourceId of sources) {
      const source = this.get(sourceId);
      const parent = source?.referrerId ? this.get(source.referrerId) : null;
      if (!source || source.reentry || source.managementAwarded || !parent || parent.reentry) continue;
      if (this.role(sourceId) === '团长' && this.role(parent.id) === '团长' && source.groupBonusCents > 0) {
        source.managementAwarded = true;
        const cents = Math.round(source.groupBonusCents * REWARD_RATES.management / 100);
        pay(parent, 'management', cents,
          sourceId + ' 与 ' + parent.id + ' 均已成为团长 · 拼团奖 × 8%', sourceId);
      }
    }
  }

  settleAgents(ancestors, pay, sourceId) {
    for (const ancestor of ancestors) {
      if (ancestor.reentry) continue;
      const tier = ancestor.agentLevel;
      if (!['county', 'city', 'province'].includes(tier)) continue;
      const rate = REWARD_RATES['agent_' + tier];
      pay(ancestor, 'agent_' + tier, this.percentCents(rate),
        AGENT_NAMES[tier] + '代理奖 · 实付 × ' + rate + '%', sourceId);
    }
  }

  _resolveInviteId(referrerId, requestedId) {
    const referrer = this.get(referrerId);
    if (!referrer) throw new Error('直接推荐人不存在，请重新选择。');
    if (referrer.reentry) throw new Error('复投点不能再邀请下级。');
    const id = requestedId.trim().toUpperCase() || this.nextName(referrerId);
    if (!/^[A-Z]{1,8}[1-9]\d{0,5}$/.test(id)) {
      throw new Error('账号格式为大写字母组 + 正整数，例如 B1、C12；最多 8 位字母和 6 位数字。');
    }
    if (this.users.has(id)) throw new Error('该账号已存在，请使用其他名称。');
    return { referrer, id };
  }

  addMarkedUser(referrerId, requestedId = '') {
    const { referrer, id } = this._resolveInviteId(referrerId, requestedId);
    const user = this.makeUser(id, referrerId, referrer.depth + 1);
    user.marketMarked = true;
    user.marketMarkedAt = this._defaultJoinAt ?? (this._defaultJoinAt = Date.now());
    referrer.markedChildren.push(id);
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

  setJoinedAt(id, ms) {
    const user = this.get(id);
    if (!user) throw new Error('该账号不存在。');
    if (user.reentry) throw new Error('复投点不能改购买时间。');
    if (!user.joined) throw new Error('未入团节点请改标记时间。');
    user.joinedAt = ms;
    if (user.referrerId) this.sortMarketSiblings(user.referrerId);
    return user;
  }

  addUser(referrerId, requestedId = '', options = {}) {
    const { referrer, id } = this._resolveInviteId(referrerId, requestedId);

    const referralAncestors = this.ancestors(referrerId, 'referrerId');
    const user = this.makeUser(id, referrerId, referrer.depth + 1);
    const candidates = [user, ...referralAncestors];
    const progressBefore = new Map(referralAncestors.map(item => [item.id, this.groupProgress(item.id)]));
    const leaderBefore = new Map(referralAncestors.map(item => [item.id, this.role(item.id) === '团长']));
    const previousDirectCount = this.realChildren(referrerId).length;
    const order = {
      id: this.nextOrderId++, buyerId: id, referrerId, position: 0, zone: 'group', cents: PRICE, payouts: [],
      agentLevels: this.snapshotAgentLevels(), reentryIds: [],
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    };

    this.users.set(id, user);
    this.placeChild(referrer, id);
    user.joined = true;
    user.marketMarked = false;
    user.marketMarkedAt = null;
    if (options.joinedAt != null) user.joinedAt = options.joinedAt;
    else if (user.joinedAt == null) user.joinedAt = this._defaultJoinAt ?? (this._defaultJoinAt = Date.now());
    this.sortMarketSiblings(referrerId);
    const position = this.realChildren(referrerId).indexOf(id) + 1;
    const zone = position <= 2 ? 'group' : 'support';
    order.position = position;
    order.zone = zone;
    if (referrer.referrerId) this.sortMarketSiblings(referrer.referrerId);
    user.spent = PRICE;
    const [, prefix, suffix] = id.match(/^([A-Z]+)(\d+)$/);
    this.nameCounters.set(prefix, Math.max(this.nameCounters.get(prefix) || 0, Number(suffix)));
    for (const ancestor of referralAncestors) {
      ancestor.teamSize++;
      ancestor.maxDownlineDepth = Math.max(ancestor.maxDownlineDepth, user.depth - ancestor.depth);
    }

    const pay = (recipient, type, cents, note, sourceId) => this.payOn(order, recipient, type, cents, note, sourceId);
    pay(referrer, 'direct', this.percentCents(REWARD_RATES.direct),
      '第 ' + position + ' 位直推 ' + id + ' · 实付 × 20%');

    // 已入团用户的真人直推从 1 人增至 2 人时，才向上查找扶持区订单奖。复投不算第二位。
    if (previousDirectCount === 1) {
      let supportRoot = referrer;
      const rootAlreadyLeader = leaderBefore.get(ROOT_ID);
      const orderWalkStop = (id) => {
        const user = this.get(id);
        return Boolean(user && !user.reentry && user.joined
          && this.realChildren(id).length >= 3 && this.isGroupComplete(id));
      };
      for (const ancestor of referralAncestors.slice(1, ORDER_LAYERS + 1)) {
        if (orderWalkStop(ancestor.id) || orderWalkStop(supportRoot.id)) break;
        const branch = this.realChildren(ancestor.id).indexOf(supportRoot.id);
        const ancestorWasLeader = leaderBefore.get(ancestor.id);
        if (branch >= 2 && !(ancestorWasLeader && rootAlreadyLeader)) {
          pay(ancestor, 'order', this.percentCents(REWARD_RATES.order),
            supportRoot.id + ' 的第 2 名直推触发扶持区订单奖 · 实付 × 10%', id);
        }
        supportRoot = ancestor;
      }
    }

    this.settleAgents(referralAncestors, pay, id);
    const completed = this.settleGroup(candidates, progressBefore, pay, id);
    this.settleManagement(candidates, pay);
    this.orders.push(order);
    this.applyReentries(completed, order);
    return order;
  }

  // 每个刚成团的真人只复投一次。滑落单再促成新团时，继续向左链滑，直到没有新团或达到上限。
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
      const parent = this.leftmostOpen(exited.id);
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
    user.userId = ownerId;
    user.round = round;
    user.joined = true;
    user.joinedAt = this._defaultJoinAt ?? (this._defaultJoinAt = Date.now());
    user.spent = PRICE;
    const ancestors = this.ancestors(parent.id, 'referrerId');
    const candidates = [user, ...ancestors];
    const progressBefore = new Map(ancestors.map(item => [item.id, this.groupProgress(item.id)]));
    this.users.set(positionId, user);
    this.placeChild(parent, positionId);
    this.sortMarketSiblings(parent.id);
    for (const ancestor of ancestors) {
      ancestor.maxDownlineDepth = Math.max(ancestor.maxDownlineDepth, user.depth - ancestor.depth);
    }
    const order = {
      id: this.nextOrderId++, type: 'reentry', buyerId: positionId, ownerId, referrerId: parent.id,
      exitedId: exited.id, position: 0, zone: 'support', cents: PRICE, payouts: [], completed: [],
      agentLevels: this.snapshotAgentLevels(),
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    };
    const pay = (recipient, type, cents, note, sourceId) => this.payOn(order, recipient, type, cents, note, sourceId);
    pay(parent, 'direct', this.percentCents(REWARD_RATES.direct),
      exited.id + ' 成团复投滑落到 ' + parent.id + ' · 实付 × 20%', ownerId);
    this.settleAgents(ancestors, pay, ownerId);
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
    // 复投单由真人订单重放时重新生成，不能再当作独立邀请重放一次。
    const keptOrders = this.orders.filter(order => order.type !== 'reentry' && !removed.has(order.buyerId));
    const keptLevels = new Map([...this.users].filter(([userId, user]) => !removed.has(userId) && !user.reentry).map(([userId, user]) => [userId, user.agentLevel]));
    const orderCount = this.orders.filter(order => removed.has(order.buyerId)).length;
    const savedCounters = new Map(this.nameCounters);
    const savedNextOrderId = this.nextOrderId;
    const rebuilt = new Simulation();
    for (const previous of keptOrders) {
      for (const [userId, level] of Object.entries(previous.agentLevels || {})) {
        const member = rebuilt.get(userId);
        if (member && !member.reentry) member.agentLevel = level;
      }
      const order = rebuilt.addUser(previous.referrerId, previous.buyerId);
      order.id = previous.id;
      order.time = previous.time;
      order.agentLevels = previous.agentLevels || {};
    }
    for (const [userId, level] of keptLevels) {
      const member = rebuilt.get(userId);
      if (member && !member.reentry) member.agentLevel = level;
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
    return { removedIds, orderCount };
  }
}
