// Focused layout-text regressions. No browser packages required.
// Run: node dev/cut_text_test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const realm = vm.createContext({ window: {}, console });
vm.runInContext(source('01_util.js'), realm);
const J = realm.window.J;
const painted = [];
J.drawItem = (env, it) => { painted.push(String(it.text)); return { x0: 0, y0: 0, boxes: [] }; };
vm.runInContext(source('11p_cuttext.js'), realm);
const cut = (tx, text = 'あいう') => ({ text, lineText: text, line: 0, start: 0.4, tx });
const env = (c = cut(), fx = {}) => ({ cut: c, fx, t: 0.4, fps: 24, __ly: true });
const applied = (e, text, txSlot) => J.txApply(e, { text, txSlot });
assert.equal(applied(env(cut({ hideMain: true })), 'あ'), null, 'split body hide');
assert.equal(applied(env(cut({ main: 'Replacement' }, 'Hello world')), 'Hello world').text, 'Replacement', 'Latin body replacement');
assert.equal(applied(env(cut({ hideRomaji: true }, 'Hello world')), 'Hello world').text, 'Hello world', 'Latin body is not a romaji annotation');
assert.equal(applied(env(cut({ hideRomaji: true })), 'aiu'), null, 'real romaji still hides');
assert.equal(applied(env(cut(), { hideTime: true }), J.fmtTime(0.4, 24)), null, 'HUD frame-format time');
assert.equal(applied(env(cut(), { hideTime: true }), '00:00:09', 'time'), null, 'explicit HUD time slot');
for (const prefix of ['No.01 ', '#01 ', 'LINE 01 ─ ']) {
  const text = prefix + '00:00.40';
  assert.equal(applied(env(cut(), { hideNo: true }), text).text, '00:00.40', 'remove only number: ' + prefix);
  assert.equal(applied(env(cut(), { hideTime: true }), text).text, prefix.trim().replace(/\s*─$/, ''), 'remove only time: ' + prefix);
  assert.equal(applied(env(cut(), { hideTime: true, hideNo: true }), text), null, 'hide paired label');
}
const untouched = { text: 'Unmodified', _lay: ['cached'] };
assert.equal(J.txApply(env(), untouched), untouched, 'default filter preserves identity and cache');
assert.equal(J.txDirect(env(), 'Unmodified'), 'Unmodified', 'direct fast path');
const oldSlotOf = J.txSlotOf;
J.txSlotOf = () => { throw new Error('No-settings fast path must not classify'); };
assert.equal(J.txDirect(env(), 'Unmodified'), 'Unmodified');
J.txSlotOf = oldSlotOf;

// Execute each optimized fastRow implementation, with and without letterSpacing.
J.fontCSS = () => '20px sans-serif';
for (const file of ['11p_layoutsA.js', '11p_layoutsC.js']) {
  const src = source(file), start = src.indexOf('function fastRow(');
  const fn = src.slice(start, src.indexOf('\n}\n', start) + 2);
  vm.runInContext(fn, realm);
  for (const optimized of [true, false]) {
    const calls = [], ctx = { save() {}, restore() {}, fillText: text => calls.push(text) };
    if (optimized) ctx.letterSpacing = '0px';
    const e = Object.assign(env(cut({ hideMain: true })), { ctx, pass: 'main' });
    e.draw = it => J.drawItem(e, it);
    painted.length = 0;
    realm.fastRow(e, 'あいう', 'mono', 20, 1, 2, 0, '#fff', 1);
    assert.equal(calls.length + painted.length, 0, file + ' hides in both Canvas paths');
    e.cut.tx = { main: '変更' };
    realm.fastRow(e, 'あいう', 'mono', 20, 1, 2, 0, '#fff', 1);
    assert.equal((calls[0] || painted[0]), '変更', file + ' replacement');
    e.__rec = []; e.__probe = true; calls.length = painted.length = 0;
    realm.fastRow(e, 'あいう', 'mono', 20, 1, 2, 0, '#fff', 1);
    assert.deepEqual(Array.from(e.__rec), ['main']);
    assert.equal(calls.length + painted.length, 0, file + ' probe must not paint');
  }
}

