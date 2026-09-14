/* 引擎验收测试：node test/engine.test.js */
'use strict';
const assert = require('assert');
const { X, Circuit } = require('../engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

/** 搭一个 门(类型) + 两个输入 + 一个输出 的夹具 */
function gateFixture(type) {
  const c = new Circuit();
  const i1 = c.addComponent('INPUT');
  const i2 = c.addComponent('INPUT');
  const g = c.addComponent(type);
  const o = c.addComponent('OUTPUT');
  const t = c.portsOf(g);
  if (t.inputs.includes('a')) c.addWire({ comp: i1, port: 'out' }, { comp: g, port: 'a' });
  if (t.inputs.includes('b')) c.addWire({ comp: i2, port: 'out' }, { comp: g, port: 'b' });
  c.addWire({ comp: g, port: 'out' }, { comp: o, port: 'in' });
  return { c, i1, i2, g, o };
}
const outVal = (c, o) => c.evaluate().portValues.get(o + ':in');

console.log('门级真值');
for (const [type, table] of Object.entries({
  AND: [[0,0,0],[0,1,0],[1,0,0],[1,1,1]],
  OR:  [[0,0,0],[0,1,1],[1,0,1],[1,1,1]],
  XOR: [[0,0,0],[0,1,1],[1,0,1],[1,1,0]],
})) {
  test(type + ' 全部输入组合', () => {
    const { c, i1, i2, o } = gateFixture(type);
    for (const [a, b, exp] of table) {
      c.setInputValue(i1, a); c.setInputValue(i2, b);
      assert.strictEqual(outVal(c, o), exp, `${type}(${a},${b}) 应为 ${exp}`);
    }
  });
}
test('NOT 0→1, 1→0', () => {
  const { c, i1, o } = gateFixture('NOT');
  c.setInputValue(i1, 0); assert.strictEqual(outVal(c, o), 1);
  c.setInputValue(i1, 1); assert.strictEqual(outVal(c, o), 0);
});

console.log('未连接输入按未知(X)处理');
test('未连接的输出端口读数为 X', () => {
  const c = new Circuit();
  const o = c.addComponent('OUTPUT');
  assert.strictEqual(outVal(c, o), X);
});
test('AND(1, 悬空)=X，AND(0, 悬空)=0', () => {
  const c = new Circuit();
  const i1 = c.addComponent('INPUT'); const g = c.addComponent('AND'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: i1, port: 'out' }, { comp: g, port: 'a' });
  c.addWire({ comp: g, port: 'out' }, { comp: o, port: 'in' });
  c.setInputValue(i1, 1); assert.strictEqual(outVal(c, o), X);
  c.setInputValue(i1, 0); assert.strictEqual(outVal(c, o), 0);
});
test('OR(1, 悬空)=1，OR(0, 悬空)=X；XOR(1, 悬空)=X；NOT(悬空)=X', () => {
  const mk = (type) => {
    const c = new Circuit();
    const i1 = c.addComponent('INPUT'); const g = c.addComponent(type); const o = c.addComponent('OUTPUT');
    c.addWire({ comp: i1, port: 'out' }, { comp: g, port: 'a' });
    c.addWire({ comp: g, port: 'out' }, { comp: o, port: 'in' });
    return { c, i1, o };
  };
  let f = mk('OR'); f.c.setInputValue(f.i1, 1); assert.strictEqual(outVal(f.c, f.o), 1);
  f.c.setInputValue(f.i1, 0); assert.strictEqual(outVal(f.c, f.o), X);
  f = mk('XOR'); f.c.setInputValue(f.i1, 1); assert.strictEqual(outVal(f.c, f.o), X);
  f = mk('NOT'); f.c.setInputValue(f.i1, 1); assert.strictEqual(outVal(f.c, f.o), 0);
  f.c.removeComponent(f.i1); assert.strictEqual(outVal(f.c, f.o), X);
});
test('X 沿链路传播：悬空 → AND → NOT → 输出 = X', () => {
  const c = new Circuit();
  const g1 = c.addComponent('AND'); const g2 = c.addComponent('NOT'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: g1, port: 'out' }, { comp: g2, port: 'a' });
  c.addWire({ comp: g2, port: 'out' }, { comp: o, port: 'in' });
  assert.strictEqual(outVal(c, o), X);
});

