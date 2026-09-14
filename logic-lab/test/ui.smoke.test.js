/* UI 冒烟测试：在 jsdom 中加载真实页面，模拟放置/连线/点击/运行/真值表 */
'use strict';
const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0;
function test(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { console.error('  ✗ ' + name); process.exitCode = 1; }
}

(async () => {
  const dom = await JSDOM.fromFile(path.join(__dirname, '..', 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      // jsdom 缺省无 elementFromPoint / confirm，打桩
      window.document.elementFromPoint = () => null;
      window.confirm = () => true;
      if (!window.performance) window.performance = { now: () => Date.now() };
    },
  });
  await new Promise(res => {
    if (dom.window.document.readyState === 'complete') res();
    else dom.window.addEventListener('load', res);
  });
  await sleep(50); // 等外部脚本执行完

  const { window } = dom;
  const { document } = window;
  const app = window.__app;

  console.log('页面加载与示例电路');
  test('__app 已暴露，示例电路含 4 元件 3 连线', app && app.circuit.components.size === 4 && app.circuit.wires.size === 3);
  test('SVG 渲染出 4 个元件组', document.querySelectorAll('#canvas [data-comp]').length === 4);
  test('SVG 渲染出 3 条连线', document.querySelectorAll('#canvas path.wire:not(.hit)').length === 3);
  test('初始无错误', document.querySelector('#errors').textContent.includes('无错误'));
  const xorOut = () => {
    const o = [...app.circuit.components.values()].find(c => c.type === 'OUTPUT');
    return app.lastEval.portValues.get(o.id + ':in');
  };
  test('示例 XOR(1,0) 输出为 1', xorOut() === 1);

  console.log('模拟点击输入切换电平');
  const fire = (el, type, opts = {}) => {
    el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: 0, ...opts }));
  };
  const inputComp = [...app.circuit.components.values()].find(c => c.type === 'INPUT' && c.value === 1);
  const inputEl = document.querySelector(`[data-comp="${inputComp.id}"]`);
  fire(inputEl, 'pointerdown');
  fire(window, 'pointerup'); // 无移动 → 视为点击
  test('点击输入后电平 1→0', app.circuit.components.get(inputComp.id).value === 0);
  test('输出随拓扑重算变为 0（XOR(0,0)）', xorOut() === 0);

  console.log('模拟端口连线');
  // 放置一个 NOT 门和一个输出，用端口事件连线
  app.addComponent('NOT');
  app.addComponent('OUTPUT');
  const not = [...app.circuit.components.values()].find(c => c.type === 'NOT');
  const out2 = [...app.circuit.components.values()].filter(c => c.type === 'OUTPUT')[1];
  // 每次渲染都会重建 SVG，元素需在每次操作前重新查询
  const q = (sel) => document.querySelector(sel);
  const wire = (fromSel, toSel) => {
    fire(q(fromSel), 'pointerdown');
    document.elementFromPoint = () => q(toSel); // pointerdown 触发重渲染，目标需在此刻才查询
    fire(q('#canvas'), 'pointerup');
  };
  // 连线1：I1.out → NOT.a
  fire(q(`[data-port="${inputComp.id}:out"]`), 'pointerdown');
  test('进入连线状态（pending 线渲染）', !!document.querySelector('path.wire.pending'));
  document.elementFromPoint = () => q(`[data-port="${not.id}:a"]`);
  fire(q('#canvas'), 'pointerup');
  // 连线2：NOT.out → O2.in
  wire(`[data-port="${not.id}:out"]`, `[data-port="${out2.id}:in"]`);
  test('两条新连线已建立', app.circuit.wires.size === 5);
  test('NOT 链路电平正确（I1=0 → NOT → 1）', app.lastEval.portValues.get(out2.id + ':in') === 1);

  console.log('非法连线与错误标出');
  // 重复驱动：再把 I2.out 也接到 O2.in
  const i2 = [...app.circuit.components.values()].find(c => c.type === 'INPUT' && c.id !== inputComp.id);
  wire(`[data-port="${i2.id}:out"]`, `[data-port="${out2.id}:in"]`);
  test('冲突被检测并展示', document.querySelector('#errors').textContent.includes('重复驱动'));
  test('冲突元件带 err 高亮类', document.querySelectorAll('#canvas .comp.err').length >= 2);
  test('被重复驱动的输出读数为 X', app.lastEval.portValues.get(out2.id + ':in') === 'X');
  // 出-出直连应被拒绝
  const wiresBefore = app.circuit.wires.size;
  wire(`[data-port="${i2.id}:out"]`, `[data-port="${not.id}:out"]`);
  test('出-出连线被拒绝', app.circuit.wires.size === wiresBefore);

  console.log('删除选中');
  const delWire = [...app.circuit.wires.values()].find(w => w.to.comp === out2.id && w.from.comp === i2.id);
  app.circuit.removeWire(delWire.id); // 先清掉冲突
  app.update();
  test('移除冲突线后错误消失', document.querySelector('#errors').textContent.includes('无错误'));
  const compCount = app.circuit.components.size;
  // 选中 NOT 门再按 Delete
  fire(q(`[data-comp="${not.id}"]`), 'pointerdown');
  fire(window, 'pointerup');
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  test('Delete 删除选中元件', app.circuit.components.size === compCount - 1);

  console.log('运行仿真与时钟');
  app.addComponent('CLOCK');
  const clk = [...app.circuit.components.values()].find(c => c.type === 'CLOCK');
  app.circuit.setClockInterval(clk.id, 50);
  app.circuit.setClockRunning(clk.id, true);
  document.querySelector('#runBtn').click();
  test('运行状态开启', app.running === true);
  await sleep(180);
  test('时钟相位已翻转（setInterval 驱动）', app.circuit.components.get(clk.id).clock.lastTick !== null);
  document.querySelector('#runBtn').click();
  test('停止运行', app.running === false);

  console.log('真值表弹窗');
  document.querySelector('#ttBtn').click();
  test('弹窗打开', document.querySelector('#ttMask').classList.contains('open'));
  document.querySelector('#ttGen').click();
  const rows = document.querySelectorAll('#ttTable table.tt tbody tr');
  test('真值表行数 = 2^输入数（2 个输入 → 4 行）', rows.length === 4);
  const header = [...document.querySelectorAll('#ttTable th')].map(th => th.textContent);
  test('表头包含输入与输出标签', header.includes('I1') && header.some(h => h.startsWith('O')));
  document.querySelector('#ttClose').click();
  test('弹窗关闭', !document.querySelector('#ttMask').classList.contains('open'));

  console.log('\n' + (process.exitCode ? '存在失败用例' : `全部 ${passed} 项 UI 冒烟检查通过`));
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('冒烟测试异常:', e); process.exit(1); });
