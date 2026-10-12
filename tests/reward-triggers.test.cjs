const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/simulation-engine.js'), 'utf8') + '\nthis.Simulation = Simulation;', context);
const fresh = () => new context.Simulation();
const amount = (order, id, type) => order.payouts.filter(p => p.userId === id && p.type === type).reduce((sum, p) => sum + p.cents, 0);

test('仅邀齐两名直推不成团、不发拼团奖或管理奖', () => {
  const sim = fresh();
  const first = sim.addUser('张三');
  assert.equal(amount(first, '张三', 'group'), 0);
  assert.equal(sim.groupProgress('张三'), 2);
  const second = sim.addUser('张三');
  assert.equal(amount(second, '张三', 'group'), 0);
  assert.equal(amount(second, '张三', 'management'), 0);
  assert.equal(sim.income('张三'), 7960);
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
  assert.equal(sim.income('张三'), 7960);
  assert.equal(amount(sim.addUser('A2'), '张三', 'management'), 0);
  assert.equal(sim.groupProgress('张三'), 6);
  assert.equal(sim.get('张三').wallet.group, 0);
  const right = sim.addUser('A2');
  assert.equal(amount(right, 'A2', 'group'), 0);
  assert.equal(amount(right, '张三', 'group'), 2985);
  assert.equal(amount(right, '张三', 'management'), 0);
  assert.equal(sim.get('张三').wallet.management, 0);
  assert.equal(sim.groupProgress('张三'), 7);
  assert.equal(sim.role('张三'), '普通');
  assert.equal(sim.role('A1'), '普通');
  assert.equal(sim.role('A2'), '普通');
  assert.equal(sim.income('张三'), 10945);
  sim.addUser('A1'); sim.addUser('A2'); sim.addUser('张三');
  assert.equal(sim.get('张三').wallet.group, 2985);
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
  assert.equal(sim.get('张三').wallet.group, 2985);
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
  assert.equal(amount(replacement, '张三', 'group'), 2985);
  assert.equal(amount(replacement, '张三', 'management'), 0);
  assert.equal(sim.get('张三').wallet.management, 0);
  sim.addUser('A1');
  assert.equal(sim.get('张三').wallet.management, 0);
});
