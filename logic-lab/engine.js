/*
 * 数字逻辑实验台 —— 门级仿真引擎
 * 三值逻辑：0 / 1 / 'X'（未知）
 * 纯逻辑、无 DOM 依赖，浏览器与 Node 均可加载（UMD）。
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.LogicEngine = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const X = 'X';

  // 元件类型定义：端口与中文名
  const TYPES = {
    INPUT:  { inputs: [],          outputs: ['out'], name: '输入' },
    CLOCK:  { inputs: [],          outputs: ['out'], name: '时钟' },
    OUTPUT: { inputs: ['in'],      outputs: [],      name: '输出' },
    NOT:    { inputs: ['a'],       outputs: ['out'], name: '非门' },
    AND:    { inputs: ['a', 'b'],  outputs: ['out'], name: '与门' },
    OR:     { inputs: ['a', 'b'],  outputs: ['out'], name: '或门' },
    XOR:    { inputs: ['a', 'b'],  outputs: ['out'], name: '异或门' },
  };

  const LABEL_PREFIX = { INPUT: 'I', CLOCK: 'CLK', OUTPUT: 'O', NOT: 'U', AND: 'U', OR: 'U', XOR: 'U' };

  // ---- 三值门语义 ----
  function notX(a) { return a === X ? X : (a ? 0 : 1); }
  function andX(a, b) {
    if (a === 0 || b === 0) return 0;
    if (a === 1 && b === 1) return 1;
    return X;
  }
  function orX(a, b) {
    if (a === 1 || b === 1) return 1;
    if (a === 0 && b === 0) return 0;
    return X;
  }
  function xorX(a, b) {
    if (a === X || b === X) return X;
    return a ^ b;
  }

  function evalGate(type, ins) {
    switch (type) {
      case 'NOT': return notX(ins.a);
      case 'AND': return andX(ins.a, ins.b);
      case 'OR':  return orX(ins.a, ins.b);
      case 'XOR': return xorX(ins.a, ins.b);
      default: throw new Error('非门级元件: ' + type);
    }
  }

  let _uid = 1;

  class Circuit {
    constructor() {
      this.components = new Map(); // id -> {id,type,label,x,y,value,clock}
      this.wires = new Map();      // id -> {id,from:{comp,port},to:{comp,port}}
      this._counters = {};         // 每类元件的编号计数
    }

    // ---------- 结构操作 ----------
    addComponent(type, x, y) {
      if (!TYPES[type]) throw new Error('未知元件类型: ' + type);
      const id = 'c' + (_uid++);
      const n = (this._counters[type] = (this._counters[type] || 0) + 1);
      const comp = {
        id, type,
        label: LABEL_PREFIX[type] + n,
        x: x || 0, y: y || 0,
        value: 0, // INPUT 的当前电平
        clock: type === 'CLOCK'
          ? { running: false, intervalMs: 500, phase: 0, lastTick: null }
          : null,
      };
      this.components.set(id, comp);
      return id;
    }

    removeComponent(id) {
      if (!this.components.has(id)) return false;
      this.components.delete(id);
      for (const [wid, w] of [...this.wires]) {
        if (w.from.comp === id || w.to.comp === id) this.wires.delete(wid);
      }
      return true;
    }

    moveComponent(id, x, y) {
      const c = this.components.get(id);
      if (!c) return false;
      c.x = x; c.y = y;
      return true;
    }

    portsOf(compId) {
      const c = this.components.get(compId);
      if (!c) return null;
      return TYPES[c.type];
    }

    /** 规范化连线方向：输出端口为 from，输入端口为 to。返回 null 表示非法。 */
    _normalizeEndpoints(a, b) {
      const ca = this.components.get(a.comp), cb = this.components.get(b.comp);
      if (!ca || !cb) return null;
      const ta = TYPES[ca.type], tb = TYPES[cb.type];
      const aIsOut = ta.outputs.includes(a.port), aIsIn = ta.inputs.includes(a.port);
      const bIsOut = tb.outputs.includes(b.port), bIsIn = tb.inputs.includes(b.port);
      if (aIsOut && bIsIn) return { from: a, to: b };
      if (bIsOut && aIsIn) return { from: b, to: a };
      return null; // 出-出 或 入-入 或端口不存在
    }

    /**
     * 添加连线。返回 {ok:true,id} 或 {ok:false,error}。
     * 允许同一输入端口挂多条线 —— 由 evaluate() 检测“重复驱动”。
     */
    addWire(pa, pb) {
      const norm = this._normalizeEndpoints(pa, pb);
      if (!norm) return { ok: false, error: '非法连线：必须连接一个输出端口与一个输入端口' };
      for (const w of this.wires.values()) {
        if (w.from.comp === norm.from.comp && w.from.port === norm.from.port &&
            w.to.comp === norm.to.comp && w.to.port === norm.to.port) {
          return { ok: false, error: '连线已存在' };
        }
      }
      const id = 'w' + (_uid++);
      this.wires.set(id, { id, from: norm.from, to: norm.to });
      return { ok: true, id };
    }

    removeWire(id) { return this.wires.delete(id); }

    setInputValue(id, v) {
      const c = this.components.get(id);
      if (!c || c.type !== 'INPUT') return false;
      c.value = v ? 1 : 0;
      return true;
    }

    setClockRunning(id, running) {
      const c = this.components.get(id);
      if (!c || c.type !== 'CLOCK') return false;
      c.clock.running = !!running;
      c.clock.lastTick = null; // 重新计时
      return true;
    }

    setClockInterval(id, ms) {
      const c = this.components.get(id);
      if (!c || c.type !== 'CLOCK') return false;
      c.clock.intervalMs = Math.max(20, ms | 0);
      return true;
    }

    /**
     * 推进所有运行中的时钟。now 为毫秒时间戳。
     * 返回是否有相位翻转（需要重新求值）。
     */
    tickClocks(now) {
      let changed = false;
      for (const c of this.components.values()) {
        if (c.type !== 'CLOCK' || !c.clock.running) continue;
        const ck = c.clock;
        if (ck.lastTick === null) { ck.lastTick = now; continue; }
        // 大间隔可能跨多个周期，直接按周期数翻转
        let elapsed = now - ck.lastTick;
        if (elapsed >= ck.intervalMs) {
          const flips = Math.floor(elapsed / ck.intervalMs);
          ck.phase = (flips % 2 === 1) ? (ck.phase ? 0 : 1) : ck.phase;
          ck.lastTick += flips * ck.intervalMs;
          changed = true;
        }
      }
      return changed;
    }

    // ---------- 求值 ----------

    /**
     * 全量重算。纯函数式：结果只取决于当前拓扑与元件状态，
     * 因此任何移动/增删/改接之后调用都能得到无残留的新电平。
     * 返回 {
     *   portValues: Map<'cid:port', 0|1|X>,   // 所有端口（含输入端口读到的网络值）
     *   errors: [{type:'conflict'|'loop', components:[cid...], message}],
     *   errorComponents: Set<cid>,
     * }
     */
    evaluate() {
      const comps = [...this.components.values()];
      const key = (c, p) => c + ':' + p;

      // 1) 并查集构建网络（net）
      const parent = new Map();
      const find = (k) => {
        let r = k;
        while (parent.get(r) !== r) r = parent.get(r);
        let cur = k;
        while (parent.get(cur) !== r) { const nxt = parent.get(cur); parent.set(cur, r); cur = nxt; }
        return r;
      };
      const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
      for (const c of comps) {
        const t = TYPES[c.type];
        for (const p of t.inputs) parent.set(key(c.id, p), key(c.id, p));
        for (const p of t.outputs) parent.set(key(c.id, p), key(c.id, p));
      }
      for (const w of this.wires.values()) {
        union(key(w.from.comp, w.from.port), key(w.to.comp, w.to.port));
      }

      // 2) 汇总每个网络的驱动端口（输出端口）与负载端口（输入端口）
      const nets = new Map(); // root -> {drivers:[{comp,port}], sinks:[{comp,port}]}
      const netOf = (k) => {
        const r = find(k);
        if (!nets.has(r)) nets.set(r, { drivers: [], sinks: [] });
        return nets.get(r);
      };
      for (const c of comps) {
        const t = TYPES[c.type];
        for (const p of t.outputs) netOf(key(c.id, p)).drivers.push({ comp: c.id, port: p });
        for (const p of t.inputs) netOf(key(c.id, p)).sinks.push({ comp: c.id, port: p });
      }

      // 3) 重复驱动检测
      const errors = [];
      const conflictRoots = new Set();
      const conflictPorts = new Set(); // 冲突网络上的所有端口 'cid:port'（供 UI 标红）
      const labelOf = (cid) => this.components.get(cid).label;
      for (const [root, net] of nets) {
        if (net.drivers.length > 1) {
          conflictRoots.add(root);
          for (const d of net.drivers) conflictPorts.add(key(d.comp, d.port));
          for (const s of net.sinks) conflictPorts.add(key(s.comp, s.port));
          const compIds = [...new Set(net.drivers.map(d => d.comp))];
          errors.push({
            type: 'conflict',
            components: compIds,
            message: '端口被重复驱动：' +
              net.drivers.map(d => `${labelOf(d.comp)}.${d.port}（${TYPES[this.components.get(d.comp).type].name}）`).join('、') +
              ' 连到了同一网络',
          });
        }
      }

      // 4) 元件级依赖图（驱动元件 -> 被驱动元件）
      const adj = new Map(); // cid -> Set<cid>
      for (const c of comps) adj.set(c.id, new Set());
      for (const net of nets.values()) {
        for (const d of net.drivers) {
          for (const s of net.sinks) adj.get(d.comp).add(s.comp);
        }
      }

      // 5) Tarjan 强连通分量 → 组合环路检测
      const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
      let idx = 0;
      const sccs = [];
      const strongconnect = (v) => {
        index.set(v, idx); low.set(v, idx); idx++;
        stack.push(v); onStack.add(v);
        for (const w of adj.get(v)) {
          if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
          else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        }
        if (low.get(v) === index.get(v)) {
          const scc = [];
          let w;
          do { w = stack.pop(); onStack.delete(w); scc.push(w); } while (w !== v);
          sccs.push(scc);
        }
      };
      for (const c of comps) if (!index.has(c.id)) strongconnect(c.id);

      const loopSet = new Set();
      for (const scc of sccs) {
        const isLoop = scc.length > 1 || (scc.length === 1 && adj.get(scc[0]).has(scc[0]));
        if (!isLoop) continue;
        for (const cid of scc) loopSet.add(cid);
        const cyc = scc.map(labelOf).join(' → ');
        errors.push({
          type: 'loop',
          components: [...scc],
          message: `检测到组合环路：${cyc}。环路输出已置为未知(X)，请断开环路。`,
        });
      }

      // 6) 拓扑排序（对 SCC 缩点后的 DAG 做 Kahn），环路 SCC 输出 X
      const sccOf = new Map();
      sccs.forEach((scc, i) => scc.forEach(cid => sccOf.set(cid, i)));
      const indeg = new Array(sccs.length).fill(0);
      const sadj = new Map(); // sccIdx -> Set<sccIdx>
      sccs.forEach((_, i) => sadj.set(i, new Set()));
      for (const c of comps) {
        for (const nb of adj.get(c.id)) {
          const a = sccOf.get(c.id), b = sccOf.get(nb);
          if (a !== b && !sadj.get(a).has(b)) { sadj.get(a).add(b); indeg[b]++; }
        }
      }
      const queue = [];
      indeg.forEach((d, i) => { if (d === 0) queue.push(i); });
      const order = [];
      while (queue.length) {
        const s = queue.shift();
        order.push(s);
        for (const t of sadj.get(s)) { if (--indeg[t] === 0) queue.push(t); }
      }

      // 7) 按拓扑序求值
      const portValues = new Map(); // 'cid:port' -> 0|1|X
      const netValue = new Map();   // root -> 0|1|X（驱动值；冲突/无驱动 → X）
      const readNet = (cid, p) => {
        const root = find(key(cid, p));
        if (conflictRoots.has(root)) return X;
        const v = netValue.get(root);
        return v === undefined ? X : v;
      };

      for (const si of order) {
        const scc = sccs[si];
        const isLoop = scc.some(cid => loopSet.has(cid));
        for (const cid of scc) {
          const c = this.components.get(cid);
          const t = TYPES[c.type];
          if (isLoop) {
            for (const p of t.outputs) portValues.set(key(cid, p), X);
          } else {
            let outs = {};
            if (c.type === 'INPUT') outs = { out: c.value ? 1 : 0 };
            else if (c.type === 'CLOCK') outs = { out: c.clock.phase };
            else if (c.type === 'OUTPUT') outs = {};
            else {
              const ins = {};
              for (const p of t.inputs) ins[p] = readNet(cid, p);
              outs = { out: evalGate(c.type, ins) };
            }
            for (const p of t.outputs) portValues.set(key(cid, p), outs[p]);
          }
          // 该元件的输出端口值写入其所在网络
          for (const p of t.outputs) {
            const root = find(key(cid, p));
            if (!conflictRoots.has(root)) netValue.set(root, portValues.get(key(cid, p)));
          }
        }
      }
      // 输入端口读取网络值（便于 UI 显示与测试断言）
      for (const c of comps) {
        for (const p of TYPES[c.type].inputs) portValues.set(key(c.id, p), readNet(c.id, p));
      }

      const errorComponents = new Set();
      for (const e of errors) e.components.forEach(cid => errorComponents.add(cid));

      return { portValues, errors, errorComponents, netValue, conflictPorts };
    }

    /** 所有输出元件当前读到的电平：{oid: 0|1|X} */
    outputValues(evalResult) {
      const res = evalResult || this.evaluate();
      const out = {};
      for (const c of this.components.values()) {
        if (c.type === 'OUTPUT') out[c.id] = res.portValues.get(c.id + ':in');
      }
      return out;
    }

    /**
     * 对选定的输入元件集合生成真值表。
     * inputIds 顺序即列顺序；输出口为所有 OUTPUT 元件（或显式给定 outputIds）。
     * 时钟按当前相位冻结，不参与枚举。
     * 返回 {inputs:[{id,label}], outputs:[{id,label}], rows:[{in:[],out:[]}], errors}
     * 生成后恢复输入原值。
     */
    truthTable(inputIds, outputIds) {
      const ins = (inputIds || [...this.components.values()].filter(c => c.type === 'INPUT').map(c => c.id))
        .map(id => this.components.get(id)).filter(Boolean);
      const outs = (outputIds || [...this.components.values()].filter(c => c.type === 'OUTPUT').map(c => c.id))
        .map(id => this.components.get(id)).filter(Boolean);
      const saved = ins.map(c => c.value);
      const rows = [];
      const n = ins.length;
      let lastErrors = [];
      for (let mask = 0; mask < (1 << n); mask++) {
        for (let i = 0; i < n; i++) ins[i].value = (mask >> (n - 1 - i)) & 1;
        const res = this.evaluate();
        lastErrors = res.errors;
        rows.push({
          in: ins.map(c => c.value),
          out: outs.map(o => res.portValues.get(o.id + ':in')),
        });
      }
      ins.forEach((c, i) => { c.value = saved[i]; });
      return {
        inputs: ins.map(c => ({ id: c.id, label: c.label })),
        outputs: outs.map(c => ({ id: c.id, label: c.label })),
        rows,
        errors: lastErrors,
      };
    }
  }

  return { X, TYPES, Circuit, gates: { notX, andX, orX, xorX } };
});
