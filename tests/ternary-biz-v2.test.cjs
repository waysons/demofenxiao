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
const amount = (order, id, type) =>
  order.payouts.filter(p => p.userId === id && p.type === type).reduce((sum, p) => sum + p.cents, 0);

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
