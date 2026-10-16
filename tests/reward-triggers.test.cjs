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
  assert.equal(sim.groupProgress('张三'), 8);
  assert.equal(sim.role('张三'), '普通');
  assert.equal(sim.role('A1'), '普通');
  assert.equal(sim.role('A2'), '普通');
  assert.equal(sim.income('张三'), 10945);
  sim.addUser('A1'); sim.addUser('A2'); sim.addUser('张三');
  assert.equal(sim.get('张三').wallet.group, 2985);
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

test('直链满七且仅一直推不成团，补第二直推后发奖；A3 入团后为团长', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('B1', 'C1');
  const seventh = sim.addUser('C1', 'D1');
  assert.equal(sim.get('张三').teamSize, 6);
  assert.equal(sim.get('A1').teamSize, 5);
  assert.equal(amount(seventh, '张三', 'group'), 0);
  assert.equal(sim.get('张三').wallet.group, 0);
  assert.equal(sim.role('张三'), '普通');
  const second = sim.addUser('张三', 'A2');
  assert.equal(amount(second, '张三', 'group'), 2985);
  const third = sim.addUser('张三', 'A3');
  assert.equal(sim.role('张三'), '团长');
  assert.equal(amount(third, '张三', 'group'), 0);
  assert.equal(sim.get('张三').wallet.group, 2985);
  assert.deepEqual([...sim.get('张三').children], ['A1', 'A2', 'A3']);
});

test('席位按邀请顺序固定，第 3 名直推下单本身不发订单奖', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('A2', 'B2');
  const support = sim.addUser('张三', 'A3');
  assert.equal(amount(support, '张三', 'order'), 0);
  assert.equal(amount(support, '张三', 'direct'), 3980);
  assert.deepEqual([...sim.get('张三').children], ['A1', 'A2', 'A3']);
  sim.addUser('A3', 'B1');
  assert.deepEqual([...sim.get('张三').children], ['A1', 'A2', 'A3']);
  assert.equal(support.zone, 'support');
  assert.equal(sim.get('张三').wallet.order, 0);
});

test('扶持区第 2 直推：支路直推满 3 但未成团时上级可收订单奖，根仍为普通时不向上', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('A1', 'B3');
  sim.addUser('B3', 'C1');
  const forward = sim.addUser('B3', 'C2');
  assert.equal(sim.role('A1'), '团长');
  assert.equal(sim.isGroupComplete('A1'), false);
  assert.equal(sim.role('张三'), '普通');
  assert.ok(amount(forward, 'A1', 'order') > 0);
  assert.equal(amount(forward, 'A1', 'order'), 1990);
  assert.equal(amount(forward, '张三', 'order'), 0);
});

test('根已是团长时扶持区第 2 直推不再发订单奖', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('A1'); sim.addUser('A1');
  sim.addUser('A2'); sim.addUser('A2');
  sim.addUser('张三', 'A3');
  assert.equal(sim.role('张三'), '团长');
  sim.addUser('A3', 'S1');
  sim.addUser('A3', 'S2');
  sim.addUser('A3', 'S3');
  sim.addUser('S3', 'T1');
  const blocked = sim.addUser('S3', 'T2');
  assert.equal(sim.role('A3'), '团长');
  assert.equal(amount(blocked, 'A3', 'order'), 0);
  assert.equal(amount(blocked, '张三', 'order'), 0);
});

test('第 2 名直推才向上发扶持区订单奖，左右位跳过，已成团长则停止', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('A1', 'B3');
  assert.equal(amount(sim.addUser('B3', 'C1'), 'A1', 'order'), 0);
  const skipped = sim.addUser('B3', 'C2');
  assert.equal(sim.role('A1'), '团长');
  assert.equal(amount(skipped, 'A1', 'order'), 1990);
  assert.equal(amount(skipped, '张三', 'order'), 0);
  assert.equal(sim.role('张三'), '普通');
});

test('扶持区订单奖在上级已成团长时不再向上发放；代理奖按下单时等级结算并在删除后重放', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('A1', 'B3');
  sim.addUser('B3', 'C1');
  const trigger = sim.addUser('B3', 'C2');
  assert.equal(trigger.payouts.filter(payout => payout.type === 'order').length, 1);
  assert.equal(amount(trigger, 'A1', 'order'), 1990);
  assert.equal(amount(trigger, '张三', 'order'), 0);
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