// Actual contour layout: the large outlined glyph used to bypass drawItem completely.
J.LAYOUTS = {};
J.register = (group, key, def) => { if (group === 'layout') J.LAYOUTS[key] = def; };
J.mainDraw = (e, it) => J.drawItem(e, it);
J.unionBB = (a, b) => a || b;
J.fitSize = () => 40;
J.glyphCount = text => [...text].length;
J.measure = () => ({ w: 120, h: 40 });
vm.runInContext(source('11p_layoutsD.js'), realm);
const canvasCalls = [];
const ctx = { save() {}, restore() {}, fillText: t => canvasCalls.push(t), strokeText: t => canvasCalls.push(t) };
const e = Object.assign(env(cut(undefined, '夜空')), { ctx, W: 800, H: 450, pass: 'main', lt: 1, ltb: 1, pOut: 0, sc: { bg: '#000', fg: '#fff', sub: '#aaa' }, st: { fonts: { body: ['mono'], mono: ['mono'] } } });
e.line = () => {};
e.cut.params = { side: 1, rings: 4, speed: 0.3, font: 'mono', fb: 'mono', col: 'sub' };
e.draw = it => J.drawItem(e, it);
J.LAYOUTS.contour.render(e);
assert.ok(canvasCalls.length > 0, 'control: contour paints its direct glyph');
e.cut.tx = { main: '変更' }; canvasCalls.length = painted.length = 0;
J.LAYOUTS.contour.render(e);
assert.ok(canvasCalls.includes('変') && !canvasCalls.includes('夜'), 'contour outline follows replacement');
e.cut.tx = { hideMain: true }; canvasCalls.length = painted.length = 0;
J.LAYOUTS.contour.render(e);
assert.equal(canvasCalls.length + painted.length, 0, 'contour hides direct and ordinary body glyphs');
e.__rec = []; e.__probe = true;
J.LAYOUTS.contour.render(e);
assert.ok(e.__rec.includes('main:split'), 'probe exposes contour direct glyph');
assert.equal(canvasCalls.length + painted.length, 0, 'contour probe never paints');

// Replacement must invalidate glyph caches, and retain its slot on recursive draws.
const cached = { text: 'あいう', _lay: [{ ch: 'あ' }], _m: { w: 10 } };
const replacementEnv = env(cut({ main: '変更', hideOther: true }));
const changed = J.txApply(replacementEnv, cached);
assert.equal(changed._lay, null);
assert.equal(changed._m, null);
assert.equal(changed.txSlot, 'main');
assert.equal(J.txApply(replacementEnv, changed), changed);
assert.equal(cached._lay[0].ch, 'あ', 'do not mutate the original item');

// Actual word-search grid, both Canvas branches. Decoy letters are independent of the body.
J.layoutText = () => [];
J.pool = () => 'あいうえおかきくけこ';
for (const optimized of [true, false]) {
  const gridCalls = [];
  const gridCtx = { save() {}, restore() {}, translate() {}, rotate() {}, fillText: t => gridCalls.push(t) };
  if (optimized) gridCtx.letterSpacing = '0px';
  const grid = Object.assign(env(cut(undefined, '夜空')), { ctx: gridCtx, W: 800, H: 450, pass: 'main', lt: 1, ltb: 1, pOut: 0, sc: e.sc, st: e.st, rrect() {} });
  Object.assign(grid.cut, { dur: 3, seed: 7, params: { dir: 'h', pad: 1, decoys: 0, gf: 'mono', font: 'mono' } });
  grid.draw = it => J.drawItem(grid, it);
  painted.length = 0;
  J.LAYOUTS.wordSearch.render(grid);
  assert.ok(gridCalls.length + painted.length > 2, 'control: decoy letters are drawn');
  grid.cut.tx = { hideOther: true }; gridCalls.length = painted.length = 0;
  J.LAYOUTS.wordSearch.render(grid);
  assert.equal(gridCalls.length, 0, 'optimized decoy letters hide');
  assert.deepEqual(painted, ['夜', '空'], 'body letters remain');
  grid.__rec = []; grid.__probe = true; painted.length = 0;
  J.LAYOUTS.wordSearch.render(grid);
  assert.ok(grid.__rec.includes('other'), 'probe sees decoys in both Canvas branches');
  assert.equal(gridCalls.length + painted.length, 0, 'grid probe never paints');
}

