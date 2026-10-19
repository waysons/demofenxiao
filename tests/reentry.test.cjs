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

// 标准 1+2+4：根→B1,B2；B1→2；B2→2
function formSeven(sim, root = '张三') {
  sim.addUser(root, 'A1');
  sim.addUser(root, 'A2');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('A2', 'B3');
  return sim.addUser('A2', 'B4');
}

test('二二复制：1+2+4 成团复投挂到第一个未满 2 的空位（B1），不发直推奖、不计入七人团', () => {
  const sim = fresh('binary');
  const last = formSeven(sim);
  assert.deepEqual(new Set(sim.groupMemberIds('张三')), new Set(['张三', 'A1', 'A2', 'B1', 'B2', 'B3', 'B4']));
  assert.equal(sim.groupProgress('张三'), 7);
  assert.equal(sim.get('张三').exited, true);
  assert.equal(sim.get('张三').reentered, true);
  assert.equal(sim.get('张三').groupAwarded, true);
  assert.equal(amount(last, '张三', 'group'), 3980);
  assert.deepEqual([...last.reentryIds], ['张三:2']);
  const slide = sim.orders.find(order => order.type === 'reentry');
  assert.equal(slide.ownerId, '张三');
  assert.equal(slide.referrerId, 'B1');
  assert.equal(slide.zone, 'support');
  assert.equal(amount(slide, 'B1', 'direct'), 0);
  assert.equal(sim.get('B1').children.includes('张三:2'), true);
  assert.equal(sim.realChildren('B1').includes('张三:2'), false);
  assert.equal(sim.groupCountedChildren('B1').includes('张三:2'), false);
  assert.equal(sim.groupMemberIds('A1').includes('张三:2'), false);
  assert.equal(sim.childSlot('B1', '张三:2'), 2);
  assert.equal(sim.get('张三:2').reentry, true);
  assert.equal(sim.role('张三:2'), '复投');

  const realChild = sim.addUser('B1', 'C1');
  assert.equal(realChild.zone, 'group');
  assert.equal(realChild.position, 1);
  assert.deepEqual([...sim.get('B1').children], ['C1', '张三:2']);
  assert.equal(JSON.stringify(sim.treeDisplayChildren('B1')), JSON.stringify(['C1', null, '张三:2']));
  assert.throws(() => sim.addUser('张三:2', 'G1'), /复投点不能再邀请下级/);
});

test('二二复制 vs 左链：左支已有 1 真人时，二二挂在该支（补空 R），左链继续钻到叶子', () => {
  // 先凑满张三团并清掉首张复投场景：用独立两棵对照树更清晰
  const binary = fresh('binary');
  binary.addUser('张三', 'A1');
  binary.addUser('张三', 'A2');
  binary.addUser('A1', 'B1');
  binary.addUser('A1', 'B2');
  binary.addUser('B1', 'C1'); // B1 已有 1 真人，尚缺 R
  binary.addUser('B2', 'C2');
  binary.addUser('B2', 'C3');
  binary.addUser('A2', 'D1');
  const binDone = binary.addUser('A2', 'D2');
  assert.equal(amount(binDone, '张三', 'group'), 3980);
  // BFS：张三满 → A1 满 → A2 满 → B1 未满 2 → 挂 B1（不钻到 C1）
  assert.equal(binary.orders.find(o => o.type === 'reentry').referrerId, 'B1');
  assert.equal(binary.get('B1').children.includes('张三:2'), true);
  assert.equal(binary.get('C1').children.includes('张三:2'), false);

  const left = fresh('left');
  left.addUser('张三', 'A1');
  left.addUser('张三', 'A2');
  left.addUser('A1', 'B1');
  left.addUser('A1', 'B2');
  left.addUser('B1', 'C1');
  left.addUser('B2', 'C2');
  left.addUser('B2', 'C3');
  left.addUser('A2', 'D1');
  const leftDone = left.addUser('A2', 'D2');
  assert.equal(amount(leftDone, '张三', 'group'), 3980);
  // 左链：张三→A1→B1→C1 无左子 → 挂 C1
  assert.equal(left.orders.find(o => o.type === 'reentry').referrerId, 'C1');
  assert.equal(left.get('C1').children.includes('张三:2'), true);
  assert.equal(left.get('B1').children.includes('张三:2'), false);
});