console.log('扇出与级联');
test('一个输入扇出驱动两个门', () => {
  const c = new Circuit();
  const i1 = c.addComponent('INPUT');
  const g1 = c.addComponent('NOT'); const g2 = c.addComponent('NOT');
  const o1 = c.addComponent('OUTPUT'); const o2 = c.addComponent('OUTPUT');
  c.addWire({ comp: i1, port: 'out' }, { comp: g1, port: 'a' });
  c.addWire({ comp: i1, port: 'out' }, { comp: g2, port: 'a' });
  c.addWire({ comp: g1, port: 'out' }, { comp: o1, port: 'in' });
  c.addWire({ comp: g2, port: 'out' }, { comp: o2, port: 'in' });
  c.setInputValue(i1, 1);
  const vals = c.outputValues();
  assert.strictEqual(vals[o1], 0); assert.strictEqual(vals[o2], 0);
});
test('多级级联：XOR + AND（半加器求和位/进位）', () => {
  const c = new Circuit();
  const a = c.addComponent('INPUT'); const b = c.addComponent('INPUT');
  const xr = c.addComponent('XOR'); const an = c.addComponent('AND');
  const sum = c.addComponent('OUTPUT'); const carry = c.addComponent('OUTPUT');
  for (const [i, g] of [[a, xr], [a, an]]) c.addWire({ comp: i, port: 'out' }, { comp: g, port: 'a' });
  for (const [i, g] of [[b, xr], [b, an]]) c.addWire({ comp: i, port: 'out' }, { comp: g, port: 'b' });
  c.addWire({ comp: xr, port: 'out' }, { comp: sum, port: 'in' });
  c.addWire({ comp: an, port: 'out' }, { comp: carry, port: 'in' });
  c.setInputValue(a, 1); c.setInputValue(b, 1);
  const vals = c.outputValues();
  assert.strictEqual(vals[sum], 0); assert.strictEqual(vals[carry], 1);
});

