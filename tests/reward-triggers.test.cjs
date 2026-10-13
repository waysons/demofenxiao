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
  assert.equal(sim.orders.flatMap(order => order.payouts).filter(payout => payout.userId === '张三' && payout.type === 'group').length, 1);
  assert.equal(sim.role('张三'), '团长');
  assert.equal(sim.role('A1'), '普通');
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

test('直链凑满七人也只给张三发一次拼团奖，A3 入团后才成为团长', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('B1', 'C1');
  const seventh = sim.addUser('C1', 'D1');
  assert.equal(sim.get('张三').teamSize, 7);
  assert.equal(sim.get('A1').teamSize, 5);
  assert.equal(amount(seventh, '张三', 'group'), 2985);
  assert.equal(sim.get('A1').wallet.group, 0);
  assert.equal(sim.role('张三'), '普通');
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

test('第 2 名直推才向上发扶持区订单奖，左右位跳过，已是团长则停止', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('A1', 'B3');
  assert.equal(amount(sim.addUser('B3', 'C1'), 'A1', 'order'), 0);
  const skipped = sim.addUser('B3', 'C2');
  assert.equal(amount(skipped, 'A1', 'order'), 1990);
  assert.equal(amount(skipped, '张三', 'order'), 0);
  assert.equal(sim.role('张三'), '普通');

  const leaders = fresh();
  leaders.addUser('张三', 'A1');
  leaders.addUser('张三', 'A2');
  leaders.addUser('A1');
  leaders.addUser('A1');
  leaders.addUser('A2');
  leaders.addUser('A2');
  leaders.addUser('张三', 'A3');
  assert.equal(leaders.role('张三'), '团长');
  leaders.addUser('A3', 'S1');
  leaders.addUser('A3', 'S2');
  leaders.addUser('A3', 'S3');
  leaders.addUser('S3', 'T1');
  const blocked = leaders.addUser('S3', 'T2');
  assert.equal(amount(blocked, 'A3', 'order'), 1990);
  assert.equal(amount(blocked, '张三', 'order'), 0);
});

test('订单奖最多向上 8 层，代理奖按下单时等级结算并在删除后重放', () => {
  const sim = fresh();
  let parent = '张三';
  const chain = ['张三'];
  for (let depth = 1; depth <= 9; depth++) {
    sim.addUser(parent);
    sim.addUser(parent);
    const child = sim.addUser(parent).buyerId;
    chain.push(child);
    parent = child;
  }
  const tip = chain[9];
  sim.addUser(tip);
  const trigger = sim.addUser(tip);
  const paid = trigger.payouts.filter(payout => payout.type === 'order').map(payout => payout.userId);
  assert.equal(paid.length, 8);
  assert.equal(paid.includes('张三'), false);
  assert.equal(paid.includes(chain[1]), true);
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