test('左链对照：1+2+4 成团复投滑到左链尽头', () => {
  const sim = fresh('left');
  const last = formSeven(sim);
  assert.equal(sim.orders.find(order => order.type === 'reentry').referrerId, 'B1');
  assert.equal(sim.get('B1').children.includes('张三:2'), true);
  assert.equal(amount(last, '张三', 'group'), 3980);
});

test('左链：第二次成团仍走左链最底', () => {
  const sim = fresh('left');
  formSeven(sim);
  assert.equal(sim.orders.find(o => o.type === 'reentry').referrerId, 'B1');

  sim.addUser('B3', 'E1');
  sim.addUser('B3', 'E2');
  sim.addUser('B4', 'F1');
  const a2Done = sim.addUser('B4', 'F2');
  assert.equal(amount(a2Done, 'A2', 'group'), 3980);
  assert.deepEqual([...a2Done.reentryIds], ['A2:2']);

  const slides = sim.orders.filter(order => order.type === 'reentry');
  assert.equal(slides.length, 2);
  assert.equal(slides[0].referrerId, 'B1');
  assert.equal(slides[1].referrerId, 'E1');
  assert.equal(sim.get('E1').children.includes('A2:2'), true);
});

test('二二复制：第二次成团挂到下一个未满空位', () => {
  const sim = fresh('binary');
  formSeven(sim);
  assert.equal(sim.orders.find(o => o.type === 'reentry').referrerId, 'B1');

  sim.addUser('B3', 'E1');
  sim.addUser('B3', 'E2');
  sim.addUser('B4', 'F1');
  const a2Done = sim.addUser('B4', 'F2');
  assert.equal(amount(a2Done, 'A2', 'group'), 3980);
  assert.deepEqual([...a2Done.reentryIds], ['A2:2']);

  const slides = sim.orders.filter(order => order.type === 'reentry');
  assert.equal(slides.length, 2);
  assert.equal(slides[0].referrerId, 'B1');
  // A2 子树：A2 满 → B3 满 → B4 满 → E1 未满 → 挂 E1
  assert.equal(slides[1].referrerId, 'E1');
  assert.equal(sim.get('E1').children.includes('A2:2'), true);
});

test('试验版左右轮换：第二次成团改走右链最底', () => {
  const sim = fresh('alternate');
  formSeven(sim);
  assert.equal(sim.orders.find(o => o.type === 'reentry').referrerId, 'B1');

  sim.addUser('B3', 'E1');
  sim.addUser('B3', 'E2');
  sim.addUser('B4', 'F1');
  const a2Done = sim.addUser('B4', 'F2');
  assert.equal(amount(a2Done, 'A2', 'group'), 3980);
  assert.deepEqual([...a2Done.reentryIds], ['A2:2']);

  const slides = sim.orders.filter(order => order.type === 'reentry');
  assert.equal(slides.length, 2);
  assert.equal(slides[0].referrerId, 'B1');
  assert.equal(slides[1].referrerId, 'F2');
  assert.equal(sim.get('F2').children.includes('A2:2'), true);
  assert.equal(sim.get('B1').children.includes('A2:2'), false);
});

test('先有滑落后有真人：复投固定扶持区，不占 R，也不凑成团叶子', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('B2', 'C2');
  sim.addUser('B2', 'C3');
  sim.addUser('A2', 'D1');
  sim.addUser('A2', 'D2');
  assert.deepEqual([...sim.get('B1').children], ['张三:2']);
  assert.equal(sim.childSlot('B1', '张三:2'), 2);

  sim.addUser('B1', 'C1');
  assert.deepEqual([...sim.get('B1').children], ['C1', '张三:2']);
  assert.equal(sim.childSlot('B1', 'C1'), 0);
  assert.equal(sim.childSlot('B1', '张三:2'), 2);
  assert.equal(sim.realChildren('B1').length, 1);
  assert.equal(sim.isGroupComplete('A1'), false);
  assert.equal(JSON.stringify(sim.treeDisplayChildren('B1')), JSON.stringify(['C1', null, '张三:2']));

  sim.addUser('B1', 'C4');
  assert.deepEqual([...sim.get('B1').children], ['C1', 'C4', '张三:2']);
  assert.equal(sim.childSlot('B1', 'C4'), 1);
  assert.equal(sim.isGroupComplete('A1'), true);
  assert.equal(JSON.stringify(sim.treeDisplayChildren('B1')), JSON.stringify(['C1', 'C4', '张三:2']));
});

