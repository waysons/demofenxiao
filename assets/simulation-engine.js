'use strict';

// 与后端 distRewardRules.settleCountedJoin 同一套口径。金额用整数分，显示时再换成元。
const PRICE = 19900;
const ROOT_ID = '张三';
const ORDER_LAYERS = 8;
const REWARD_NAMES = {
  direct: '直推奖', group: '拼团奖', order: '订单奖', management: '管理奖',
  agent_county: '县级代理奖', agent_city: '市级代理奖', agent_province: '省级代理奖'
};
const REWARD_RATES = {
  direct: 20, group: 15, order: 10, management: 8,
  agent_county: 3, agent_city: 6, agent_province: 9
};
const AGENT_LEVELS = { '': '无', county: '县级代理', city: '市级代理', province: '省级代理' };

class Simulation {
  constructor() {
    this.users = new Map();
    this.orders = [];
    this.nextOrderId = 1;
    this.nameCounters = new Map();
    this.users.set(ROOT_ID, this.makeUser(ROOT_ID, null, 0));
  }

  makeUser(id, referrerId, depth) {
    return {
      id, referrerId, depth, children: [], agentLevel: '',
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

  // 团长：七人团已满，并且直推至少 3 人。只满七人或只满三名直推都还是普通。
  role(id) {
    const user = this.get(id);
    return user && this.groupProgress(id) >= 7 && user.children.length >= 3 ? '团长' : '普通';
  }

  subtreeOrders(id) { return this.get(id).teamSize - 1; }

  nextName(referrerId) {
    const parent = this.get(referrerId);
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

  // 本人 + 前两名直推各自整棵下级树。本人第 3 名及以后的分支不计入本人的七人团。
  groupMemberIds(id) {
    const user = this.get(id);
    if (!user) return [];
    const result = [user.id];
    const seen = new Set([user.id]);
    const pending = user.children.slice(0, 2);
    while (pending.length) {
      const childId = pending.pop();
      if (seen.has(childId)) continue;
      seen.add(childId);
      const child = this.get(childId);
      if (!child) continue;
      result.push(childId);
      pending.push(...child.children);
    }
    return result;
  }

  groupProgress(id) { return this.groupMemberIds(id).length; }

  setAgentLevel(id, level) {
    if (!Object.prototype.hasOwnProperty.call(AGENT_LEVELS, level)) throw new Error('代理等级无效。');
    const user = this.get(id);
    if (!user) throw new Error('该账号不存在。');
    user.agentLevel = level;
    return user;
  }

  percentCents(rate) {
    const cents = Math.round(PRICE * rate / 100);
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('奖金金额无效');
    return cents;
  }

  // 八层只限制订单奖向上查找，不再暂停邀请。
  needsRepurchase() { return false; }

  repurchase() { throw new Error('当前规则不暂停邀请，无需复购。'); }

  describeNextInvite(referrerId) {
    const referrer = this.get(referrerId);
    if (!referrer) return '请先选择推荐人。';
    const position = referrer.children.length + 1;
    const direct = this.percentCents(REWARD_RATES.direct);
    const zone = position <= 2 ? '左右位，计入该推荐人的七人团' : '扶持区，不计入该推荐人自己的七人团';
    const orderNote = position === 2
      ? '这是第 2 名直推，会从该推荐人的直接上级向上最多 8 层找订单奖：落在某上级第 3 名及以后分支才发实付的 10%，左右位跳过并继续向上；付款前该上级或对应分支根已是团长则停止。'
      : position === 1
        ? '第 1 名直推不触发订单奖。'
        : '第 3 名及以后本身不发订单奖。等这位成员自己邀到第 2 名直推时，才可能沿上级链发扶持区订单奖。';
    return '第 ' + position + ' 位直推（' + zone + '）。推荐人获得直推奖 ' + (direct / 100).toFixed(2) +
      ' 元。' + orderNote + ' 七人团满 7 人发一次拼团奖；再有 3 名直推才是团长。双方都是团长后，按该下级拼团奖的 8% 给直接上级一次管理奖。邀请不因层数暂停。';
  }

  addUser(referrerId, requestedId = '') {
    const referrer = this.get(referrerId);
    if (!referrer) throw new Error('直接推荐人不存在，请重新选择。');
    const id = requestedId.trim().toUpperCase() || this.nextName(referrerId);
    if (!/^[A-Z]{1,8}[1-9]\d{0,5}$/.test(id)) {
      throw new Error('账号格式为大写字母组 + 正整数，例如 B1、C12；最多 8 位字母和 6 位数字。');
    }
    if (this.users.has(id)) throw new Error('该账号已存在，请使用其他名称。');

    const referralAncestors = this.ancestors(referrerId, 'referrerId');
    const user = this.makeUser(id, referrerId, referrer.depth + 1);
    const candidates = [user, ...referralAncestors];
    const progressBefore = new Map(referralAncestors.map(item => [item.id, this.groupProgress(item.id)]));
    const leaderBefore = new Map(referralAncestors.map(item => [item.id, this.role(item.id) === '团长']));
    const previousDirectCount = referrer.children.length;
    const position = previousDirectCount + 1;
    const zone = position <= 2 ? 'group' : 'support';
    const order = {
      id: this.nextOrderId++, buyerId: id, referrerId, position, zone, cents: PRICE, payouts: [],
      agentLevels: Object.fromEntries([...this.users].filter(([, member]) => member.agentLevel).map(([memberId, member]) => [memberId, member.agentLevel])),
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    };

    this.users.set(id, user);
    referrer.children.push(id);
    user.spent = PRICE;
    const [, prefix, suffix] = id.match(/^([A-Z]+)(\d+)$/);
    this.nameCounters.set(prefix, Math.max(this.nameCounters.get(prefix) || 0, Number(suffix)));
    for (const ancestor of referralAncestors) {
      ancestor.teamSize++;
      ancestor.maxDownlineDepth = Math.max(ancestor.maxDownlineDepth, user.depth - ancestor.depth);
    }

    const pay = (recipient, type, cents, note, sourceId) => {
      if (!recipient || cents <= 0) return;
      recipient.wallet[type] += cents;
      order.payouts.push({ userId: recipient.id, type, cents, note, ...(sourceId ? { sourceId } : {}) });
    };

    pay(referrer, 'direct', this.percentCents(REWARD_RATES.direct),
      '第 ' + position + ' 位直推 ' + id + ' · 实付 × 20%');

    // 已入团用户的直推从 1 人增至 2 人时，才向上查找扶持区订单奖。
    if (previousDirectCount === 1) {
      let supportRoot = referrer;
      for (const ancestor of referralAncestors.slice(1, ORDER_LAYERS + 1)) {
        if (leaderBefore.get(ancestor.id) || leaderBefore.get(supportRoot.id)) break;
        const branch = ancestor.children.indexOf(supportRoot.id);
        if (branch >= 2) {
          pay(ancestor, 'order', this.percentCents(REWARD_RATES.order),
            supportRoot.id + ' 的第 2 名直推触发扶持区订单奖 · 实付 × 10%', id);
        }
        supportRoot = ancestor;
      }
    }

    const agentNames = { county: '县级', city: '市级', province: '省级' };
    for (const ancestor of referralAncestors) {
      const tier = ancestor.agentLevel;
      if (!['county', 'city', 'province'].includes(tier)) continue;
      const rate = REWARD_RATES['agent_' + tier];
      pay(ancestor, 'agent_' + tier, this.percentCents(rate),
        agentNames[tier] + '代理奖 · 实付 × ' + rate + '%', id);
    }

    const groupBonus = this.percentCents(REWARD_RATES.group);
    for (const candidate of candidates) {
      const after = this.groupProgress(candidate.id);
      if (!candidate.groupAwarded && (progressBefore.get(candidate.id) || 0) < 7 && after >= 7) {
        candidate.groupAwarded = true;
        candidate.groupBonusCents = groupBonus;
        pay(candidate, 'group', groupBonus, '首次完成七人团 · 实付 × 15%', id);
      }
    }

    const sources = new Set(candidates.flatMap(item => [item.id, ...item.children]));
    for (const sourceId of sources) {
      const source = this.get(sourceId);
      const parent = source && source.referrerId ? this.get(source.referrerId) : null;
      if (!source || source.managementAwarded || !parent) continue;
      if (this.role(sourceId) === '团长' && this.role(parent.id) === '团长' && source.groupBonusCents > 0) {
        source.managementAwarded = true;
        const cents = Math.round(source.groupBonusCents * REWARD_RATES.management / 100);
        pay(parent, 'management', cents,
          sourceId + ' 与 ' + parent.id + ' 均已成为团长 · 拼团奖 × 8%', sourceId);
      }
    }

    this.orders.push(order);
    return order;
  }

  branchIds(id) {
    if (!this.get(id)) throw new Error('该节点不存在。');
    const ids = [id];
    for (let index = 0; index < ids.length; index++) ids.push(...this.get(ids[index]).children);
    return ids;
  }

  deleteBranch(id) {
    const removedIds = this.branchIds(id);
    const removed = new Set(removedIds);
    const keptOrders = this.orders.filter(order => !removed.has(order.buyerId));
    const keptLevels = new Map([...this.users].filter(([userId]) => !removed.has(userId)).map(([userId, user]) => [userId, user.agentLevel]));
    const orderCount = this.orders.length - keptOrders.length;
    const rebuilt = new Simulation();
    for (const previous of keptOrders) {
      for (const [userId, level] of Object.entries(previous.agentLevels || {})) {
        const member = rebuilt.get(userId);
        if (member) member.agentLevel = level;
      }
      const order = rebuilt.addUser(previous.referrerId, previous.buyerId);
      order.id = previous.id;
      order.time = previous.time;
      order.agentLevels = previous.agentLevels || {};
    }
    for (const [userId, level] of keptLevels) {
      const member = rebuilt.get(userId);
      if (member) member.agentLevel = level;
    }
    if (id !== ROOT_ID) {
      rebuilt.nameCounters = new Map(this.nameCounters);
      rebuilt.nextOrderId = this.nextOrderId;
    }
    this.users = rebuilt.users;
    this.orders = rebuilt.orders;
    this.nameCounters = rebuilt.nameCounters;
    this.nextOrderId = rebuilt.nextOrderId;
    return { removedIds, orderCount };
  }
}
