const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/simulation-engine.js'), 'utf8') + '\nthis.Simulation = Simulation;', context);
const fresh = (mode = 'binary') => {
  const sim = new context.Simulation();
  sim.setSlideMode(mode);
  return sim;
};
const amount = (order, id, type) => order.payouts.filter(p => p.userId === id && p.type === type).reduce((sum, p) => sum + p.cents, 0);

test('仅邀齐两名直推不成团、不发拼团奖或管理奖', () => {
  const sim = fresh();
  const first = sim.addUser('张三');
  assert.equal(amount(first, '张三', 'group'), 0);
  assert.equal(sim.groupProgress('张三'), 2);
  const second = sim.addUser('张三');
  assert.equal(amount(second, '张三', 'group'), 0);
  assert.equal(amount(second, '张三', 'management'), 0);
  assert.equal(sim.income('张三'), 9950);
  assert.equal(sim.groupProgress('张三'), 3);
  assert.equal(sim.role('张三'), '普通');
});

test('两侧各邀齐两人不发管理奖，第七席到齐只发一次拼团奖', () => {
  const sim = fresh();
  sim.addUser('张三'); sim.addUser('张三');
  assert.equal(amount(sim.addUser('A1'), '张三', 'management'), 0);
  const left = sim.addUser('A1');
  assert.equal(amount(left, 'A1', 'group'), 0);
  assert.equal(amount(left, '张三', 'management'), 0);
  assert.equal(sim.get('张三').wallet.management, 0);
  assert.equal(sim.get('张三').wallet.group, 0);
  assert.equal(sim.groupProgress('张三'), 5);
  assert.equal(sim.income('张三'), 9950);
  assert.equal(amount(sim.addUser('A2'), '张三', 'management'), 0);
  assert.equal(sim.groupProgress('张三'), 6);
  assert.equal(sim.get('张三').wallet.group, 0);
  const right = sim.addUser('A2');
  assert.equal(amount(right, 'A2', 'group'), 0);
  assert.equal(amount(right, '张三', 'group'), 3980);
  assert.equal(amount(right, '张三', 'management'), 0);
  assert.equal(sim.get('张三').wallet.management, 0);
  assert.equal(sim.groupProgress('张三'), 7);
  assert.deepEqual(new Set(sim.groupMemberIds('张三')), new Set(['张三', 'A1', 'A2', 'B1', 'B2', 'B3', 'B4']));
  assert.equal(sim.role('张三'), '普通');
  assert.equal(sim.role('A1'), '普通');
  assert.equal(sim.role('A2'), '普通');
  assert.equal(sim.income('张三'), 13930);
  sim.addUser('A1'); sim.addUser('A2'); sim.addUser('张三');
  assert.equal(sim.get('张三').wallet.group, 3980);
  assert.equal(sim.orders.flatMap(order => order.payouts).filter(payout => payout.userId === '张三' && payout.type === 'group').length, 1);
  assert.equal(sim.role('张三'), '团长');
  assert.equal(sim.role('A1'), '团长');
  assert.equal(sim.get('张三').wallet.management, 0);
});

test('仅邀两人的下级未成为团长，拼团区和扶持区均不产生管理奖', () => {
  const sim = fresh();
  sim.addUser('张三'); sim.addUser('张三'); sim.addUser('张三');
  sim.addUser('A3');
  const supportGroup = sim.addUser('A3');
  assert.equal(amount(supportGroup, 'A3', 'group'), 0);
  assert.equal(amount(supportGroup, '张三', 'management'), 0);
  sim.addUser('A1', 'B9'); sim.addUser('B9');
  const deepGroup = sim.addUser('B9');
  assert.equal(amount(deepGroup, 'B9', 'group'), 0);
  assert.equal(amount(deepGroup, 'A1', 'management'), 0);
  assert.equal(amount(deepGroup, '张三', 'management'), 0);
});

test('单侧邀齐不产生管理奖，另一侧补齐七人仅结算拼团奖', () => {
  const sim = fresh();
  sim.addUser('张三', 'A9'); sim.addUser('A9'); sim.addUser('A9');
  assert.equal(sim.get('张三').wallet.group, 0);
  assert.equal(sim.get('张三').wallet.management, 0);
  sim.addUser('张三', 'A1');
  assert.equal(sim.get('张三').wallet.group, 0);
  assert.equal(sim.get('张三').wallet.management, 0);
  sim.addUser('A1'); sim.addUser('A1');
  assert.equal(sim.get('张三').wallet.group, 3980);
  assert.equal(sim.get('张三').wallet.management, 0);
});