test('复投不能替真人凑叶：仅 1 真人 + 滑落不成团', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('A1', 'B1');
  sim.addUser('A1', 'B2');
  sim.addUser('B2', 'C2');
  sim.addUser('B2', 'C3');
  sim.addUser('A2', 'D1');
  const rootDone = sim.addUser('A2', 'D2');
  assert.equal(amount(rootDone, '张三', 'group'), 3980);
  assert.equal(sim.get('B1').children.includes('张三:2'), true);

  const one = sim.addUser('B1', 'C1');
  assert.equal(amount(one, 'A1', 'group'), 0);
  assert.equal(sim.isGroupComplete('A1'), false);
  assert.equal(sim.get('A1').groupAwarded, false);

  const two = sim.addUser('B1', 'C4');
  assert.equal(amount(two, 'A1', 'group'), 3980);
  assert.equal(sim.get('A1').groupAwarded, true);
});

test('复投点不占左右位，删除成团成员后重放不再留下复投单', () => {
  const sim = fresh();
  formSeven(sim);
  assert.equal(sim.get('张三').groupAwarded, true);
  assert.ok(sim.get('张三:2'));
  assert.equal(sim.orders.filter(order => order.type === 'reentry').length, 1);
  sim.deleteBranch('B4');
  assert.equal(sim.get('张三').groupAwarded, false);
  assert.equal(sim.get('张三:2'), undefined);
  assert.equal(sim.orders.some(order => order.type === 'reentry'), false);
  assert.equal(sim.get('张三').wallet.group, 0);
  const again = sim.addUser('A2', 'B5');
  assert.equal(amount(again, '张三', 'group'), 3980);
  assert.deepEqual([...again.reentryIds], ['张三:2']);
  assert.equal(sim.get('B1').children.includes('张三:2'), true);
  assert.equal(sim.groupCountedChildren('B1').includes('张三:2'), false);
});

test('单链与深链凑人数不成团；补第 2 直推仍不够；不对称不成团', () => {
  const sim = fresh();
  sim.addUser('张三', 'A1');
  let parent = 'A1';
  for (let i = 1; i <= 5; i++) {
    const id = 'C' + i;
    sim.addUser(parent, id);
    parent = id;
  }
  assert.ok(sim.groupProgress('张三') < 7);
  assert.equal(sim.isGroupComplete('张三'), false);
  assert.equal(sim.get('张三').groupAwarded, false);
  assert.equal(sim.get('张三').wallet.group, 0);
  assert.equal([...sim.users.values()].filter(u => u.reentry).length, 0);

  const second = sim.addUser('张三', 'A2');
  assert.equal(amount(second, '张三', 'group'), 0);
  assert.equal(sim.get('张三').groupAwarded, false);
  assert.deepEqual([...second.reentryIds], []);
  assert.equal(sim.isGroupComplete('张三'), false);

  const asym = fresh();
  asym.addUser('张三', 'L1');
  asym.addUser('张三', 'L2');
  asym.addUser('L1', 'M1');
  asym.addUser('M1', 'N1');
  asym.addUser('M1', 'N2');
  const last = asym.addUser('L2', 'M2');
  assert.equal(asym.isGroupComplete('张三'), false);
  assert.equal(amount(last, '张三', 'group'), 0);
  assert.equal(asym.get('张三').groupAwarded, false);
});

test('对照左链：席位按邀请顺序固定，第 3 人挂本人扶持区', () => {
  const sim = fresh('left');
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addUser('张三', 'B3');
  sim.addUser('B3', 'C1');
  assert.deepEqual([...sim.realChildren('张三')], ['B1', 'B2', 'B3']);
  sim.addUser('B3', 'C2');
  assert.deepEqual([...sim.realChildren('张三')], ['B1', 'B2', 'B3']);
});

test('双轨：本人树最多 2 真人，第 3 邀请滑到空位且裂变不回挂', () => {
  const sim = fresh('binary');
  sim.addUser('张三', 'B1');
  sim.addUser('张三', 'B2');
  sim.addUser('张三', 'B3');
  assert.deepEqual([...sim.realChildren('张三')], ['B1', 'B2']);
  assert.equal(sim.get('B3').referrerId, 'B1');
  sim.addUser('B3', 'C1');
  assert.deepEqual([...sim.realChildren('张三')], ['B1', 'B2']);
  assert.deepEqual([...sim.inviteOrderedRealChildren('张三')], ['B1', 'B2', 'B3']);
});