console.log('非法接线：同一端口被重复驱动');
test('两个输入驱动同一端口 → 报冲突并标出两个元件，输出为 X', () => {
  const c = new Circuit();
  const i1 = c.addComponent('INPUT'); const i2 = c.addComponent('INPUT'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: i1, port: 'out' }, { comp: o, port: 'in' });
  c.addWire({ comp: i2, port: 'out' }, { comp: o, port: 'in' });
  c.setInputValue(i1, 1); c.setInputValue(i2, 1); // 即使同值也算冲突
  const res = c.evaluate();
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.errors[0].type, 'conflict');
  assert.deepStrictEqual(new Set(res.errors[0].components), new Set([i1, i2]));
  assert.ok(res.errors[0].message.includes('I1') && res.errors[0].message.includes('I2'));
  assert.strictEqual(res.portValues.get(o + ':in'), X);
});
test('两个与门输出短接 → 冲突标出两个门；移除一条线后恢复', () => {
  const c = new Circuit();
  const i1 = c.addComponent('INPUT');
  const g1 = c.addComponent('AND'); const g2 = c.addComponent('AND'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: i1, port: 'out' }, { comp: g1, port: 'a' });
  c.addWire({ comp: i1, port: 'out' }, { comp: g2, port: 'a' });
  const w1 = c.addWire({ comp: g1, port: 'out' }, { comp: o, port: 'in' }).id;
  c.addWire({ comp: g2, port: 'out' }, { comp: o, port: 'in' });
  let res = c.evaluate();
  assert.strictEqual(res.errors[0].type, 'conflict');
  assert.deepStrictEqual(new Set(res.errors[0].components), new Set([g1, g2]));
  c.removeWire(w1);
  res = c.evaluate();
  assert.strictEqual(res.errors.length, 0);
  c.setInputValue(i1, 1);
  assert.strictEqual(c.evaluate().portValues.get(o + ':in'), X); // b 悬空
});
test('出-出、入-入直连与重复连线被拒绝', () => {
  const c = new Circuit();
  const g1 = c.addComponent('AND'); const g2 = c.addComponent('AND');
  assert.strictEqual(c.addWire({ comp: g1, port: 'out' }, { comp: g2, port: 'out' }).ok, false);
  assert.strictEqual(c.addWire({ comp: g1, port: 'a' }, { comp: g2, port: 'a' }).ok, false);
  const r = c.addWire({ comp: g1, port: 'out' }, { comp: g2, port: 'a' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(c.addWire({ comp: g1, port: 'out' }, { comp: g2, port: 'a' }).ok, false);
});

console.log('非法接线：组合环路');
test('非门自环 → 报环路并标出该元件，输出 X', () => {
  const c = new Circuit();
  const g = c.addComponent('NOT'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: g, port: 'out' }, { comp: g, port: 'a' });
  c.addWire({ comp: g, port: 'out' }, { comp: o, port: 'in' });
  const res = c.evaluate();
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.errors[0].type, 'loop');
  assert.deepStrictEqual(res.errors[0].components, [g]);
  assert.ok(res.errors[0].message.includes(c.components.get(g).label));
  assert.strictEqual(res.portValues.get(o + ':in'), X);
});
test('双非门互环 → 两个元件都被标出；断环后恢复正常', () => {
  const c = new Circuit();
  const i1 = c.addComponent('INPUT');
  const g1 = c.addComponent('NOT'); const g2 = c.addComponent('NOT'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: i1, port: 'out' }, { comp: g1, port: 'a' });
  c.addWire({ comp: g1, port: 'out' }, { comp: g2, port: 'a' });
  const loopWire = c.addWire({ comp: g2, port: 'out' }, { comp: g1, port: 'a' }).id; // 成环
  c.addWire({ comp: g2, port: 'out' }, { comp: o, port: 'in' });
  let res = c.evaluate();
  assert.strictEqual(res.errors.filter(e => e.type === 'loop').length, 1);
  const loopErr = res.errors.find(e => e.type === 'loop');
  assert.deepStrictEqual(new Set(loopErr.components), new Set([g1, g2]));
  assert.strictEqual(res.portValues.get(o + ':in'), X);
  c.removeWire(loopWire); // 断环
  res = c.evaluate();
  assert.strictEqual(res.errors.length, 0);
  c.setInputValue(i1, 1);
  assert.strictEqual(c.evaluate().portValues.get(o + ':in'), 1); // 双非门 → 原值
});