test('删除成团关键成员撤销拼团奖，再补齐只恢复一笔', () => {
  const sim = fresh();
  sim.addUser('张三'); sim.addUser('张三');
  sim.addUser('A1'); sim.addUser('A1'); sim.addUser('A2'); sim.addUser('A2');
  sim.deleteBranch('B2');
  assert.equal(sim.get('张三').wallet.group, 0);
  assert.equal(sim.get('张三').wallet.management, 0);
  assert.equal(sim.get('A1').wallet.group, 0);
  assert.equal(sim.get('A2').wallet.group, 0);
  const replacement = sim.addUser('A1');
  assert.equal(amount(replacement, 'A1', 'group'), 0);
  assert.equal(amount(replacement, '张三', 'group'), 3980);
  assert.equal(amount(replacement, '张三', 'management'), 0);
  assert.equal(sim.get('张三').wallet.management, 0);
  sim.addUser('A1');
  assert.equal(sim.get('张三').wallet.management, 0);
});

test('直链深凑仍须 1+2+4：两侧各满 2 才成团；A3 入团后为团长', () => {
  const sim = fresh('left');
  sim.addUser('张三', 'A1');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('B1', 'C1');
  const deep = sim.addUser('C1', 'D1');
  assert.equal(amount(deep, '张三', 'group'), 0);
  assert.equal(sim.get('张三').wallet.group, 0);
  assert.equal(sim.isGroupComplete('张三'), false);
  const second = sim.addUser('张三', 'A2');
  assert.equal(amount(second, '张三', 'group'), 0);
  assert.equal(sim.isGroupComplete('张三'), false);
  sim.addUser('A2', 'E1');
  const done = sim.addUser('A2', 'E2');
  assert.equal(amount(done, '张三', 'group'), 3980);
  assert.equal(sim.isGroupComplete('张三'), true);
  const third = sim.addUser('张三', 'A3');
  assert.equal(sim.role('张三'), '团长');
  assert.equal(amount(third, '张三', 'group'), 0);
  assert.equal(sim.get('张三').wallet.group, 3980);
  assert.deepEqual([...sim.get('张三').children].filter(id => !sim.get(id).reentry), ['A1', 'A2', 'A3']);
});

test('双轨：第 3 邀请滑到空位，仍算邀请直推成团长，本人树只留左右', () => {
  const sim = fresh('binary');
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('A2', 'B3');
  sim.addUser('A2', 'B4');
  // 成团后复投已挂 B1；再邀 A3 → 滑到下一个空位（B1 若已有复投仍可挂真人）
  const third = sim.addUser('张三', 'A3');
  assert.equal(third.zone, 'binary_slide');
  assert.equal(sim.get('A3').inviteReferrerId, '张三');
  assert.equal(sim.role('张三'), '团长');
  assert.deepEqual([...sim.realChildren('张三')], ['A1', 'A2']);
  assert.deepEqual([...sim.inviteOrderedRealChildren('张三')].slice(0, 3), ['A1', 'A2', 'A3']);
  assert.equal(sim.get('张三').children.includes('A3'), false);
  assert.ok(sim.get(sim.get('A3').referrerId).children.includes('A3'));
});

test('第 3 名直推下单本身不发订单奖；席位不因裂变换位', () => {
  const sim = fresh('left');
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('A2', 'B2');
  const support = sim.addUser('张三', 'A3');
  assert.equal(amount(support, '张三', 'order'), 0);
  assert.equal(amount(support, '张三', 'direct'), 4975);
  assert.deepEqual([...sim.get('张三').children], ['A1', 'A2', 'A3']);
  sim.addUser('A3', 'B1');
  assert.deepEqual([...sim.get('张三').children], ['A1', 'A2', 'A3']);
  assert.equal(support.zone, 'support');
  assert.equal(sim.get('张三').wallet.order, 0);
});