test('三三：setSlideMode 接受 ternary，非法值仍抛错', () => {
  const sim = fresh();
  assert.equal(sim.setSlideMode('ternary'), 'ternary');
  assert.throws(() => sim.setSlideMode('quad'), /binary、ternary、ternary_biz、ternary_biz_v2、left 或 alternate/);
});

test('纯商业版：setSlideMode 接受 ternary_biz', () => {
  const sim = fresh();
  assert.equal(sim.setSlideMode('ternary_biz'), 'ternary_biz');
});

test('三三：本人邀满 3 人均挂本人树；第 3 人为 support；邀请满 3 即团长', () => {
  const sim = fresh('ternary');
  const o1 = sim.addUser('张三', 'A1');
  const o2 = sim.addUser('张三', 'A2');
  const o3 = sim.addUser('张三', 'A3');
  assert.equal(o1.zone, 'group');
  assert.equal(o2.zone, 'group');
  assert.equal(o3.zone, 'support');
  assert.deepEqual([...sim.realChildren('张三')], ['A1', 'A2', 'A3']);
  assert.equal(sim.get('A3').referrerId, '张三');
  assert.equal(sim.get('A3').inviteReferrerId, '张三');
  assert.equal(sim.role('张三'), '团长');
  assert.equal(sim.groupMemberIds('张三').includes('A3'), false);
  assert.equal(amount(o3, '张三', 'direct'), 4975);
});

test('三三：第 4 人滑到 BFS 首个未满 3 空位，邀请人仍拿直推奖', () => {
  const sim = fresh('ternary');
  sim.addUser('张三', 'A1');
  sim.addUser('张三', 'A2');
  sim.addUser('张三', 'A3');
  const fourth = sim.addUser('张三', 'A4');
  assert.equal(fourth.zone, 'ternary_slide');
  assert.equal(sim.get('A4').inviteReferrerId, '张三');
  // 张三满 3 → A1 未满 → 挂 A1
  assert.equal(sim.get('A4').referrerId, 'A1');
  assert.equal(sim.get('张三').children.includes('A4'), false);
  assert.equal(sim.get('A1').children.includes('A4'), true);
  assert.equal(amount(fourth, '张三', 'direct'), 4975);
  assert.deepEqual([...sim.inviteOrderedRealChildren('张三')], ['A1', 'A2', 'A3', 'A4']);
  assert.deepEqual([...sim.realChildren('张三')], ['A1', 'A2', 'A3']);
});

test('三三：1+2+4 成团复投按 ternaryOpen 挂扶持区（张三未满 3 则挂本人），不计团', () => {
  const sim = fresh('ternary');
  const last = formSeven(sim);
  assert.equal(amount(last, '张三', 'group'), 3980);
  assert.equal(sim.get('张三').exited, true);
  assert.equal(sim.get('张三').reentered, true);
  const slide = sim.orders.find(order => order.type === 'reentry');
  assert.equal(slide.ownerId, '张三');
  // 张三树上仅 A1/A2（宽 3 未满）→ 复投挂张三扶持区
  assert.equal(slide.referrerId, '张三');
  assert.equal(slide.zone, 'support');
  assert.equal(amount(slide, '张三', 'direct'), 0);
  assert.equal(sim.get('张三').children.includes('张三:2'), true);
  assert.equal(sim.realChildren('张三').includes('张三:2'), false);
  assert.equal(sim.groupMemberIds('张三').includes('张三:2'), false);
  assert.equal(sim.childSlot('张三', '张三:2'), 2);
  assert.equal(sim.get('张三:2').reentry, true);
});

test('纯商业版：未成团时第 3、4 人挂本人扶持区', () => {
  const sim = fresh('ternary_biz');
  const o1 = sim.addUser('张三', 'A1');
  const o2 = sim.addUser('张三', 'A2');
  const o3 = sim.addUser('张三', 'A3');
  const o4 = sim.addUser('张三', 'A4');
  assert.equal(o1.zone, 'group');
  assert.equal(o2.zone, 'group');
  assert.equal(o3.zone, 'support');
  assert.equal(o4.zone, 'support');
  assert.deepEqual([...sim.realChildren('张三')], ['A1', 'A2', 'A3', 'A4']);
  assert.equal(sim.get('A3').referrerId, '张三');
  assert.equal(sim.get('A4').referrerId, '张三');
  assert.equal(sim.groupMemberIds('张三').includes('A3'), false);
});