console.log('时钟：启停与调速');
test('时钟按间隔翻转，停止后保持', () => {
  const c = new Circuit();
  const k = c.addComponent('CLOCK'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: k, port: 'out' }, { comp: o, port: 'in' });
  c.setClockInterval(k, 100);
  c.setClockRunning(k, true);
  c.tickClocks(1000); // 起始计时
  assert.strictEqual(outVal(c, o), 0);
  c.tickClocks(1100); assert.strictEqual(outVal(c, o), 1);
  c.tickClocks(1200); assert.strictEqual(outVal(c, o), 0);
  c.tickClocks(1250); assert.strictEqual(outVal(c, o), 0); // 未到间隔
  c.setClockRunning(k, false);
  c.tickClocks(5000); assert.strictEqual(outVal(c, o), 0); // 停止不翻转
});
test('调速后按新间隔翻转；一次 tick 跨多周期按奇偶翻转', () => {
  const c = new Circuit();
  const k = c.addComponent('CLOCK');
  c.setClockInterval(k, 100);
  c.setClockRunning(k, true);
  c.tickClocks(0);
  c.tickClocks(350); // 3 个周期 → 翻转奇数次
  assert.strictEqual(c.components.get(k).clock.phase, 1);
  c.setClockInterval(k, 50); // 调速
  c.tickClocks(400); // 距 lastTick=300 已过 100ms = 2 个新周期 → 不变
  assert.strictEqual(c.components.get(k).clock.phase, 1);
  c.tickClocks(450); // 又过 50ms → 翻 1 次
  assert.strictEqual(c.components.get(k).clock.phase, 0);
});
test('时钟驱动计数链路：CLK → NOT → 输出随相位变化', () => {
  const c = new Circuit();
  const k = c.addComponent('CLOCK'); const g = c.addComponent('NOT'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: k, port: 'out' }, { comp: g, port: 'a' });
  c.addWire({ comp: g, port: 'out' }, { comp: o, port: 'in' });
  c.setClockInterval(k, 100); c.setClockRunning(k, true);
  c.tickClocks(0); assert.strictEqual(outVal(c, o), 1);
  c.tickClocks(100); assert.strictEqual(outVal(c, o), 0);
});

console.log('拓扑变更后重算（无残留电平）');
test('运行中改接：I2 从 AND.b 移到 OR.b，输出立即按新拓扑计算', () => {
  const c = new Circuit();
  const i1 = c.addComponent('INPUT'); const i2 = c.addComponent('INPUT');
  const ga = c.addComponent('AND'); const go = c.addComponent('OR');
  const o1 = c.addComponent('OUTPUT'); const o2 = c.addComponent('OUTPUT');
  c.addWire({ comp: i1, port: 'out' }, { comp: ga, port: 'a' });
  const w = c.addWire({ comp: i2, port: 'out' }, { comp: ga, port: 'b' }).id;
  c.addWire({ comp: i2, port: 'out' }, { comp: go, port: 'b' });
  c.addWire({ comp: ga, port: 'out' }, { comp: o1, port: 'in' });
  c.addWire({ comp: go, port: 'out' }, { comp: o2, port: 'in' });
  c.setInputValue(i1, 1); c.setInputValue(i2, 1);
  assert.strictEqual(outVal(c, o1), 1);
  // 改接：I2 → AND.b 的线断开，AND.b 悬空
  c.removeWire(w);
  const res = c.evaluate();
  assert.strictEqual(res.portValues.get(o1 + ':in'), X, 'AND 应因 b 悬空变 X，不得残留旧值 1');
  assert.strictEqual(res.portValues.get(o2 + ':in'), 1);
});
test('移动元件不改变电平但重算结果一致；删除元件后下游变 X', () => {
  const c = new Circuit();
  const i1 = c.addComponent('INPUT'); const g = c.addComponent('NOT'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: i1, port: 'out' }, { comp: g, port: 'a' });
  c.addWire({ comp: g, port: 'out' }, { comp: o, port: 'in' });
  c.setInputValue(i1, 1);
  assert.strictEqual(outVal(c, o), 0);
  c.moveComponent(g, 300, 200); // 拖动
  assert.strictEqual(outVal(c, o), 0);
  c.removeComponent(i1); // 删除输入
  assert.strictEqual(outVal(c, o), X, '删除驱动源后不得残留旧电平');
});
test('输入值变化立即反映到输出', () => {
  const { c, i1, o } = gateFixture('NOT');
  c.setInputValue(i1, 0); assert.strictEqual(outVal(c, o), 1);
  c.setInputValue(i1, 1); assert.strictEqual(outVal(c, o), 0);
});

