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

test('仅标记不占席位不发奖', () => {
  const sim = fresh();
  const marked = sim.addMarkedUser('张三', 'M1');
  assert.equal(marked.marketMarked, true);
  assert.equal(marked.joined, false);
  assert.equal(sim.realChildren('张三').includes('M1'), false);
  assert.equal(sim.orders.length, 0);
  assert.equal(sim.get('张三').wallet.direct, 0);
});

test('模拟购买入团走完整结算；改时间不换位', () => {
  const sim = fresh();
  sim.addMarkedUser('张三', 'M1');
  const order = sim.joinMarkedUser('M1', 5000);
  assert.equal(order.buyerId, 'M1');
  assert.equal(sim.get('M1').joinedAt, 5000);
  assert.equal(amount(order, '张三', 'direct'), 4975);
  sim.addUser('张三', 'B2');
  assert.deepEqual([...sim.realChildren('张三')], ['M1', 'B2']);
  sim.setJoinedAt('M1', 9000);
  assert.equal(sim.get('M1').joinedAt, 9000);
  // 不换位：仍按入团顺序
  assert.deepEqual([...sim.realChildren('张三')], ['M1', 'B2']);
});

test('clearMarketMark 移除未入团标记节点', () => {
  const sim = fresh();
  sim.addMarkedUser('张三', 'M1');
  const u = sim.clearMarketMark('M1');
  assert.equal(u.marketMarked, false);
  assert.equal(sim.get('M1'), undefined);
});

test('deleteBranch 保留未被删除的仅标记节点', () => {
  const sim = fresh();
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addMarkedUser('张三', 'M1').marketMarkedAt = 777;
  sim.addMarkedUser('B1', 'M2');
  sim.deleteBranch('B1');
  assert.equal(sim.get('M1').marketMarked, true);
  assert.equal(sim.get('M1').marketMarkedAt, 777);
  assert.equal(sim.get('M2'), undefined);
  assert.equal(sim.get('B2').joined, true);
});

test('可修改奖金比例，只影响之后新订单', () => {
  const sim = fresh();
  const first = sim.addUser('张三', 'A1');
  assert.equal(amount(first, '张三', 'direct'), 4975);
  sim.setRewardRates({ direct: 10 });
  const second = sim.addUser('张三', 'A2');
  assert.equal(amount(second, '张三', 'direct'), 1990);
  assert.equal(sim.get('张三').wallet.direct, 4975 + 1990);
});

test('一次连续邀请多人各自成直推', () => {
  const sim = fresh('left');
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(sim.addUser('张三').buyerId);
  assert.equal(ids.length, 3);
  assert.deepEqual([...sim.realChildren('张三')], ids);
  assert.equal(sim.orders.length, 3);
});

test('双轨：一次邀 3 人，第三人滑落不占本人树第 3 席', () => {
  const sim = fresh('binary');
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(sim.addUser('张三').buyerId);
  assert.deepEqual([...sim.realChildren('张三')], ids.slice(0, 2));
  assert.equal(sim.get(ids[2]).inviteReferrerId, '张三');
  assert.equal(sim.get(ids[2]).referrerId, ids[0]);
  assert.equal(sim.orders[2].zone, 'binary_slide');
});
