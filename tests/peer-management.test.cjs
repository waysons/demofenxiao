const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/simulation-engine.js'), 'utf8') + '\nthis.Simulation = Simulation;', context);
const fresh = () => new context.Simulation();
const fill = (sim, id, count) => Array.from({ length: count }, () => sim.addUser(id).buyerId);
const seven = (sim, id) => {
  const children = fill(sim, id, 2);
  children.forEach(child => fill(sim, child, 2));
  return children;
};
const management = sim => sim.orders.flatMap(order => order.payouts).filter(p => p.type === 'management');

test('本人加六人成团只发一次拼团奖，直推第三人才成为团长', () => {
  const sim = fresh();
  seven(sim, '张三');
  assert.equal(sim.orders.length, 7);
  assert.equal(sim.get('张三').wallet.group, 3980);
  assert.equal(sim.get('张三').wallet.management, 0);
  assert.equal(sim.role('张三'), '普通');
  fill(sim, '张三', 2);
  assert.equal(sim.role('张三'), '团长');
  assert.equal(sim.get('张三').wallet.group, 3980);
  assert.equal(sim.orders.flatMap(o => o.payouts).filter(p => p.userId === '张三' && p.type === 'group').length, 1);
});

test('A2 七人成团但未直推三人不发管理奖，补齐第三人后张三只领 2.39 元', () => {
  const sim = fresh();
  const [a1, a2] = seven(sim, '张三');
  fill(sim, '张三', 1);
  for (const child of sim.realChildren(a2)) fill(sim, child, 2);
  assert.equal(sim.get(a2).wallet.group, 3980);
  assert.equal(sim.role(a2), '普通');
  assert.equal(sim.get('张三').wallet.management, 0);
  fill(sim, a2, 1);
  assert.equal(sim.role(a2), '团长');
  assert.equal(sim.get('张三').wallet.management, 318);
  assert.equal(management(sim)[0].sourceId, a2);
  fill(sim, a2, 2);
  fill(sim, a1, 1);
  assert.equal(sim.role(a1), '团长');
  assert.equal(sim.get('张三').wallet.management, 318);
  sim.realChildren(a1).slice(0, 2).forEach(id => fill(sim, id, 2));
  assert.equal(sim.role(a1), '团长');
  assert.equal(sim.get('张三').wallet.management, 636);
  assert.equal(management(sim).length, 2);
});

test('下级先成为团长时等待上级也达标，A1 和 A2 各只结算一次', () => {
  const sim = fresh();
  const children = seven(sim, '张三');
  for (const child of children) {
    fill(sim, child, 1);
    sim.realChildren(child).slice(0, 2).forEach(id => fill(sim, id, 2));
  }
  assert.equal(sim.get('张三').wallet.management, 0);
  fill(sim, '张三', 1);
  assert.equal(sim.get('张三').wallet.management, 636);
  assert.deepEqual(Array.from(management(sim), p => p.sourceId), ['A1', 'A2']);
  fill(sim, '张三', 1);
  assert.equal(sim.get('张三').wallet.management, 636);
});

test('第三名直推成为平级团长也可发管理奖，深层团长不越级发奖', () => {
  const sim = fresh();
  seven(sim, '张三');
  const [a3] = fill(sim, '张三', 1);
  const [b1] = seven(sim, a3);
  fill(sim, a3, 1);
  assert.equal(sim.get('张三').wallet.management, 318);
  fill(sim, b1, 1);
  sim.realChildren(b1).slice(0, 2).forEach(id => fill(sim, id, 2));
  assert.equal(sim.get(a3).wallet.management, 318);
  assert.equal(sim.get('张三').wallet.management, 318);
});

test('删除第三名直推撤销团长资格及管理奖，保留拼团奖；重新达标只恢复一次', () => {
  const sim = fresh();
  const [a1] = seven(sim, '张三');
  fill(sim, '张三', 1);
  sim.realChildren(a1).forEach(id => fill(sim, id, 2));
  const [third] = fill(sim, a1, 1);
  assert.equal(sim.get('张三').wallet.management, 318);
  sim.deleteBranch(third);
  assert.equal(sim.role(a1), '普通');
  assert.equal(sim.get(a1).wallet.group, 3980);
  assert.equal(sim.get('张三').wallet.management, 0);
  fill(sim, a1, 2);
  assert.equal(sim.get('张三').wallet.management, 318);
  assert.equal(management(sim).length, 1);
});

test('只直推满三人不发管理奖；双方成团后才结算，八层也不暂停邀请', () => {
  const sim = fresh();
  const [a1] = seven(sim, '张三');
  fill(sim, '张三', 1);
  assert.equal(sim.role('张三'), '团长');
  assert.equal(sim.get('张三').wallet.management, 0);
  const [third] = fill(sim, a1, 1);
  assert.equal(sim.role(a1), '团长');
  assert.equal(sim.get(a1).wallet.group, 0);
  assert.equal(sim.get('张三').wallet.management, 0);
  sim.realChildren(a1).slice(0, 2).forEach(id => fill(sim, id, 2));
  assert.equal(sim.role(a1), '团长');
  assert.equal(sim.get(a1).wallet.group, 3980);
  assert.equal(sim.get('张三').wallet.management, 318);
  sim.deleteBranch(third);
  assert.equal(sim.role(a1), '普通');
  assert.equal(sim.get(a1).wallet.group, 3980);
  assert.equal(sim.get('张三').wallet.management, 0);
  fill(sim, a1, 1);
  assert.equal(sim.get('张三').wallet.management, 318);
  assert.equal(management(sim).length, 1);
  let tail = a1;
  for (let i = 0; i < 8; i++) tail = sim.addUser(tail).buyerId;
  assert.equal(sim.needsRepurchase('张三'), false);
  assert.throws(() => sim.repurchase('张三'), /无需复购/);
  sim.addUser('张三');
  assert.equal(sim.get('张三').wallet.group, 3980);
  assert.equal(sim.get('张三').wallet.management, 318);
});

test('直推满 3 人即为团长，无需自身七人成团', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  assert.equal(sim.role('张三'), '普通');
  sim.addUser('张三', 'A3');
  assert.equal(sim.role('张三'), '团长');
  assert.ok(sim.groupProgress('张三') < 7);
});
