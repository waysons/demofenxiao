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

test('仅 B3 裂变时，B3 排到左位，B1/B2 后移', () => {
  const sim = fresh();
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addUser('张三', 'B3');
  assert.deepEqual([...sim.realChildren('张三')], ['B1', 'B2', 'B3']);
  sim.addUser('B3', 'C1');
  assert.deepEqual([...sim.realChildren('张三')], ['B3', 'B1', 'B2']);
  assert.equal(sim.get('张三').children.indexOf('B3'), 0);
});

test('同档都无裂变时按 joinedAt 新→旧', () => {
  const sim = fresh();
  const o1 = sim.addUser('张三', 'B1');
  const o2 = sim.addUser('张三', 'B2');
  sim.get('B1').joinedAt = 1000;
  sim.get('B2').joinedAt = 2000;
  sim.sortMarketSiblings('张三');
  assert.deepEqual([...sim.realChildren('张三')], ['B2', 'B1']);
});
