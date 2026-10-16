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
const fresh = () => new context.Simulation();

test('仅标记不占席位不发奖', () => {
  const sim = fresh();
  const marked = sim.addMarkedUser('张三', 'M1');
  assert.equal(marked.marketMarked, true);
  assert.equal(marked.joined, false);
  assert.deepEqual([...sim.realChildren('张三')], []);
  assert.equal(sim.orders.length, 0);
  assert.equal(sim.get('张三').wallet.direct, 0);
  assert.deepEqual([...sim.get('张三').markedChildren], ['M1']);
});

test('标记后模拟入团发直推奖', () => {
  const sim = fresh();
  sim.addMarkedUser('张三', 'M1');
  const order = sim.joinMarkedUser('M1', 5000);
  assert.equal(sim.get('M1').joined, true);
  assert.equal(sim.get('M1').joinedAt, 5000);
  assert.equal(order.cents, 19900);
  assert.equal(sim.get('张三').wallet.direct, 3980);
  assert.deepEqual([...sim.get('张三').markedChildren], []);
});

test('改 joinedAt 触发重排但不改旧钱包', () => {
  const sim = fresh();
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  const before = sim.get('张三').wallet.direct;
  sim.get('B1').joinedAt = 100;
  sim.get('B2').joinedAt = 200;
  sim.setJoinedAt('B1', 300);
  assert.deepEqual([...sim.realChildren('张三')], ['B1', 'B2']);
  assert.equal(sim.get('张三').wallet.direct, before);
});

test('clearMarketMark 移除未入团标记节点', () => {
  const sim = fresh();
  sim.addMarkedUser('张三', 'M1');
  const u = sim.clearMarketMark('M1');
  assert.equal(u.marketMarked, false);
  assert.equal(sim.get('M1'), undefined);
  assert.deepEqual([...sim.get('张三').markedChildren], []);
});
