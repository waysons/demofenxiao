
'use strict';

// 所有金额以整数「分」保存；仅显示时转换为元。
const PRICE = 19900;
const ROOT_ID = '张三';
const REPURCHASE_LAYERS = 8;
const REWARD_NAMES = { direct: '直推奖', group: '拼团奖', order: '订单奖', management: '管理奖' };
const REWARD_RATES = { direct: 20, group: 15, order: 10, management: 8 };

class Simulation {
  constructor() {
    this.users = new Map();
    this.orders = [];
    this.nextOrderId = 1;
    this.nameCounters = new Map();
    this.users.set(ROOT_ID, this.makeUser(ROOT_ID, null, 0));
  }

  makeUser(id, referrerId, depth) {
    return { id, referrerId, depth, children: [],
      teamSize: 1, groupAwarded: false, spent: 0, maxDownlineDepth: 0, renewedDepth: 0,
      wallet: { direct: 0, group: 0, order: 0, management: 0 } };
  }

  get(id) { return this.users.get(id); }
  income(id) { return Object.values(this.get(id).wallet).reduce((sum, value) => sum + value, 0); }
  role(id) { return this.get(id).groupAwarded ? '团长' : '普通'; }

  // 推荐深度决定字母组：A、B…Z、AA、AB…；组内数字全局递增。
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

  // 三个席位：本人和前两名直推；下级小团独立结算。
  groupProgress(id) {
    return 1 + Math.min(2, this.get(id).children.length);
  }

  needsRepurchase(id) {
    const user = this.get(id);
    return user.maxDownlineDepth - user.renewedDepth >= REPURCHASE_LAYERS;
  }

  repurchase(id) {
    if (!this.get(id)) throw new Error('该账号不存在。');
    if (!this.needsRepurchase(id)) throw new Error('本轮未满八层，无需复购。');
    return this.recordRepurchase(id);
  }

  // 删除重算也使用此方法保留真实发生过的模拟复购，不能再次校验当前层数。
  recordRepurchase(id, renewedDepth = this.get(id).maxDownlineDepth) {
    const user = this.get(id);
    const order = { id: this.nextOrderId++, type: 'repurchase', buyerId: id,
      referrerId: user.referrerId, zone: 'repurchase', cents: PRICE, payouts: [], renewedDepth,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) };
    user.spent += PRICE;
    user.renewedDepth = renewedDepth;
    this.orders.push(order);
    return order;
  }

  addUser(referrerId, requestedId = '') {
    const referrer = this.get(referrerId);
    if (!referrer) throw new Error('直接推荐人不存在，请重新选择。');
    if (this.needsRepurchase(referrerId)) throw new Error('本轮已满八层，请先复购 199 元恢复邀请资格。');
    const id = requestedId.trim().toUpperCase() || this.nextName(referrerId);
    if (!/^[A-Z]{1,8}[1-9]\d{0,5}$/.test(id)) {
      throw new Error('账号格式为大写字母组 + 正整数，例如 B1、C12；最多 8 位字母和 6 位数字。');
    }
    if (this.users.has(id)) throw new Error('该账号已存在，请使用其他名称。');

    // 全部校验结束后才写入数据，避免失败操作产生扣款和半笔订单。
    const referralAncestors = this.ancestors(referrerId, 'referrerId');
    const user = this.makeUser(id, referrerId, referrer.depth + 1);
    const position = referrer.children.length + 1;
    const zone = position <= 2 ? 'group' : 'support';
    const order = { id: this.nextOrderId++, buyerId: id, referrerId,
      position, zone, cents: PRICE, payouts: [], time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) };
    this.users.set(id, user);
    referrer.children.push(id);
    user.spent = PRICE; // 模拟支付支出，不接入真实支付。
    const [, prefix, suffix] = id.match(/^([A-Z]+)(\d+)$/);
    this.nameCounters.set(prefix, Math.max(this.nameCounters.get(prefix) || 0, Number(suffix)));

    // 层数从本人以下第一代计算；扶持区也属于实际推荐关系。
    for (const ancestor of referralAncestors) {
      ancestor.teamSize++;
      ancestor.maxDownlineDepth = Math.max(ancestor.maxDownlineDepth, user.depth - ancestor.depth);
    }

    const pay = (recipient, type, cents, note) => {
      if (cents <= 0) return;
      recipient.wallet[type] += cents;
      order.payouts.push({ userId: recipient.id, type, cents, note });
    };
    // 每位新直推都有直推奖；扶持区只额外结算订单奖。
    pay(referrer, 'direct', PRICE * REWARD_RATES.direct / 100,
      '第 ' + position + ' 位直推 ' + id + ' · 199 × 20%');
    if (zone === 'support') {
      pay(referrer, 'order', PRICE * REWARD_RATES.order / 100,
        id + ' 为第 ' + position + ' 位直推 · 扶持区订单 199 × 10%');
    }

    // 本人邀齐两名直推即成团；属于上级拼团区时，另给直接上级一笔管理奖。
    if (position === 2 && !referrer.groupAwarded) {
      const groupBonus = PRICE * REWARD_RATES.group / 100;
      referrer.groupAwarded = true;
      pay(referrer, 'group', groupBonus, '首次邀齐两名直推，完成 1+2 三人团 · 199 × 15%');
      const parent = this.get(referrer.referrerId);
      if (parent && parent.children.slice(0, 2).includes(referrer.id)) {
        pay(parent, 'management', Math.round(groupBonus * REWARD_RATES.management / 100),
          referrer.id + ' 邀齐两名直推成团 · 给直接上级的管理奖 29.85 × 8%，四舍五入至分');
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
    const orderCount = this.orders.length - keptOrders.length;
    const rebuilt = new Simulation();
    // 按保留订单原顺序重放，清除被删订单产生的奖金并重新判断拼团。
    // 重建完成后整体替换，避免删除途中留下不完整状态。
    for (const previous of keptOrders) {
      const order = previous.type === 'repurchase'
        ? rebuilt.recordRepurchase(previous.buyerId, previous.renewedDepth)
        : rebuilt.addUser(previous.referrerId, previous.buyerId);
      order.id = previous.id;
      order.time = previous.time;
    }
    if (id !== ROOT_ID) {
      // 保留已用过的编号上界，普通删除后不复用旧账号或旧订单编号。
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
