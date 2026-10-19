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
  assert.ok(o4.zone === 'binary_slide' || o4.zone === 'v2_slide' || o4.zone === 'group');
});