test('A 邀 B1/B2/B3 后 B3 邀满两人：A 已是团长仍拿订单奖（对照·扶持区挂本人）', () => {
  const sim = fresh('left');
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addUser('张三', 'B3');
  assert.equal(sim.role('张三'), '团长');
  assert.equal(sim.inviteOrderedRealChildren('张三').indexOf('B3'), 2);
  sim.addUser('B3', 'C1');
  assert.equal(sim.realChildren('张三').indexOf('B3'), 2);
  assert.equal(sim.inviteOrderedRealChildren('张三').indexOf('B3'), 2);
  const second = sim.addUser('B3', 'C2');
  assert.equal(sim.role('B3'), '普通');
  assert.equal(amount(second, '张三', 'order'), 1990);
  assert.equal(sim.get('张三').wallet.order, 1990);
});

test('双轨：第 3 邀请滑落后，其第 2 直推仍给邀请人订单奖', () => {
  const sim = fresh('binary');
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  const slid = sim.addUser('张三', 'B3');
  assert.equal(slid.zone, 'binary_slide');
  assert.equal(sim.get('B3').referrerId, 'B1');
  assert.equal(sim.role('张三'), '团长');
  sim.addUser('B3', 'C1');
  const second = sim.addUser('B3', 'C2');
  assert.equal(amount(second, '张三', 'order'), 1990);
});

test('B3 成为团长后，其下扶持区再凑齐两人时 A 被截流拿不到订单奖', () => {
  const sim = fresh('left');
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addUser('张三', 'B3');
  sim.addUser('B3', 'C1');
  sim.addUser('B3', 'C2');
  assert.equal(sim.get('张三').wallet.order, 1990);
  sim.addUser('B3', 'C3');
  assert.equal(sim.role('B3'), '团长');
  assert.equal(sim.inviteOrderedRealChildren('B3').indexOf('C3'), 2);
  sim.addUser('C3', 'D1');
  const blocked = sim.addUser('C3', 'D2');
  assert.equal(amount(blocked, '张三', 'order'), 0);
  assert.equal(sim.get('张三').wallet.order, 1990);
  assert.equal(amount(blocked, 'B3', 'order'), 1990);
});

test('代理奖按下单时等级结算并在删除后重放', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('A1', 'B1');
  sim.setAgentLevel('张三', 'county');
  sim.setAgentLevel('A1', 'city');
  const agentOrder = sim.addUser('A1', 'B20');
  assert.equal(amount(agentOrder, '张三', 'agent_county'), 597);
  assert.equal(amount(agentOrder, 'A1', 'agent_city'), 1194);
  sim.setAgentLevel('张三', 'province');
  sim.deleteBranch('B20');
  assert.equal(sim.get('张三').wallet.agent_county, 0);
  assert.equal(sim.get('张三').agentLevel, 'province');
  const replayed = sim.addUser('A1', 'B21');
  assert.equal(amount(replayed, '张三', 'agent_province'), 1791);
});

test('扶持区后代不计入本人 1+2+4 成团结构', () => {
  const sim = fresh('left');
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('张三', 'A3');
  sim.addUser('A3', 'S1');
  assert.equal(sim.groupProgress('张三'), 3);
  assert.equal(sim.groupMemberIds('张三').includes('A3'), false);
  assert.equal(sim.groupMemberIds('张三').includes('S1'), false);
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  assert.equal(sim.groupProgress('张三'), 5);
  sim.addUser('A2', 'B3');
  const done = sim.addUser('A2', 'B4');
  assert.equal(sim.groupProgress('张三'), 7);
  assert.equal(amount(done, '张三', 'group'), 3980);
});

test('双轨滑落可帮落点凑叶加速成团', () => {
  const sim = fresh('binary');
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  // A1 只有 B1；张三再邀 A3 → 滑到 A1 下占 R → A1 仍差叶子；继续
  sim.addUser('A1', 'B1');
  const slid = sim.addUser('张三', 'A3');
  assert.equal(slid.zone, 'binary_slide');
  assert.equal(sim.get('A3').referrerId, 'A1');
  assert.deepEqual([...sim.realChildren('A1')], ['B1', 'A3']);
  // 再给 B1、A3 各凑 2 叶，A1 应能成团
  sim.addUser('B1', 'C1');
  sim.addUser('B1', 'C2');
  sim.addUser('A3', 'C3');
  const leaf = sim.addUser('A3', 'C4');
  assert.equal(sim.isGroupComplete('A1'), true);
  assert.equal(amount(leaf, 'A1', 'group'), 3980);
});