console.log('真值表生成');
test('XOR 电路真值表与理论一致，且生成后恢复输入原值', () => {
  const { c, i1, i2, o } = gateFixture('XOR');
  c.setInputValue(i1, 1); c.setInputValue(i2, 0); // 先置非零状态
  const tt = c.truthTable([i1, i2], [o]);
  assert.strictEqual(tt.rows.length, 4);
  const expect = { '0,0': 0, '0,1': 1, '1,0': 1, '1,1': 0 };
  for (const row of tt.rows) {
    assert.strictEqual(row.out[0], expect[row.in.join(',')], `行 ${row.in} 错误`);
  }
  assert.strictEqual(c.components.get(i1).value, 1, '生成后应恢复 I1 原值');
  assert.strictEqual(c.components.get(i2).value, 0);
});
test('选定输入子集生成真值表；悬空门输入产生 X 单元格', () => {
  const c = new Circuit();
  const i1 = c.addComponent('INPUT'); const i2 = c.addComponent('INPUT');
  const g = c.addComponent('AND'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: i1, port: 'out' }, { comp: g, port: 'a' });
  c.addWire({ comp: g, port: 'out' }, { comp: o, port: 'in' });
  const tt = c.truthTable([i1], [o]); // 只选 I1，AND.b 悬空
  assert.strictEqual(tt.rows.length, 2);
  assert.strictEqual(tt.rows[0].out[0], 0);  // AND(0, X)=0
  assert.strictEqual(tt.rows[1].out[0], X);  // AND(1, X)=X
  assert.strictEqual(tt.inputs[0].label, 'I1');
  void i2;
});
test('三输入多数表决电路真值表', () => {
  const c = new Circuit();
  const a = c.addComponent('INPUT'), b = c.addComponent('INPUT'), d = c.addComponent('INPUT');
  const ab = c.addComponent('AND'), ad = c.addComponent('AND'), bd = c.addComponent('AND');
  const o1 = c.addComponent('OR'), o2 = c.addComponent('OR');
  const out = c.addComponent('OUTPUT');
  c.addWire({ comp: a, port: 'out' }, { comp: ab, port: 'a' });
  c.addWire({ comp: b, port: 'out' }, { comp: ab, port: 'b' });
  c.addWire({ comp: a, port: 'out' }, { comp: ad, port: 'a' });
  c.addWire({ comp: d, port: 'out' }, { comp: ad, port: 'b' });
  c.addWire({ comp: b, port: 'out' }, { comp: bd, port: 'a' });
  c.addWire({ comp: d, port: 'out' }, { comp: bd, port: 'b' });
  c.addWire({ comp: ab, port: 'out' }, { comp: o1, port: 'a' });
  c.addWire({ comp: ad, port: 'out' }, { comp: o1, port: 'b' });
  c.addWire({ comp: o1, port: 'out' }, { comp: o2, port: 'a' });
  c.addWire({ comp: bd, port: 'out' }, { comp: o2, port: 'b' });
  c.addWire({ comp: o2, port: 'out' }, { comp: out, port: 'in' });
  const tt = c.truthTable([a, b, d], [out]);
  assert.strictEqual(tt.rows.length, 8);
  for (const row of tt.rows) {
    const maj = row.in.reduce((s, v) => s + v, 0) >= 2 ? 1 : 0;
    assert.strictEqual(row.out[0], maj, `多数表决 ${row.in} 应为 ${maj}`);
  }
});
test('存在环路时真值表仍生成但携带错误信息，环路输出为 X', () => {
  const c = new Circuit();
  const i1 = c.addComponent('INPUT');
  const g = c.addComponent('NOT'); const o = c.addComponent('OUTPUT');
  c.addWire({ comp: i1, port: 'out' }, { comp: g, port: 'a' });
  c.addWire({ comp: g, port: 'out' }, { comp: g, port: 'a' }); // 自环（与 I1 构成冲突+环路）
  c.addWire({ comp: g, port: 'out' }, { comp: o, port: 'in' });
  const tt = c.truthTable([i1], [o]);
  assert.ok(tt.errors.length > 0);
  assert.ok(tt.rows.every(r => r.out[0] === X));
});

console.log('\n' + (process.exitCode ? '存在失败用例' : `全部 ${passed} 个用例通过`));
