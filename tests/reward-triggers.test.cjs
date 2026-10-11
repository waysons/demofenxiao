const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/simulation-engine.js'), 'utf8') + '\nthis.Simulation = Simulation;', context);
const fresh = () => new context.Simulation();
const amount = (order, id, type) => order.payouts.filter(p => p.userId === id && p.type === type).reduce((sum, p) => sum + p.cents, 0);

test('第二名直推加入即发拼团奖，不给团长同时发管理奖', () => {
  const sim = fresh();
  const first = sim.addUser('张三');
  assert.equal(amount(first, '张三', 'group'), 0);
  assert.equal(sim.groupProgress('张三'), 2);
  const second = sim.addUser('张三');
  assert.equal(amount(second, '张三', 'group'), 2985);
  assert.equal(amount(second, '张三', 'management'), 0);
  assert.equal(sim.income('张三'), 10945);
  assert.equal(sim.groupProgress('张三'), 3);
  assert.equal(sim.role('张三'), '团长');
});

test('两个直属小团分别产生一笔管理奖，后续邀请不重复结算', () => {
  const sim = fresh();
  sim.addUser('张三'); sim.addUser('张三');
  assert.equal(amount(sim.addUser('A1'), '张三', 'management'), 0);
  const left = sim.addUser('A1');
  assert.equal(amount(left, 'A1', 'group'), 2985);
  assert.equal(amount(left, '张三', 'management'), 239);
  assert.equal(sim.get('张三').wallet.management, 239);
  assert.equal(amount(sim.addUser('A2'), '张三', 'management'), 0);
  const right = sim.addUser('A2');
  assert.equal(amount(right, 'A2', 'group'), 2985);
  assert.equal(amount(right, '张三', 'management'), 239);
  assert.equal(sim.get('张三').wallet.management, 478);
  assert.equal(sim.income('张三'), 11423);
  sim.addUser('A1'); sim.addUser('A2'); sim.addUser('张三');
  assert.equal(sim.get('张三').wallet.group, 2985);
  assert.equal(sim.get('张三').wallet.management, 478);
});

test('管理奖只发拼团区成员的直接上级，扶持区成团和更深层不向张三发奖', () => {
  const sim = fresh();
  sim.addUser('张三'); sim.addUser('张三'); sim.addUser('张三');
  sim.addUser('A3');
  const supportGroup = sim.addUser('A3');
  assert.equal(amount(supportGroup, 'A3', 'group'), 2985);
  assert.equal(amount(supportGroup, '张三', 'management'), 0);
  sim.addUser('A1', 'B9'); sim.addUser('B9');
  const deepGroup = sim.addUser('B9');
  assert.equal(amount(deepGroup, 'B9', 'group'), 2985);
  assert.equal(amount(deepGroup, 'A1', 'management'), 239);
  assert.equal(amount(deepGroup, '张三', 'management'), 0);
});

test('下级先成团也能产生管理奖，上级之后成团不重复领管理奖', () => {
  const sim = fresh();
  sim.addUser('张三', 'A9'); sim.addUser('A9'); sim.addUser('A9');
  assert.equal(sim.get('张三').wallet.group, 0);
  assert.equal(sim.get('张三').wallet.management, 239);
  sim.addUser('张三', 'A1');
  assert.equal(sim.get('张三').wallet.group, 2985);
  assert.equal(sim.get('张三').wallet.management, 239);
});

test('删除成团关键成员只撤销对应小团的奖金，再补齐只恢复一笔', () => {
  const sim = fresh();
  sim.addUser('张三'); sim.addUser('张三');
  sim.addUser('A1'); sim.addUser('A1'); sim.addUser('A2'); sim.addUser('A2');
  sim.deleteBranch('B2');
  assert.equal(sim.get('张三').wallet.group, 2985);
  assert.equal(sim.get('张三').wallet.management, 239);
  assert.equal(sim.get('A1').wallet.group, 0);
  assert.equal(sim.get('A2').wallet.group, 2985);
  const replacement = sim.addUser('A1');
  assert.equal(amount(replacement, 'A1', 'group'), 2985);
  assert.equal(amount(replacement, '张三', 'management'), 239);
  assert.equal(sim.get('张三').wallet.management, 478);
  sim.addUser('A1');
  assert.equal(sim.get('张三').wallet.management, 478);
});
