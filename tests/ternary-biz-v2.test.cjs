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

// 标准 1+2+4 成团（与 reentry.test 一致）
function formSeven(sim, root = '张三') {
  sim.addUser(root, 'A1');
  sim.addUser(root, 'A2');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('A2', 'B3');
  return sim.addUser('A2', 'B4');
}

test('V2：setSlideMode 接受 ternary_biz_v2，非法值仍抛错', () => {
  const sim = fresh('binary');
  assert.equal(sim.setSlideMode('ternary_biz_v2'), 'ternary_biz_v2');
  assert.throws(() => sim.setSlideMode('ternary_biz_v3'), /滑落版本/);
});

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

test('V2：payOn 跳过复投点入账', () => {
  const sim = fresh('left');
  formSeven(sim);
  sim.setSlideMode('ternary_biz_v2');
  const re = [...sim.users.values()].find(u => u.reentry);
  assert.ok(re);
  const before = sim.income(re.id);
  const order = { payouts: [] };
  sim.payOn(order, re, 'direct', 4975, 'should skip');
  assert.equal(sim.income(re.id), before);
  assert.equal(order.payouts.length, 0);
});

const amount = (order, id, type) => order.payouts.filter(p => p.userId === id && p.type === type).reduce((sum, p) => sum + p.cents, 0);

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
  assert.equal(o4.zone, 'v2_slide');
});

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

test('V2：复投点前 3 人挂本点，第 4 人 realChildren 已满 3 → groupSlotOpen 滑落', () => {
  const sim = fresh();
  formSevenV2(sim);
  const reId = '张三:2';
  for (const id of ['X1', 'X2', 'X3']) {
    const o = sim.addUser(reId, id);
    assert.equal(sim.get(id).referrerId, reId);
    assert.notEqual(o.zone, 'v2_slide');
  }
  assert.equal(sim.realChildren(reId).length, 3);
  const expected = sim.groupSlotOpen(reId).id;
  assert.notEqual(expected, reId);
  const o4 = sim.addUser(reId, 'X4');
  assert.equal(sim.get('X4').referrerId, expected);
  assert.equal(sim.get('X4').inviteReferrerId, '张三');
  assert.equal(sim.realChildren(reId).length, 3); // 不再堆在复投点下
  assert.equal(o4.zone, 'v2_slide');
  assert.equal(amount(o4, '张三', 'direct'), 4975);
  assert.match(sim.describeNextInvite(reId), /前 3 挂本复投点，满则 L\/R DFS 滑落；邀请记原号/);
});

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

test('V2：叶点挂计团复投后树占座=复投+2 真人，第 3 个真人滑落不堆第 4 席', () => {
  const sim = fresh();
  formSevenV2(sim);
  const re = sim.get('张三:2');
  assert.equal(re.referrerId, 'C1');
  assert.equal(re.countsForGroup, true);
  assert.equal(sim.treeOccupancy('C1'), 1);
  sim.addUser('C1', 'D1');
  sim.addUser('C1', 'D2');
  assert.equal(sim.get('D1').referrerId, 'C1');
  assert.equal(sim.get('D2').referrerId, 'C1');
  assert.equal(sim.realChildren('C1').length, 2);
  assert.equal(sim.treeOccupancy('C1'), 3);
  const o3 = sim.addUser('C1', 'D3');
  assert.notEqual(sim.get('D3').referrerId, 'C1');
  assert.equal(sim.get('D3').inviteReferrerId, 'C1');
  assert.equal(o3.zone, 'v2_slide');
  assert.equal(sim.treeOccupancy('C1'), 3);
  assert.equal(sim.realChildren('C1').length, 2);
});

test('V2：滑落标记入团后 inviteReferrer 不丢，直推奖给邀请人', () => {
  const sim = fresh();
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addUser('张三', 'B3');
  const mark = sim.addMarkedUser('张三', 'M1');
  assert.equal(mark.referrerId, 'B1');
  assert.equal(mark.inviteReferrerId, '张三');
  const order = sim.joinMarkedUser('M1');
  assert.equal(sim.get('M1').referrerId, 'B1');
  assert.equal(sim.get('M1').inviteReferrerId, '张三');
  assert.equal(amount(order, '张三', 'direct'), 4975);
  assert.equal(amount(order, 'B1', 'direct'), 0);
});
