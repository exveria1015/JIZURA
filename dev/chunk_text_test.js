// Chunking and per-cut text integration: node dev/chunk_text_test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  window: {}, console, Intl, setTimeout, clearTimeout,
  document: { createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 100 }) }) }), getElementById: () => null },
});
for (const file of fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js') && f !== '12_ui.js').sort())
  vm.runInContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), context, { filename: file });
const J = context.window.J;
const plain = value => JSON.parse(JSON.stringify(value));
for (const text of ['menu—I', 'paintbrush—a', 'menu–I'])
  assert.deepEqual(plain(J.chunkText(text)), [text], 'single-letter words preserve dash adjacency');
assert.deepEqual(plain(J.chunkText('sing to \'em')), ['sing', 'to', "'em"]);
assert.deepEqual(plain(J.chunkText('give me a break')), ['give', 'me a', 'break']);
assert.deepEqual(plain(J.phraseChunks(J.chunkText('An unforgettable feeling of understanding'))),
  ['An unforgettable', 'feeling of', 'understanding']);
assert.deepEqual(plain(J.chunkText('나 너 좋아')), ['나 너', '좋아']);

// The two center-free bands retain their own lyric halves, but share the
// same user controls, including an explicit replacement in each band.
const p = J.defaultProject();
p.lyrics = '夜明けの色を覚えてる';
p.centerFree = true;
const tx = { main: 'replacement', hideNote: true, hideNo: true };
p.overrides = { 0: { cuts: 1, layout: 'center', cutText: { 0: tx } } };
const cut = J.plan(p, null).cuts.find(c => c.line === 0 && c.companion);
assert.ok(cut, 'fixture has both center-free bands');
assert.equal(cut.tx, tx);
assert.equal(cut.companion.tx, tx);
assert.notEqual(cut.text, 'replacement', 'the original lyric remains available');
assert.notEqual(cut.companion.text, 'replacement');
for (const band of [cut, cut.companion]) {
  const env = { cut: band, fx: {} };
  assert.equal(J.txApply(env, { text: band.text, txSlot: 'main' }).text, 'replacement');
  assert.equal(J.txApply(env, { text: 'note', txSlot: 'note' }), null);
  assert.equal(J.txApply(env, { text: '01', txSlot: 'no' }), null);
}
assert.deepEqual(plain(J.plan(plain(p), null).cuts.find(c => c.line === 0 && c.companion).companion.tx), tx);
console.log('chunk_text_test: passed');