test('纯商业版：成团复投滑到最左下方 B1，计团占拼团区', () => {
  const sim = fresh('ternary_biz');
  const last = formSeven(sim);
  assert.equal(amount(last, '张三', 'group'), 3980);
  const slide = sim.orders.find(order => order.type === 'reentry');
  assert.equal(slide.ownerId, '张三');
  assert.equal(slide.referrerId, 'B1');
  assert.equal(slide.zone, 'group');
  assert.equal(sim.get('张三:2').countsForGroup, true);
  assert.equal(sim.get('张三:2').reentry, true);
  assert.equal(sim.childSlot('B1', '张三:2'), 0);
  assert.equal(sim.groupCountedChildren('B1').includes('张三:2'), true);
  assert.equal(sim.realChildren('B1').includes('张三:2'), false);
  assert.equal(amount(slide, 'B1', 'direct'), 0);
});

test('纯商业版：计团复投算作左下成团叶子，可与真人一起凑满两侧', () => {
  const sim = fresh('ternary_biz');
  formSeven(sim);
  // 张三:2 挂在 B1 并计团；再邀 C1 后 B1 计数满 2
  assert.equal(sim.groupCountedChildren('B1').length, 1);
  assert.equal(sim.groupCountedChildren('B1')[0], '张三:2');
  sim.addUser('B1', 'C1');
  assert.equal(sim.groupCountedChildren('B1').length, 2);
  assert.equal(sim.get('张三:2').countsForGroup, true);
  // 补齐 B2 两叶后 A1 成团（计团复投充当 B1 的一叶）
  sim.addUser('B2', 'C2');
  const a1Done = sim.addUser('B2', 'C3');
  assert.equal(sim.isGroupComplete('A1'), true);
  assert.equal(amount(a1Done, 'A1', 'group'), 3980);
  assert.equal(sim.groupMemberIds('A1').includes('张三:2'), true);
});

test('纯商业版：落点已满 2 时复投进扶持区不计团', () => {
  const sim = fresh('ternary_biz');
  formSeven(sim);
  sim.addUser('B1', 'C1');
  assert.equal(sim.groupCountedChildren('B1').length, 2);
  const parent = sim.get('B1');
  const fakeExited = sim.get('B2');
  fakeExited.groupAwarded = true;
  fakeExited.reentered = false;
  const order = sim.addReentry({
    positionId: 'B2:2', ownerId: 'B2', round: 2, parent, exited: fakeExited
  });
  assert.equal(sim.get('B2:2').countsForGroup, false);
  assert.equal(order.zone, 'support');
  assert.equal(sim.childSlot('B1', 'B2:2'), 2);
  assert.equal(sim.groupCountedChildren('B1').includes('B2:2'), false);
});

test('纯商业版：成团后第3人进原号扶持区，第4人起挂复投点', () => {
  const sim = fresh('ternary_biz');
  formSeven(sim);
  assert.ok(sim.get('张三:2'));
  // formSeven 后邀请数=2；下一人为第 3 → 原号扶持区（可先七人成团再刷扶持区）
  const third = sim.addUser('张三', 'X1');
  assert.equal(sim.get('X1').referrerId, '张三');
  assert.equal(sim.get('X1').inviteReferrerId, '张三');
  assert.equal(third.zone, 'support');
  assert.equal(sim.get('张三').children.includes('X1'), true);
  assert.equal(sim.get('张三:2').children.includes('X1'), false);
  assert.equal(amount(third, '张三', 'direct'), 4975);
  // 第 4 人起才滑到最新复投点
  const fourth = sim.addUser('张三', 'X2');
  assert.equal(sim.get('X2').referrerId, '张三:2');
  assert.equal(sim.get('X2').inviteReferrerId, '张三');
  assert.equal(fourth.zone, 'group');
  const fifth = sim.addUser('张三', 'X3');
  assert.equal(sim.get('X3').referrerId, '张三:2');
  assert.equal(fifth.zone, 'group');
});