// Sampled glyph masks must use the replacement itself, and hiding must skip all
// glyph-shaped tiles / bevels / scan columns, including offscreen sampling.
const sampledTexts = [], rasterGlyphs = [];
let paintOps = 0;
const rasterContext = () => new Proxy({
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
  fillText: text => { rasterGlyphs.push(text); paintOps++; },
  strokeText: text => { rasterGlyphs.push(text); paintOps++; },
  createPattern: () => ({ setTransform() {} }),
}, { get(target, key) { if (key in target) return target[key]; return () => { if (['fill', 'stroke', 'fillRect'].includes(key)) paintOps++; }; } });
realm.document = { createElement: () => ({ getContext: () => rasterContext() }) };
J.layoutText = it => {
  sampledTexts.push(it.text);
  const glyphs = [...it.text].map((ch, i) => ({ ch, x: i * 4, y: 0 }));
  glyphs.W = 8; glyphs.H = 8;
  return glyphs;
};
J.splitLines = text => text;
vm.runInContext(source('11p_layoutsB.js'), realm);
for (const key of ['mosaicTiles', 'halftoneBig', 'dotMatrix']) {
  const sampleEnv = Object.assign(env(cut(undefined, '夜空')), { ctx: rasterContext(), W: 160, H: 90, pass: 'main', lt: 0.5, ltb: 0.5, pOut: 0, sc: { bg: '#000', fg: '#fff', sub: '#aaa', accent: '#f00' }, st: e.st, rrect() { paintOps++; }, rect() { paintOps++; } });
  Object.assign(sampleEnv.cut, { seed: 7, dur: 3, params: { font: 'mono', D: 10, wave: 'diag', floor: true, col: 'fg', mode: 'duo', ang: 20, speed: 0.4, shape: 'round', reveal: 'sweep', panel: true } });
  sampleEnv.draw = it => J.drawItem(sampleEnv, it);
  sampledTexts.length = painted.length = rasterGlyphs.length = 0; paintOps = 0;
  J.LAYOUTS[key].render(sampleEnv);
  assert.ok(sampledTexts.includes('夜空'), key + ' control samples original glyphs');
  assert.ok(painted.includes('夜空'), key + ' control draws original body');
  sampleEnv.cut.tx = { main: '変更', hideOther: true };
  sampledTexts.length = painted.length = rasterGlyphs.length = 0; paintOps = 0;
  J.LAYOUTS[key].render(sampleEnv);
  assert.ok(sampledTexts.includes('変更'), key + ' replacement recomputes mask');
  assert.ok(painted.includes('変更'), key + ' draws replacement despite hideOther');
  assert.ok(!sampledTexts.includes('夜空') && !painted.includes('夜空'), key + ' original text absent');
  assert.ok(!rasterGlyphs.some(ch => ch === '夜' || ch === '空'), key + ' original raster glyphs absent');
  sampleEnv.cut.tx = { hideMain: true };
  sampledTexts.length = painted.length = rasterGlyphs.length = 0; paintOps = 0;
  J.LAYOUTS[key].render(sampleEnv);
  assert.equal(sampledTexts.length + painted.length + rasterGlyphs.length + paintOps, 0, key + ' hide leaves no glyph-shaped graphics');
  sampleEnv.__rec = []; sampleEnv.__probe = true;
  J.LAYOUTS[key].render(sampleEnv);
  assert.deepEqual(Array.from(sampleEnv.__rec), ['main'], key + ' remains editable when hidden');
}

// The maskReveal "lines" pattern contains secondary literal copy. Its deferred
// fill callback must not bypass hideLine, and the probe must discover that copy.
realm.DOMMatrix = class { rotate() { return this; } translate() { return this; } scale() { return this; } };
const oldMainDraw = J.mainDraw;
J.mainDraw = (en, it) => {
  it.charFns = [];
  for (const fn of it.charFns) fn();
  return J.drawItem(en, it);
};
const mask = Object.assign(env(cut(undefined, '夜空')), { ctx: rasterContext(), W: 160, H: 90, pass: 'main', lt: 1, ltb: 1, pOut: 0, sc: { bg: '#000', fg: '#fff', sub: '#aaa', accent: '#f00' }, st: e.st });
mask.cut.lineText = '周辺の語';
mask.cut.params = { font: 'mono', scene: 'lines', speed: 1, label: false, rim: false };
rasterGlyphs.length = 0;
J.LAYOUTS.maskReveal.render(mask);
assert.ok(rasterGlyphs.some(t => t.includes('周辺の語')), 'control: mask pattern paints secondary text');
mask.cut.tx = { hideLine: true }; rasterGlyphs.length = 0;
J.LAYOUTS.maskReveal.render(mask);
assert.equal(rasterGlyphs.length, 0, 'hidden secondary copy is not sampled into pattern');
mask.__rec = []; mask.__probe = true;
J.LAYOUTS.maskReveal.render(mask);
assert.ok(mask.__rec.includes('line'), 'probe discovers deferred pattern copy');
mask.__probe = false; delete mask.__rec; mask.cut.lineText = mask.cut.text; mask.cut.tx = { main: '変更' }; rasterGlyphs.length = 0;
J.LAYOUTS.maskReveal.render(mask);
assert.ok(rasterGlyphs.some(t => t.includes('変更')) && !rasterGlyphs.some(t => t.includes('夜空')), 'repeated body pattern uses replacement');
J.mainDraw = oldMainDraw;

// Live times must be classified at the instant recorded, not against the final sample.
const live = env(); live.__rec = []; live.__probe = true;
for (const t of [0.6, 1.1, 1.6]) { live.t = t; J.drawItem(live, { text: J.fmtTime(t) }); }
assert.deepEqual(Array.from(live.__rec), ['time', 'time', 'time']);
// Exercise the panel's five-sample probe API, including ignored existing hide flags.
realm.document = { createElement: () => ({ getContext: () => ({}) }) };
J.Renderer = class { makeEnv(ctx, plan, c, sc, opts) { return Object.assign({ ctx, plan, cut: c, fx: plan.fx, fps: plan.fps }, opts); } };
J.LAYOUTS.liveTest = { render(e) { J.drawItem(e, { text: J.fmtTime(e.t) }); } };
const probeCut = Object.assign(cut({ hideTime: true }), { layout: 'liveTest', dur: 3, scheme: 0 });
const slots = J.txProbe(probeCut, { style: { schemes: [{}] }, fx: { hideTime: true }, fps: 24 });
assert.deepEqual(Array.from(slots), ['time'], 'probe does not invent other rows from earlier sampled times');
console.log('cut_text_test: all assertions passed');
