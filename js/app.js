/* ============================================================
   Multiple Input Calculator
   Evaluate one expression across many inputs at once.
   Vanilla JS + math.js. No build step.
   ============================================================ */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const el = {
    expr: $('#expr'), exprPrefix: $('#exprPrefix'), exprStatus: $('#exprStatus'),
    examples: $('#examples'), params: $('#params'), paramList: $('#paramList'),
    addForm: $('#addForm'), valueInput: $('#valueInput'), pills: $('#pills'),
    tbody: $('#tbody'), empty: $('#empty'), colIn: $('#colIn'), tiles: $('#tiles'),
    plot: $('#plot'), readout: $('#cursorReadout'), toast: $('#toast'),
    theme: $('#theme'), themeLabel: $('#themeLabel')
  };

  const STORE = 'mic.v2';
  const MAX_INPUTS = 2000;
  const MAX_RANGE = 1000;

  const EXAMPLES = [
    'x^2 + 3x - 5', '2x + 3', 'sin(x)', 'sqrt(x)', '1/x', 'e^x',
    'log(x, 2)', 'x!', 'mod(x, 3)', '9/5 x + 32', 'a x^2 + b x + c', 'nthRoot(x, 3)'
  ];

  /* ---------- state ---------- */
  const state = { expr: '', values: [], params: {}, sel: -1 };
  let compiled = null;      // compiled math.js expression
  let primary = 'x';        // the variable the inputs feed
  let paramNames = [];      // other free symbols
  let exprError = null;     // string | null

  /* ---------- helpers ---------- */
  const toNum = (r) => {
    if (typeof r === 'number') return r;
    if (r && typeof r.toNumber === 'function') { try { return r.toNumber(); } catch (_) { return NaN; } }
    return NaN;
  };

  function fmt(v) {
    if (v === undefined || v === null) return '—';
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return 'NaN';
      if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
      if (v === 0) return '0';
      return math.format(v, { precision: 12 });
    }
    if (typeof v === 'boolean') return String(v);
    try { return math.format(v, { precision: 12 }); } catch (_) { return String(v); }
  }

  // shorter form for stat tiles, where 12 digits is noise
  function fmtShort(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fmt(v);
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a < 1e-4 || a >= 1e9) return math.format(v, { notation: 'exponential', precision: 4 });
    return math.format(v, { precision: 6 });
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.toast.classList.remove('show'), 1700);
  }

  /* ---------- expression ---------- */
  function analyse() {
    const src = state.expr.trim();
    compiled = null; exprError = null; paramNames = []; primary = 'x';
    if (!src) return;

    let node;
    try { node = math.parse(src); }
    catch (err) { exprError = cleanErr(err); return; }

    if (node.filter((n) => n.isAssignmentNode || n.isFunctionAssignmentNode).length) {
      exprError = 'Assignments are not supported — enter an expression in terms of a variable.';
      return;
    }

    const free = [];
    node.filter((n, path, parent) =>
      n.isSymbolNode && !(parent && parent.isFunctionNode && path === 'fn')
    ).forEach((n) => {
      if (!(n.name in math) && free.indexOf(n.name) === -1) free.push(n.name);
    });

    free.sort();
    primary = free.indexOf('x') > -1 ? 'x' : (free[0] || 'x');
    paramNames = free.filter((n) => n !== primary);

    try {
      compiled = node.compile();
      compiled.evaluate(scopeFor(1));          // smoke test
    } catch (err) {
      // a runtime failure at x = 1 may still be a valid expression (e.g. 1/(x-1) is fine,
      // sqrt(x) at a negative x is fine) — only flag it if it fails everywhere we try.
      const alt = [2, 0.5, -1, 10];
      const ok = alt.some((v) => { try { compiled.evaluate(scopeFor(v)); return true; } catch (_) { return false; } });
      if (!ok) { exprError = cleanErr(err); compiled = null; }
    }
  }

  function cleanErr(err) {
    return String((err && err.message) || err).replace(/\s*\(char \d+\)/, '');
  }

  function scopeFor(v) {
    const s = {};
    paramNames.forEach((n) => { s[n] = Number(state.params[n] ?? 1); });
    s[primary] = v;
    return s;
  }

  function evalAt(v) {
    if (!compiled) return { err: 'no expression' };
    try { return { value: compiled.evaluate(scopeFor(v)) }; }
    catch (err) { return { err: cleanErr(err) }; }
  }

  /* ---------- input parsing: lists, ranges, expressions ---------- */
  function evalNum(src) {
    const r = math.evaluate(src);
    const n = toNum(r);
    if (!Number.isFinite(n)) throw new Error('"' + src.trim() + '" is not a finite number');
    return n;
  }

  function parseValues(text) {
    const out = [], errs = [];
    text.split(/[,;\n]+/).forEach((chunk) => {
      const t = chunk.trim();
      if (!t) return;
      try {
        const m = t.match(/^(.*?)(?:\.\.|…|\bto\b)(.*)$/);
        if (m) {
          let endSrc = m[2], stepSrc = null;
          const colon = endSrc.lastIndexOf(':');
          if (colon > -1) { stepSrc = endSrc.slice(colon + 1); endSrc = endSrc.slice(0, colon); }
          const byMatch = endSrc.match(/^(.*?)\b(?:step|by)\b(.*)$/i);
          if (byMatch) { stepSrc = byMatch[2]; endSrc = byMatch[1]; }

          const start = evalNum(m[1]);
          const end = evalNum(endSrc);
          let step = stepSrc !== null ? Math.abs(evalNum(stepSrc)) : 1;
          if (!step) throw new Error('step cannot be 0');
          if (end < start) step = -step;
          const count = Math.floor((end - start) / step + 1e-9) + 1;
          if (count > MAX_RANGE) throw new Error('that range makes ' + count + ' values (limit ' + MAX_RANGE + ')');
          for (let i = 0; i < count; i++) out.push(round12(start + i * step));
          return;
        }
        // plain value, or several separated by spaces
        const parts = t.split(/\s+/).filter(Boolean);
        if (parts.length > 1 && parts.every((p) => /^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(p))) {
          parts.forEach((p) => out.push(evalNum(p)));
        } else {
          out.push(evalNum(t));
        }
      } catch (err) {
        errs.push(cleanErr(err));
      }
    });
    return { values: out, errs: errs };
  }

  // kills 0.30000000000000004 drift from stepped ranges
  const round12 = (n) => Number(n.toPrecision(12));

  function addValues(text) {
    const { values, errs } = parseValues(text);
    if (!values.length) { toast(errs[0] ? 'Can’t read that' : 'Nothing to add'); if (errs[0]) setStatus(errs[0], 'err'); return false; }
    const room = MAX_INPUTS - state.values.length;
    if (values.length > room) { values.length = Math.max(0, room); toast('Input limit reached'); }
    state.values = state.values.concat(values);
    if (errs.length) toast('Skipped ' + errs.length + ' bad ' + (errs.length === 1 ? 'entry' : 'entries'));
    return true;
  }

  /* ---------- status line ---------- */
  function setStatus(msg, kind) {
    el.exprStatus.textContent = msg || '';
    el.exprStatus.className = 'status' + (kind ? ' ' + kind : '');
  }

  function renderStatus(rows) {
    if (!state.expr.trim()) { setStatus(''); return; }
    if (exprError) { setStatus(exprError, 'err'); return; }
    const bad = rows.filter((r) => r.err).length;
    if (bad) { setStatus('Valid — but ' + bad + ' of ' + rows.length + ' input' + (rows.length === 1 ? '' : 's') + ' is outside the domain', 'err'); return; }
    const vars = [primary].concat(paramNames).join(', ');
    setStatus('Ready — variable' + (paramNames.length ? 's' : '') + ': ' + vars, 'ok');
  }

  /* ---------- render ---------- */
  function renderParams() {
    el.exprPrefix.textContent = 'f(' + primary + ') =';
    el.colIn.textContent = primary;
    if (!paramNames.length) { el.params.hidden = true; el.paramList.textContent = ''; return; }
    el.params.hidden = false;
    el.paramList.textContent = '';
    paramNames.forEach((name) => {
      if (state.params[name] === undefined) state.params[name] = 1;
      const v = Number(state.params[name]);
      const row = document.createElement('div');
      row.className = 'param';
      row.innerHTML =
        '<span class="param-name">' + esc(name) + '</span>' +
        '<input type="range" min="-10" max="10" step="0.1" aria-label="' + esc(name) + ' slider">' +
        '<input type="number" step="any" aria-label="' + esc(name) + ' value">';
      const range = row.querySelector('input[type=range]');
      const num = row.querySelector('input[type=number]');
      range.value = Math.max(-10, Math.min(10, v));
      num.value = v;
      range.addEventListener('input', () => { state.params[name] = Number(range.value); num.value = range.value; refresh({ keepParams: true }); });
      num.addEventListener('input', () => {
        const n = Number(num.value);
        if (!Number.isNaN(n)) { state.params[name] = n; range.value = Math.max(-10, Math.min(10, n)); refresh({ keepParams: true }); }
      });
      el.paramList.appendChild(row);
    });
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderPills() {
    el.pills.textContent = '';
    state.values.forEach((v, i) => {
      const pill = document.createElement('span');
      pill.className = 'pill' + (state.sel === i ? ' on' : '');
      pill.innerHTML = '<span>' + esc(fmt(v)) + '</span><button type="button" aria-label="Remove input ' + esc(fmt(v)) + '">×</button>';
      pill.querySelector('span').addEventListener('click', () => select(i));
      pill.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); removeAt(i); });
      el.pills.appendChild(pill);
    });
  }

  function renderTable(rows) {
    el.tbody.textContent = '';
    el.empty.hidden = rows.length > 0;
    if (!rows.length) {
      el.empty.textContent = state.expr.trim()
        ? 'Expression is set. Add inputs for ' + primary + ' on the left.'
        : 'No inputs yet. Add a list or a range on the left.';
      return;
    }
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (state.sel === i) tr.className = 'on';
      const out = r.err ? r.err : fmt(r.value);
      tr.innerHTML =
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + esc(fmt(r.x)) + '</td>' +
        '<td class="out' + (r.err ? ' bad' : '') + '">' + esc(state.expr.trim() ? out : '—') + '</td>' +
        '<td><button class="row-x" type="button" aria-label="Remove row ' + (i + 1) + '">×</button></td>';
      tr.addEventListener('click', () => select(i));
      tr.querySelector('.row-x').addEventListener('click', (e) => { e.stopPropagation(); removeAt(i); });
      frag.appendChild(tr);
    });
    el.tbody.appendChild(frag);
  }

  function renderTiles(rows) {
    const nums = rows.filter((r) => !r.err).map((r) => toNum(r.value)).filter(Number.isFinite);
    const sum = nums.reduce((a, b) => a + b, 0);
    const tiles = [
      ['Inputs', String(rows.length)],
      ['Min f(' + primary + ')', nums.length ? fmtShort(Math.min.apply(null, nums)) : '—'],
      ['Max f(' + primary + ')', nums.length ? fmtShort(Math.max.apply(null, nums)) : '—'],
      ['Mean', nums.length ? fmtShort(sum / nums.length) : '—'],
      ['Sum', nums.length ? fmtShort(sum) : '—']
    ];
    el.tiles.innerHTML = tiles.map(([k, v]) =>
      '<dl class="tile"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></dl>'
    ).join('');
  }

  /* ---------- plot ---------- */
  const M = { t: 14, r: 16, b: 26, l: 54 };

  function niceTicks(lo, hi, target) {
    const span = hi - lo;
    if (!(span > 0)) return [lo];
    const raw = span / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(round12(t));
    return out;
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
    return sorted[i];
  }

  let plotGeom = null;

  function renderPlot(rows) {
    const svg = el.plot;
    const W = Math.max(320, Math.round(svg.clientWidth || 720));
    const H = Math.max(200, Math.round(svg.clientHeight || 320));
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    plotGeom = null;
    el.readout.textContent = '';

    const note = (msg) => {
      svg.innerHTML = '<text class="plot-note" x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle">' + esc(msg) + '</text>';
    };

    if (!compiled) { note(state.expr.trim() ? 'Fix the expression to see a plot' : 'Enter an expression to see its curve'); return; }

    const xs = rows.map((r) => r.x).filter(Number.isFinite);
    let x0, x1;
    if (!xs.length) { x0 = -10; x1 = 10; }
    else {
      x0 = Math.min.apply(null, xs); x1 = Math.max.apply(null, xs);
      if (x0 === x1) { x0 -= 5; x1 += 5; }
      else { const pad = (x1 - x0) * 0.08; x0 -= pad; x1 += pad; }
    }

    // sample
    const N = Math.max(240, Math.min(960, iw * 2));
    const pts = [];
    let plottable = false;
    for (let i = 0; i <= N; i++) {
      const x = x0 + (x1 - x0) * (i / N);
      const r = evalAt(x);
      const y = r.err ? NaN : toNum(r.value);
      if (Number.isFinite(y)) plottable = true;
      pts.push([x, y]);
    }
    const rowYs = rows.filter((r) => !r.err).map((r) => toNum(r.value)).filter(Number.isFinite);
    if (!plottable && !rowYs.length) { note('Nothing numeric to plot for this expression'); return; }

    // robust y range: trim asymptote blowups, then make sure real points fit
    const sorted = pts.map((p) => p[1]).filter(Number.isFinite).sort((a, b) => a - b);
    let y0 = percentile(sorted, 0.02), y1 = percentile(sorted, 0.98);
    rowYs.forEach((y) => { y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    if (!(y1 > y0)) { const c = Number.isFinite(y0) ? y0 : 0; y0 = c - 1; y1 = c + 1; }
    const ypad = (y1 - y0) * 0.1; y0 -= ypad; y1 += ypad;

    const sx = (x) => M.l + ((x - x0) / (x1 - x0)) * iw;
    const sy = (y) => M.t + ih - ((y - y0) / (y1 - y0)) * ih;
    plotGeom = { x0: x0, x1: x1, sx: sx, invx: (px) => x0 + ((px - M.l) / iw) * (x1 - x0), sy: sy, W: W, H: H };

    // grid + axes
    const xt = niceTicks(x0, x1, Math.max(3, Math.round(iw / 110)));
    const yt = niceTicks(y0, y1, Math.max(3, Math.round(ih / 60)));
    let g = '<defs><clipPath id="clip"><rect x="' + M.l + '" y="' + M.t + '" width="' + iw + '" height="' + ih + '"/></clipPath></defs>';
    g += '<g class="g-grid">';
    xt.forEach((t) => { g += '<line x1="' + sx(t) + '" y1="' + M.t + '" x2="' + sx(t) + '" y2="' + (M.t + ih) + '"/>'; });
    yt.forEach((t) => { g += '<line x1="' + M.l + '" y1="' + sy(t) + '" x2="' + (M.l + iw) + '" y2="' + sy(t) + '"/>'; });
    g += '</g><g class="g-axis">';
    if (y0 < 0 && y1 > 0) g += '<line x1="' + M.l + '" y1="' + sy(0) + '" x2="' + (M.l + iw) + '" y2="' + sy(0) + '"/>';
    if (x0 < 0 && x1 > 0) g += '<line x1="' + sx(0) + '" y1="' + M.t + '" x2="' + sx(0) + '" y2="' + (M.t + ih) + '"/>';
    g += '<line x1="' + M.l + '" y1="' + (M.t + ih) + '" x2="' + (M.l + iw) + '" y2="' + (M.t + ih) + '"/>';
    xt.forEach((t) => { g += '<text x="' + sx(t) + '" y="' + (M.t + ih + 15) + '" text-anchor="middle">' + esc(fmt(t)) + '</text>'; });
    yt.forEach((t) => { g += '<text x="' + (M.l - 8) + '" y="' + (sy(t) + 3.5) + '" text-anchor="end">' + esc(fmt(t)) + '</text>'; });
    g += '</g>';

    // curve, broken at discontinuities
    let d = '', open = false;
    pts.forEach(([x, y]) => {
      if (!Number.isFinite(y)) { open = false; return; }
      const py = Math.max(M.t - 2000, Math.min(M.t + ih + 2000, sy(y)));
      d += (open ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + py.toFixed(1) + ' ';
      open = true;
    });
    g += '<g clip-path="url(#clip)"><path class="curve" d="' + d + '"/>';

    // input markers (9px across, 2px surface ring)
    rows.forEach((r, i) => {
      if (r.err) return;
      const y = toNum(r.value);
      if (!Number.isFinite(y) || !Number.isFinite(r.x)) return;
      g += '<circle class="pt' + (state.sel === i ? ' on' : '') + '" cx="' + sx(r.x).toFixed(1) + '" cy="' + sy(y).toFixed(1) + '" r="4.5"/>';
    });
    g += '</g>';

    // hover layer
    g += '<g class="cross" id="cross" style="display:none">' +
         '<line id="crossLine" y1="' + M.t + '" y2="' + (M.t + ih) + '"/>' +
         '<circle class="pt" id="crossDot" r="4.5"/></g>';
    g += '<rect id="hit" x="' + M.l + '" y="' + M.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>';

    svg.innerHTML = g;
    wireHover();
  }

  function wireHover() {
    const svg = el.plot;
    const hit = svg.querySelector('#hit');
    const cross = svg.querySelector('#cross');
    const line = svg.querySelector('#crossLine');
    const dot = svg.querySelector('#crossDot');
    if (!hit || !plotGeom) return;

    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * plotGeom.W;
      const x = round12(plotGeom.invx(px));
      const r = evalAt(x);
      const y = r.err ? NaN : toNum(r.value);
      cross.style.display = '';
      line.setAttribute('x1', plotGeom.sx(x)); line.setAttribute('x2', plotGeom.sx(x));
      if (Number.isFinite(y)) {
        dot.style.display = '';
        dot.setAttribute('cx', plotGeom.sx(x));
        dot.setAttribute('cy', plotGeom.sy(y));
      } else { dot.style.display = 'none'; }
      el.readout.textContent = primary + ' = ' + fmtShort(x) + '   f(' + primary + ') = ' + (r.err ? '—' : fmtShort(r.value));
    };
    const leave = () => { cross.style.display = 'none'; el.readout.textContent = ''; };

    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  /* ---------- orchestration ---------- */
  let rowsCache = [];

  function rows() {
    return state.values.map((x) => {
      const r = state.expr.trim() && compiled ? evalAt(x) : {};
      return { x: x, value: r.value, err: r.err };
    });
  }

  function refresh(opts) {
    opts = opts || {};
    analyse();
    if (!opts.keepParams) renderParams(); else el.colIn.textContent = primary;
    rowsCache = rows();
    renderStatus(rowsCache);
    renderPills();
    renderTable(rowsCache);
    renderTiles(rowsCache);
    renderPlot(rowsCache);
    save();
  }

  let raf = 0;
  function refreshSoon(opts) {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => refresh(opts));
  }

  function select(i) {
    state.sel = state.sel === i ? -1 : i;
    renderPills(); renderTable(rowsCache); renderPlot(rowsCache);
  }

  function removeAt(i) {
    state.values.splice(i, 1);
    if (state.sel === i) state.sel = -1;
    else if (state.sel > i) state.sel--;
    refresh();
  }

  /* ---------- csv ---------- */
  function csv() {
    const head = '"' + primary + '","' + (state.expr.trim() || 'f(' + primary + ')').replace(/"/g, '""') + '"';
    const body = rowsCache.map((r) => '"' + fmt(r.x) + '","' + (r.err ? 'error: ' + r.err : fmt(r.value)).replace(/"/g, '""') + '"');
    return [head].concat(body).join('\n');
  }

  /* ---------- persistence + sharing ---------- */
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ expr: state.expr, values: state.values, params: state.params }));
    } catch (_) {}
  }

  function readHash() {
    if (!location.hash || location.hash.length < 2) return null;
    try {
      const q = new URLSearchParams(location.hash.slice(1));
      if (!q.has('e') && !q.has('v')) return null;
      const out = { expr: q.get('e') || '', values: [], params: {} };
      (q.get('v') || '').split(',').filter(Boolean).forEach((s) => {
        const n = Number(s); if (Number.isFinite(n)) out.values.push(n);
      });
      (q.get('p') || '').split(',').filter(Boolean).forEach((kv) => {
        const [k, v] = kv.split(':');
        if (k && Number.isFinite(Number(v))) out.params[k] = Number(v);
      });
      return out;
    } catch (_) { return null; }
  }

  function shareLink() {
    const q = new URLSearchParams();
    if (state.expr.trim()) q.set('e', state.expr.trim());
    if (state.values.length) q.set('v', state.values.join(','));
    const p = Object.keys(state.params).filter((k) => paramNames.indexOf(k) > -1).map((k) => k + ':' + state.params[k]);
    if (p.length) q.set('p', p.join(','));
    const url = location.origin + location.pathname + '#' + q.toString();
    history.replaceState(null, '', '#' + q.toString());
    return url;
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(label + ' copied');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(label + ' copied'); }
      catch (e) { toast('Copy failed'); }
      ta.remove();
    }
  }

  /* ---------- theme ---------- */
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    el.themeLabel.textContent = t === 'light' ? 'Light' : 'Dark';
    try { localStorage.setItem(STORE + '.theme', t); } catch (_) {}
    if (rowsCache.length || compiled) renderPlot(rowsCache);
  }

  /* ---------- wiring ---------- */
  EXAMPLES.forEach((ex) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = ex;
    b.addEventListener('click', () => {
      state.expr = ex; el.expr.value = ex;
      if (!state.values.length) addValues('-3..3');
      refresh();
      el.expr.focus();
    });
    el.examples.appendChild(b);
  });

  el.expr.addEventListener('input', () => { state.expr = el.expr.value; refreshSoon(); });

  el.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (addValues(el.valueInput.value)) { el.valueInput.value = ''; refresh(); }
  });

  el.valueInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') el.valueInput.value = ''; });

  $('#sortAsc').addEventListener('click', () => { state.values.sort((a, b) => a - b); state.sel = -1; refresh(); });
  $('#dedupe').addEventListener('click', () => {
    const before = state.values.length;
    state.values = state.values.filter((v, i, a) => a.indexOf(v) === i);
    state.sel = -1; refresh();
    toast(before === state.values.length ? 'No duplicates' : 'Removed ' + (before - state.values.length));
  });
  $('#clearInputs').addEventListener('click', () => { state.values = []; state.sel = -1; refresh(); });
  $('#reset').addEventListener('click', () => {
    state.expr = ''; state.values = []; state.params = {}; state.sel = -1;
    el.expr.value = ''; el.valueInput.value = '';
    history.replaceState(null, '', location.pathname);
    refresh();
  });

  $('#copyCsv').addEventListener('click', () => {
    if (!rowsCache.length) return toast('Nothing to copy');
    copy(csv(), 'CSV');
  });
  $('#downloadCsv').addEventListener('click', () => {
    if (!rowsCache.length) return toast('Nothing to download');
    const blob = new Blob([csv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'multiple-input-calculator.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Downloaded');
  });

  $('#share').addEventListener('click', () => copy(shareLink(), 'Link'));
  el.theme.addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); el.expr.focus(); el.expr.select(); }
  });

  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => renderPlot(rowsCache), 120); });

  /* ---------- boot ---------- */
  (function boot() {
    let theme = 'dark';
    try { theme = localStorage.getItem(STORE + '.theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch (_) {}
    setTheme(theme);

    let init = readHash();
    if (!init) {
      try { init = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) { init = null; }
    }
    if (init && (init.expr || (init.values && init.values.length))) {
      state.expr = init.expr || '';
      state.values = Array.isArray(init.values) ? init.values.filter(Number.isFinite).slice(0, MAX_INPUTS) : [];
      state.params = init.params && typeof init.params === 'object' ? init.params : {};
    } else {
      state.expr = 'x^2 + 3x - 5';
      state.values = [-3, -2, -1, 0, 1, 2, 3];
    }
    el.expr.value = state.expr;
    refresh();
  })();
})();
