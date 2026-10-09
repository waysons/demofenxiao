
'use strict';

// 所有金额以整数「分」保存；仅显示时转换为元。
const PRICE = 19900;
const ROOT_ID = '张三';
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
      teamSize: 1, groupAwarded: false, spent: 0,
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

  // 本人加前两名直推即为三人团，孙辈不参与该账号的成团判断。
  groupProgress(id) {
    return 1 + Math.min(2, this.get(id).children.length);
  }

  addUser(referrerId, requestedId = '') {
    const referrer = this.get(referrerId);
    if (!referrer) throw new Error('直接推荐人不存在，请重新选择。');
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

    // 团队人数包含本人，成团只看本人和前两名直推。
    for (const ancestor of referralAncestors) ancestor.teamSize++;

    const pay = (recipient, type, cents, note) => {
      if (cents <= 0) return;
      recipient.wallet[type] += cents;
      order.payouts.push({ userId: recipient.id, type, cents, note });
    };
    // 第一位为直推奖，第二位为拼团奖，第三位起为订单奖，三者不叠加。
    if (position === 1) {
      pay(referrer, 'direct', PRICE * REWARD_RATES.direct / 100, '第 1 位直推 ' + id + ' · 199 × 20%');
    } else if (position === 2) {
      const groupBonus = PRICE * REWARD_RATES.group / 100;
      referrer.groupAwarded = true;
      pay(referrer, 'group', groupBonus, '第 2 位直推加入，首次完成 1+2 三人团 · 199 × 15%');
      pay(referrer, 'management', Math.round(groupBonus * REWARD_RATES.management / 100),
        '成团附加管理奖 · 29.85 × 8%，四舍五入至分');
    } else {
      pay(referrer, 'order', PRICE * REWARD_RATES.order / 100,
        id + ' 为第 ' + position + ' 位直推 · 扶持区订单 199 × 10%');
    }

    // 全部直推祖先等分每单 8%；金额不足整分的尾差从近到远补齐。
    const pool = referralAncestors.length > 1 ? PRICE * REWARD_RATES.management / 100 : 0;
    const share = Math.floor(pool / referralAncestors.length);
    const remainder = pool % referralAncestors.length;
    referralAncestors.forEach((ancestor, index) => {
      pay(ancestor, 'management', share + (index < remainder ? 1 : 0),
        referralAncestors.length + ' 位直推祖先等份共享 199 × 8%' +
        (remainder ? '，分币尾差从近到远补齐' : ''));
    });
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
      const order = rebuilt.addUser(previous.referrerId, previous.buyerId);
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
