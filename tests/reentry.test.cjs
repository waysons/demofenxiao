const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/simulation-engine.js'), 'utf8') + '\nthis.Simulation = Simulation;', context);
const fresh = () => new context.Simulation();
const amount = (order, id, type) => order.payouts.filter(p => p.userId === id && p.type === type).reduce((sum, p) => sum + p.cents, 0);

test('成团复投滑到左链尽头，给落点发直推奖，并算落点团里的 1 人', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('张三', 'A3');
  sim.addUser('A1', 'B1');
  sim.addUser('B1', 'C1');
  const d1 = sim.addUser('C1', 'D1');
  assert.equal(sim.groupProgress('张三'), 6);
  assert.equal(sim.groupProgress('D1'), 1);
  assert.deepEqual([...d1.reentryIds], []);
  const last = sim.addUser('A2', 'E1');
  assert.equal(sim.groupMemberIds('张三').includes('A3'), false);
  assert.equal(sim.get('张三').exited, true);
  assert.equal(sim.get('张三').reentered, true);
  assert.equal(sim.get('张三').groupAwarded, true);
  assert.equal(amount(last, '张三', 'group'), 2985);
  assert.deepEqual([...last.reentryIds], ['张三:2']);
  const slide = sim.orders.find(order => order.type === 'reentry');
  assert.equal(slide.ownerId, '张三');
  assert.equal(slide.referrerId, 'D1');
  assert.equal(slide.zone, 'support');
  assert.equal(amount(slide, 'D1', 'direct'), 3980);
  assert.equal(amount(slide, '张三', 'group'), 0);
  assert.equal(amount(slide, 'D1', 'order'), 0);
  assert.equal(sim.get('D1').children.includes('张三:2'), true);
  assert.equal(sim.realChildren('D1').includes('张三:2'), false);
  assert.equal(sim.groupProgress('D1'), 2);
  assert.equal(sim.get('D1').wallet.direct, 3980);
  assert.equal(sim.get('张三:2').reentry, true);
  assert.equal(sim.get('张三:2').children.length, 0);
  assert.equal(sim.get('张三:2').groupAwarded, false);
  assert.equal(sim.role('张三:2'), '复投');
  assert.equal(sim.get('张三').wallet.group, 2985);
  const realChild = sim.addUser('D1', 'F1');
  assert.equal(realChild.zone, 'group');
  assert.equal(realChild.position, 1);
  assert.equal(amount(realChild, 'D1', 'order'), 0);
  assert.equal(sim.get('F1').referrerId, 'D1');
  assert.deepEqual([...sim.get('D1').children], ['F1', '张三:2']);
  const later = sim.addUser('张三', 'A4');
  assert.equal(sim.get('A4').referrerId, '张三');
  assert.equal(sim.get('张三').children.includes('A4'), true);
  assert.equal(sim.get('张三:2').children.includes('A4'), false);
  assert.throws(() => sim.addUser('张三:2', 'G1'), /复投点不能再邀请下级/);
});

test('复投点不占左右位，删除成团成员后重放不再留下复投单', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('A2', 'B3');
  sim.addUser('A2', 'B4');
  assert.equal(sim.get('张三').groupAwarded, true);
  assert.ok(sim.get('张三:2'));
  assert.equal(sim.orders.filter(order => order.type === 'reentry').length, 1);
  sim.deleteBranch('B4');
  assert.equal(sim.get('张三').groupAwarded, false);
  assert.equal(sim.get('张三:2'), undefined);
  assert.equal(sim.orders.some(order => order.type === 'reentry'), false);
  assert.equal(sim.get('张三').wallet.group, 0);
  const again = sim.addUser('A2', 'B5');
  assert.equal(amount(again, '张三', 'group'), 2985);
  assert.deepEqual([...again.reentryIds], ['张三:2']);
  assert.equal(sim.groupMemberIds('张三').includes('张三:2'), true);
});

test('单链满 7 不成团；补第 2 直推后发拼团奖并滑落', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  let parent = 'A1';
  for (let i = 1; i <= 5; i++) {
    const id = 'B' + i;
    sim.addUser(parent, id);
    parent = id;
  }
  assert.ok(sim.groupProgress('张三') >= 7);
  assert.equal(sim.get('张三').groupAwarded, false);
  assert.equal(sim.get('张三').wallet.group, 0);
  assert.equal([...sim.users.values()].filter(u => u.reentry).length, 0);

  const second = sim.addUser('张三', 'A2');
  assert.equal(sim.get('张三').groupAwarded, true);
  assert.equal(amount(second, '张三', 'group'), 2985);
  assert.deepEqual([...second.reentryIds], ['张三:2']);
  assert.ok(sim.get('张三:2')?.reentry);
});
