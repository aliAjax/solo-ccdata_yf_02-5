/* 数字逻辑实验台 —— 交互层（依赖 engine.js 的 LogicEngine） */
'use strict';
(function () {
  const { Circuit, TYPES, X } = window.LogicEngine;

  // ---------- 元件几何 ----------
  const LAYOUT = {
    INPUT:  { w: 76, h: 40, inputs: {},                     outputs: { out: { x: 76, y: 20 } } },
    CLOCK:  { w: 76, h: 40, inputs: {},                     outputs: { out: { x: 76, y: 20 } } },
    OUTPUT: { w: 64, h: 48, inputs: { in: { x: 0, y: 22 } }, outputs: {} },
    NOT:    { w: 70, h: 44, inputs: { a: { x: 0, y: 22 } }, outputs: { out: { x: 70, y: 22 } } },
    AND:    { w: 76, h: 52, inputs: { a: { x: 0, y: 15 }, b: { x: 0, y: 37 } }, outputs: { out: { x: 76, y: 26 } } },
    OR:     { w: 76, h: 52, inputs: { a: { x: 0, y: 15 }, b: { x: 0, y: 37 } }, outputs: { out: { x: 76, y: 26 } } },
    XOR:    { w: 76, h: 52, inputs: { a: { x: 0, y: 15 }, b: { x: 0, y: 37 } }, outputs: { out: { x: 76, y: 26 } } },
  };
  const GRID = 10;
  const snap = (v) => Math.round(v / GRID) * GRID;

  // ---------- 全局状态 ----------
  let circuit = new Circuit();
  let lastEval = null;
  let selected = null;        // {kind:'comp'|'wire', id}
  let pendingWire = null;     // {from:{comp,port}, x, y}
  let running = false;
  let timer = null;
  let clockInterval = 500;    // 全局时钟间隔 ms

  const $ = (id) => document.getElementById(id);
  const svg = $('canvas');
  const statusEl = $('status');

  // ---------- 元件形状 ----------
  function shapeSvg(comp) {
    const t = comp.type;
    switch (t) {
      case 'AND':
        return `<path class="body" d="M14,8 L40,8 A18,18 0 0 1 40,44 L14,44 Z"/>
          <line class="body" x1="0" y1="15" x2="14" y2="15"/>
          <line class="body" x1="0" y1="37" x2="14" y2="37"/>
          <line class="body" x1="58" y1="26" x2="76" y2="26"/>`;
      case 'OR':
        return `<path class="body" d="M14,8 C30,8 50,14 62,26 C50,38 30,44 14,44 Q30,26 14,8 Z"/>
          <line class="body" x1="0" y1="15" x2="17" y2="15"/>
          <line class="body" x1="0" y1="37" x2="17" y2="37"/>
          <line class="body" x1="62" y1="26" x2="76" y2="26"/>`;
      case 'XOR':
        return `<path class="body" d="M22,8 C38,8 56,14 68,26 C56,38 38,44 22,44 Q38,26 22,8 Z"/>
          <path class="body" d="M10,8 Q26,26 10,44" fill="none"/>
          <line class="body" x1="0" y1="15" x2="14" y2="15"/>
          <line class="body" x1="0" y1="37" x2="14" y2="37"/>
          <line class="body" x1="68" y1="26" x2="76" y2="26"/>`;
      case 'NOT':
        return `<path class="body" d="M16,6 L16,38 L46,22 Z"/>
          <circle class="body" cx="50" cy="22" r="4"/>
          <line class="body" x1="0" y1="22" x2="16" y2="22"/>
          <line class="body" x1="54" y1="22" x2="70" y2="22"/>`;
      case 'INPUT': {
        const v = comp.value ? 1 : 0;
        const fill = v ? '#16a34a' : '#475569';
        return `<rect class="body" x="4" y="4" width="56" height="32" rx="9"/>
          <rect x="10" y="10" width="26" height="20" rx="5" fill="${fill}"/>
          <text class="vtext" x="23" y="25" text-anchor="middle" fill="#fff">${v}</text>
          <text class="clabel" x="44" y="25" text-anchor="middle">${comp.label}</text>
          <line class="body" x1="60" y1="20" x2="76" y2="20"/>`;
      }
      case 'CLOCK': {
        const ph = comp.clock.phase;
        const run = comp.clock.running;
        const fill = ph ? '#16a34a' : '#475569';
        const wave = ph ? 'M12,26 L18,26 L18,14 L30,14 L30,26 L42,26 L42,14 L48,14'
                        : 'M12,14 L18,14 L18,26 L30,26 L30,14 L42,14 L42,26 L48,26';
        return `<rect class="body" x="4" y="4" width="56" height="32" rx="9"/>
          <path d="${wave}" fill="none" stroke="${fill}" stroke-width="2.5"/>
          <text class="clabel" x="30" y="35" text-anchor="middle" font-size="8">${run ? '▶ 运行中' : '⏸ 停止'}</text>
          <text class="clabel" x="52" y="14" text-anchor="middle" font-size="8">${comp.label}</text>
          <line class="body" x1="60" y1="20" x2="76" y2="20"/>`;
      }
      case 'OUTPUT': {
        const val = lastEval ? lastEval.portValues.get(comp.id + ':in') : X;
        const fill = val === 1 ? '#16a34a' : val === 0 ? '#475569' : '#d97706';
        const glow = val === 1 ? 'filter="url(#glow)"' : '';
        const txt = val === X ? 'X' : String(val);
        return `<line class="body" x1="0" y1="22" x2="12" y2="22"/>
          <circle class="body" cx="28" cy="22" r="15" ${glow} style="fill:${fill}"/>
          <text class="vtext" x="28" y="27" text-anchor="middle" fill="#fff">${txt}</text>
          <text class="clabel" x="28" y="46" text-anchor="middle">${comp.label}</text>`;
      }
      default: return '';
    }
  }

  function portPos(comp, port) {
    const lay = LAYOUT[comp.type];
    const p = (lay.inputs[port] || lay.outputs[port]);
    return { x: comp.x + p.x, y: comp.y + p.y };
  }

  function wirePath(x1, y1, x2, y2) {
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }

  // ---------- 渲染 ----------
  function render() {
    const parts = [];
    parts.push(`<defs>
      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1" fill="#cbd5e1"/>
      </pattern>
      <filter id="glow"><feDropShadow stdDeviation="4" flood-color="#16a34a" flood-opacity="0.8"/></filter>
    </defs>`);
    parts.push(`<rect width="100%" height="100%" fill="#fbfdff"/>`);
    parts.push(`<rect width="100%" height="100%" fill="url(#grid)" data-canvas="1"/>`);

    // 连线
    for (const w of circuit.wires.values()) {
      const fc = circuit.components.get(w.from.comp);
      const tc = circuit.components.get(w.to.comp);
      if (!fc || !tc) continue;
      const p1 = portPos(fc, w.from.port);
      const p2 = portPos(tc, w.to.port);
      const d = wirePath(p1.x, p1.y, p2.x, p2.y);
      const sinkKey = w.to.comp + ':' + w.to.port;
      const conflict = lastEval && lastEval.conflictPorts.has(sinkKey);
      const v = lastEval ? lastEval.portValues.get(sinkKey) : X;
      const cls = conflict ? 'conflict' : v === 1 ? 'v1' : v === 0 ? 'v0' : 'vx';
      const sel = selected && selected.kind === 'wire' && selected.id === w.id ? ' sel' : '';
      parts.push(`<path class="wire hit" data-wire="${w.id}" d="${d}"/>`);
      parts.push(`<path class="wire ${cls}${sel}" data-wire="${w.id}" d="${d}"/>`);
    }

    // 进行中的连线
    if (pendingWire) {
      const fc = circuit.components.get(pendingWire.from.comp);
      if (fc) {
        const p1 = portPos(fc, pendingWire.from.port);
        parts.push(`<path class="wire pending" d="${wirePath(p1.x, p1.y, pendingWire.x, pendingWire.y)}"/>`);
      }
    }

    // 元件
    for (const c of circuit.components.values()) {
      const lay = LAYOUT[c.type];
      const isSel = selected && selected.kind === 'comp' && selected.id === c.id;
      const isErr = lastEval && lastEval.errorComponents.has(c.id);
      const cls = `comp${isSel ? ' sel' : ''}${isErr ? ' err' : ''}`;
      let g = `<g class="${cls}" transform="translate(${c.x},${c.y})" data-comp="${c.id}">`;
      g += shapeSvg(c);
      // 端口
      for (const [pname, p] of Object.entries(lay.inputs)) {
        g += `<circle class="port" data-port="${c.id}:${pname}" cx="${p.x}" cy="${p.y}" r="5.5"/>`;
        if (Object.keys(LAYOUT[c.type].inputs).length > 1 || pname !== 'in') {
          g += `<text class="port-label" x="${p.x + 8}" y="${p.y - 7}">${pname}</text>`;
        }
      }
      for (const [pname, p] of Object.entries(lay.outputs)) {
        const isSrc = pendingWire && pendingWire.from.comp === c.id && pendingWire.from.port === pname;
        g += `<circle class="port${isSrc ? ' src' : ''}" data-port="${c.id}:${pname}" cx="${p.x}" cy="${p.y}" r="5.5"/>`;
      }
      // 门标签（置于元件下方）
      if (c.type !== 'INPUT' && c.type !== 'CLOCK' && c.type !== 'OUTPUT') {
        g += `<text class="clabel" x="${lay.w / 2}" y="${lay.h + 11}" text-anchor="middle">${c.label}·${TYPES[c.type].name}</text>`;
      }
      g += '</g>';
      parts.push(g);
    }

    svg.innerHTML = parts.join('');
    svg.classList.toggle('wiring', !!pendingWire);
  }

  function renderPanels() {
    // 统计
    const counts = {};
    for (const c of circuit.components.values()) counts[c.type] = (counts[c.type] || 0) + 1;
    const total = circuit.components.size;
    $('stats').innerHTML =
      `<div class="stat-line"><span>元件</span><b>${total}</b></div>` +
      `<div class="stat-line"><span>连线</span><b>${circuit.wires.size}</b></div>` +
      `<div class="stat-line"><span>仿真</span><b>${running ? '运行中' : '已停止'}</b></div>` +
      (lastEval && lastEval.errors.length
        ? `<div class="stat-line" style="color:var(--err)"><span>错误</span><b>${lastEval.errors.length}</b></div>`
        : '');

    // 错误列表
    const errBox = $('errors');
    if (lastEval && lastEval.errors.length) {
      errBox.innerHTML = lastEval.errors.map((e, i) =>
        `<div class="err-item" data-err="${i}">${e.type === 'loop' ? '🔁' : '⚡'} ${e.message}</div>`).join('');
      errBox.querySelectorAll('.err-item').forEach(el => {
        el.addEventListener('click', () => {
          const e = lastEval.errors[+el.dataset.err];
          flashComponents(e.components);
        });
      });
    } else {
      errBox.innerHTML = '<div class="err-none">✓ 无错误</div>';
    }

    // 选中信息
    const info = $('selInfo');
    if (!selected) {
      info.innerHTML = '<span class="muted">未选中任何对象</span>';
    } else if (selected.kind === 'wire') {
      info.innerHTML = `<div class="row"><span>连线</span><b>${selected.id}</b></div>
        <div class="row muted">Delete 键或「删除所选」移除</div>`;
    } else {
      const c = circuit.components.get(selected.id);
      if (!c) { info.innerHTML = '<span class="muted">未选中任何对象</span>'; return; }
      let html = `<div class="row"><span>${TYPES[c.type].name}</span><b>${c.label}</b></div>`;
      if (c.type === 'INPUT') {
        html += `<div class="row"><span>当前电平</span><b>${c.value}</b></div>
          <div class="row muted">点击元件切换 0/1</div>`;
      } else if (c.type === 'CLOCK') {
        html += `<div class="row"><span>状态</span><b>${c.clock.running ? '运行中' : '停止'}</b></div>
          <div class="row"><span>相位</span><b>${c.clock.phase}</b></div>
          <div class="row"><span>周期</span><input id="clkSpeed" type="range" min="50" max="2000" step="50" value="${c.clock.intervalMs}"><b>${c.clock.intervalMs}ms</b></div>
          <div class="row muted">点击元件启停；滑杆单独调速</div>`;
      } else if (c.type === 'OUTPUT') {
        const v = lastEval ? lastEval.portValues.get(c.id + ':in') : X;
        html += `<div class="row"><span>读数</span><b>${v === X ? 'X（未知）' : v}</b></div>`;
      }
      info.innerHTML = html;
      const clk = $('clkSpeed');
      if (clk) {
        clk.addEventListener('input', () => {
          circuit.setClockInterval(c.id, +clk.value);
          clk.nextElementSibling.textContent = clk.value + 'ms';
          update();
        });
      }
    }
  }

  function setStatus(msg) { statusEl.textContent = msg; }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2200);
  }

  function flashComponents(ids) {
    render();
    for (const id of ids) {
      const el = svg.querySelector(`[data-comp="${id}"]`);
      if (el) el.classList.add('flash');
    }
    const names = ids.map(id => circuit.components.get(id)?.label).filter(Boolean).join('、');
    if (names) setStatus('已标出相关元件：' + names);
  }

  /** 任何拓扑/状态变更后调用：全量重算 + 重绘，保证无残留电平 */
  function update() {
    lastEval = circuit.evaluate();
    render();
    renderPanels();
  }

  // ---------- 运行 / 时钟 ----------
  function setRunning(on) {
    running = on;
    const btn = $('runBtn');
    btn.textContent = on ? '⏸ 停止' : '▶ 运行';
    btn.classList.toggle('running', on);
    if (on) {
      for (const c of circuit.components.values()) {
        if (c.type === 'CLOCK') c.clock.lastTick = null;
      }
      timer = setInterval(() => {
        if (circuit.tickClocks(performance.now())) update();
      }, 30);
      setStatus('仿真运行中：时钟已启动，可实时改接电路');
    } else {
      clearInterval(timer);
      timer = null;
      setStatus('仿真已停止（编辑仍会实时重算电平）');
    }
    update();
  }

  $('runBtn').addEventListener('click', () => setRunning(!running));

  function fmtSpeed(ms) {
    const hz = 1000 / ms;
    return `${ms}ms / ${hz >= 1 ? +(hz.toFixed(1)) + 'Hz' : +(hz.toFixed(2)) + 'Hz'}`;
  }
  $('speed').addEventListener('input', (e) => {
    clockInterval = +e.target.value;
    $('speedLabel').textContent = fmtSpeed(clockInterval);
    for (const c of circuit.components.values()) {
      if (c.type === 'CLOCK') circuit.setClockInterval(c.id, clockInterval);
    }
    update();
  });

  // ---------- 放置元件 ----------
  let placeCount = 0;
  function addComponent(type) {
    const wrap = svg.getBoundingClientRect();
    const x = snap(60 + (placeCount % 6) * 90);
    const y = snap(50 + (placeCount % 5) * 80 + Math.floor(placeCount / 6) * 30);
    placeCount++;
    const id = circuit.addComponent(type, Math.min(x, wrap.width - 120), Math.min(y, wrap.height - 100));
    if (type === 'CLOCK') circuit.setClockInterval(id, clockInterval);
    selected = { kind: 'comp', id };
    setStatus(`已放置 ${TYPES[type].name} ${circuit.components.get(id).label}，拖动可调整位置`);
    update();
  }
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => addComponent(btn.dataset.add));
  });

  // ---------- 指针交互 ----------
  function svgPoint(e) {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  svg.addEventListener('pointerdown', (e) => {
    const pt = svgPoint(e);
    const portEl = e.target.closest('[data-port]');
    const compEl = e.target.closest('[data-comp]');
    const wireEl = e.target.closest('[data-wire]');

    // 1) 端口：开始连线
    if (portEl) {
      const [cid, pname] = portEl.dataset.port.split(':');
      pendingWire = { from: { comp: cid, port: pname }, x: pt.x, y: pt.y };
      setStatus('连线中：点击目标端口完成，Esc 取消');
      render();
      e.preventDefault();
      return;
    }

    // 2) 元件：选中 + 准备拖动
    if (compEl) {
      const cid = compEl.dataset.comp;
      selected = { kind: 'comp', id: cid };
      const comp = circuit.components.get(cid);
      const startX = comp.x, startY = comp.y;
      const offX = pt.x - comp.x, offY = pt.y - comp.y;
      let moved = false;
      compEl.classList.add('dragging');

      const onMove = (ev) => {
        const p = svgPoint(ev);
        const nx = snap(p.x - offX), ny = snap(p.y - offY);
        if (!moved && Math.abs(p.x - offX - startX) < 4 && Math.abs(p.y - offY - startY) < 4) return;
        moved = true;
        circuit.moveComponent(cid, Math.max(0, nx), Math.max(0, ny));
        update(); // 拖动中实时重算，运行时不残留旧电平
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!moved) handleClickComponent(cid);
        update();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      renderPanels();
      e.preventDefault();
      return;
    }

    // 3) 连线：选中
    if (wireEl) {
      selected = { kind: 'wire', id: wireEl.dataset.wire };
      setStatus('已选中连线，Delete 删除');
      update();
      return;
    }

    // 4) 空白：取消连线 / 取消选中
    if (pendingWire) {
      pendingWire = null;
      setStatus('已取消连线');
      update();
    } else if (selected) {
      selected = null;
      update();
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (!pendingWire) return;
    const pt = svgPoint(e);
    pendingWire.x = pt.x;
    pendingWire.y = pt.y;
    render();
  });

  svg.addEventListener('pointerup', (e) => {
    if (!pendingWire) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const portEl = el && el.closest ? el.closest('[data-port]') : null;
    if (portEl) {
      const [cid, pname] = portEl.dataset.port.split(':');
      const from = pendingWire.from;
      if (cid === from.comp && pname === from.port) {
        pendingWire = null; // 同一端口，静默取消
        update();
        return;
      }
      const res = circuit.addWire(from, { comp: cid, port: pname });
      if (res.ok) {
        setStatus('连线成功');
        selected = { kind: 'wire', id: res.id };
      } else {
        toast(res.error);
        setStatus(res.error);
      }
    }
    pendingWire = null;
    update();
  });

  /** 点击（未拖动）元件的行为：输入切电平、时钟启停、其余仅选中 */
  function handleClickComponent(cid) {
    const c = circuit.components.get(cid);
    if (!c) return;
    if (c.type === 'INPUT') {
      circuit.setInputValue(cid, c.value ? 0 : 1);
      setStatus(`${c.label} → ${c.value}`);
    } else if (c.type === 'CLOCK') {
      circuit.setClockRunning(cid, !c.clock.running);
      setStatus(`${c.label} ${c.clock.running ? '已启动' : '已停止'}（需顶部「运行」开启仿真）`);
    }
  }

  // ---------- 删除 / 清空 ----------
  function deleteSelected() {
    if (!selected) { toast('未选中任何对象'); return; }
    if (selected.kind === 'comp') {
      const c = circuit.components.get(selected.id);
      circuit.removeComponent(selected.id);
      setStatus(`已删除 ${c ? c.label : ''}`);
    } else {
      circuit.removeWire(selected.id);
      setStatus('已删除连线');
    }
    selected = null;
    update();
  }
  $('delBtn').addEventListener('click', deleteSelected);
  $('clearBtn').addEventListener('click', () => {
    if (!circuit.components.size || confirm('确定清空整个电路？')) {
      circuit = new Circuit();
      selected = null;
      pendingWire = null;
      placeCount = 0;
      setStatus('已清空');
      update();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (pendingWire) { pendingWire = null; setStatus('已取消连线'); update(); }
      else if (selected) { selected = null; update(); }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      deleteSelected();
    }
  });

  // ---------- 真值表 ----------
  function openTruthTable() {
    const inputs = [...circuit.components.values()].filter(c => c.type === 'INPUT');
    const outputs = [...circuit.components.values()].filter(c => c.type === 'OUTPUT');
    const pick = $('ttPick');
    if (!inputs.length) {
      pick.innerHTML = '<span class="muted">电路中没有输入元件，请先放置「输入」。</span>';
    } else {
      pick.innerHTML = inputs.map(c =>
        `<label><input type="checkbox" value="${c.id}" checked> ${c.label}</label>`).join('') +
        `<button id="ttGen" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:7px;padding:4px 14px;cursor:pointer">生成</button>`;
    }
    $('ttTable').innerHTML = outputs.length
      ? '<span class="muted">选择输入后点击「生成」。输出列：' + outputs.map(o => o.label).join('、') + '</span>'
      : '<span class="muted">电路中没有输出元件，请先放置「输出」。</span>';
    $('ttWarn').innerHTML = '';
    $('ttMask').classList.add('open');
    const gen = $('ttGen');
    if (gen) gen.addEventListener('click', generateTruthTable);
  }

  function generateTruthTable() {
    const ids = [...$('ttPick').querySelectorAll('input:checked')].map(i => i.value);
    if (!ids.length) { toast('请至少选择一个输入'); return; }
    if (ids.length > 10) { toast('输入过多（>10），组合爆炸'); return; }
    const tt = circuit.truthTable(ids, null);
    if (tt.outputs.length === 0) { toast('电路中没有输出元件'); return; }

    $('ttWarn').innerHTML = tt.errors.length
      ? `<div class="tt-warn">⚠ 电路存在错误，结果包含 X：${tt.errors.map(e => e.message).join('；')}</div>`
      : '';

    let html = '<table class="tt"><thead><tr>';
    for (const inp of tt.inputs) html += `<th>${inp.label}</th>`;
    for (const o of tt.outputs) html += `<th class="out-col">${o.label}</th>`;
    html += '</tr></thead><tbody>';
    for (const row of tt.rows) {
      html += '<tr>';
      for (const v of row.in) html += `<td class="${v ? 'one' : ''}">${v}</td>`;
      for (const v of row.out) {
        html += v === X ? '<td class="x">X</td>' : `<td class="${v ? 'one' : ''}">${v}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    $('ttTable').innerHTML = html;
    setStatus(`真值表已生成：${tt.inputs.length} 输入 × ${tt.outputs.length} 输出，共 ${tt.rows.length} 行`);
  }

  $('ttBtn').addEventListener('click', openTruthTable);
  $('ttClose').addEventListener('click', () => $('ttMask').classList.remove('open'));
  $('ttMask').addEventListener('click', (e) => {
    if (e.target === $('ttMask')) $('ttMask').classList.remove('open');
  });

  // ---------- 示例电路 ----------
  function loadDemo() {
    circuit = new Circuit();
    const i1 = circuit.addComponent('INPUT', 60, 70);
    const i2 = circuit.addComponent('INPUT', 60, 190);
    const g = circuit.addComponent('XOR', 240, 100);
    const o = circuit.addComponent('OUTPUT', 420, 110);
    circuit.addWire({ comp: i1, port: 'out' }, { comp: g, port: 'a' });
    circuit.addWire({ comp: i2, port: 'out' }, { comp: g, port: 'b' });
    circuit.addWire({ comp: g, port: 'out' }, { comp: o, port: 'in' });
    circuit.setInputValue(i1, 1);
    placeCount = 4;
    setStatus('已载入示例：I1、I2 经异或门驱动 O1。点击输入可切换电平，点击「运行」启动仿真。');
    update();
  }

  loadDemo();

  // 供自动化测试 / 调试
  window.__app = {
    get circuit() { return circuit; },
    get lastEval() { return lastEval; },
    get running() { return running; },
    update, setRunning, addComponent, deleteSelected, loadDemo,
    portPos: (cid, p) => portPos(circuit.components.get(cid), p),
  };
})();
