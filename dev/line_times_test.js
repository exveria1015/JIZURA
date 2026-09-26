// Focused planner regression tests. Run: node dev/line_times_test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const J = {
  GROUP_KEYS: [], order: () => [],
  LAYOUT_ORDER: [], ENTER_ORDER: [], EXIT_ORDER: [], HOLD_ORDER: [], DECOR_ORDER: [],
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
};
vm.runInNewContext(fs.readFileSync('src/08_planner.js', 'utf8'), { J });
const native = value => JSON.parse(JSON.stringify(value));
const timing = (lyrics, lineTimes, extra = {}) => {
  const p = { lyrics, timing: { offset: 0.4, tail: 0.9, lineTimes, ...extra } };
  return native(J.computeTiming(p, J.parseLyrics(lyrics), null));
};

const backwards = { 0: 10, 1: 2 };
const result = timing('first\nsecond', backwards);
assert.deepEqual(result.starts, [10, 10.2]);
assert.ok(result.duration > result.ends[0]);
assert.deepEqual(backwards, { 0: 10, 1: 2 }); // planning must not edit the saved project

assert.deepEqual(timing('first\nsecond', { 0: -5, 1: 0 }).starts, [0, 0.2]);
assert.deepEqual(timing('first\nsecond', { 0: 1, 1: 1 }).starts, [1, 1.2]);
assert.deepEqual(timing('first\nsecond', {}).starts.map(x => +x.toFixed(3)), [0.4, 2.05]);
const manualAnchors = { 0: 10, 2: 11 };
const fitted = timing('first\nmiddle\nlast', manualAnchors);
assert.deepEqual(fitted.starts, [10, 10.5, 11]);
assert.deepEqual(fitted.ends.slice(0, 2), [10.5, 11]);
assert.deepEqual(manualAnchors, { 0: 10, 2: 11 });
const packed = timing('first\none\ntwo\nlast', { 0: 10, 3: 11 });
assert.deepEqual(packed.starts.map(x => +x.toFixed(3)), [10, 10.333, 10.667, 11]);

// Repeated LRC tags intentionally share a timestamp; do not spread them out.
assert.deepEqual(timing('[00:10.00]first\n[00:10.00]second', {}).starts, [10, 10]);
assert.deepEqual(timing('[00:20.00]later\n[00:10.00]earlier', {}).starts, [10, 20]);
assert.deepEqual(timing('[00:10.00]first\n[00:20.00]second', { 0: 21 }).starts, [19.8, 20]);
const closeTags = timing('[00:00.00]A\n[00:01.00]B\n[00:01.00]C', { 0: 100, 1: 100 });
assert.deepEqual(closeTags.starts.map(x => +x.toFixed(3)), [0.8, 0.9, 1]);
assert.deepEqual(closeTags.ends.slice(0, 2).map(x => +x.toFixed(3)), [0.9, 1]);

// Mixed-LRC automatic rows must respect the normalized manual anchor and
// the following real LRC, including when both fit before the default offset.
const earlyMixed = timing('one\ntwo\n[00:00.10]A', { 1: 10 });
assert.deepEqual(earlyMixed.starts, [0, 0.05, 0.1]);
assert.deepEqual(earlyMixed.ends.slice(0, 2), [0.05, 0.1]);
const mixedLyrics = '[00:10]A\none\ntwo\n[00:11]B';
assert.deepEqual(timing(mixedLyrics, { 1: 30 }).starts, [10, 10.8, 10.9, 11]);
assert.deepEqual(timing(mixedLyrics, { 2: -1 }).starts, [10, 10.1, 10.2, 11]);
assert.deepEqual(timing('[00:10]A\none\n[00:10]B', { 1: 20 }).starts, [10, 10, 10]);

console.log('line_times_test: passed');
