// Pure conversion/resampling checks; no model downloads or external services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ J: {}, window: {}, console, Float32Array, AbortController });
// Expose the existing cache/factory only in this test realm, to exercise the real
// transcription path with a deterministic pipeline instead of downloading weights.
vm.runInContext(fs.readFileSync('src/10b_whisper.js', 'utf8')
  .replace('J.whisper = {', 'J.whisper = { _loaded: loaded, createPipeline,'), context);
const w = context.J.whisper;
assert.equal(w.toLrc({ chunks: [
  { text: 'untimed', timestamp: [null, 1] },
  { text: 'known', timestamp: [1.234, 2] },
  { text: 'missing', timestamp: [undefined, 3] },
  { text: 'invalid', timestamp: [-1, 3] },
] }), 'untimed\n[00:01.23]known\nmissing\ninvalid');
assert.equal(w.toLrc({ text: 'no timestamps' }), 'no timestamps');
assert.equal(w.toLrc({ chunks: [{ text: 'zero', timestamp: [0, 1] }] }), '[00:00.00]zero');
assert.equal(w.timestamp(59.999), '[01:00.00]');
for (const model of Object.values(w.MODELS)) assert.match(model.revision, /^[a-f0-9]{40}$/);
(async () => {
  const audio = { numberOfChannels: 2, length: 4, duration: 4 / 16000, sampleRate: 16000,
    getChannelData: channel => new Float32Array(channel ? [-0.5, 0.5, -0.5, 0.5] : [0.5, -0.5, 0.5, -0.5]) };
  const mono = await w.mono16k(audio);
  assert.deepEqual([...mono], [0, 0, 0, 0]);
  await assert.rejects(w.mono16k(null), err => err.code === 'NO_AUDIO');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(w.transcribe(audio, { signal: controller.signal }), err => err.code === 'CANCELLED');
  let actualParams;
  const runtime = { device: 'wasm', pipe: async (samples, params) => {
    assert.equal(samples.length, 4); actualParams = params;
    return { chunks: [{ text: 'recognized', timestamp: [1.25, 2] }] };
  } };
  w._loaded.set(w.MODELS.tiny.id, Promise.resolve(runtime));
  assert.equal((await w.transcribe(audio, { model: 'tiny', language: 'english' })).lrc, '[00:01.25]recognized');
  assert.equal(actualParams.language, 'english'); assert.equal(actualParams.task, 'transcribe');
  assert.equal(actualParams.no_speech_threshold, undefined);
  await w.transcribe(audio, { model: 'tiny', language: 'japanese' });
  assert.equal(actualParams.language, 'japanese');
  let pipelineOptions;
  await w.createPipeline({ pipeline: async (task, id, options) => { pipelineOptions = options; } }, w.MODELS.tiny, 'wasm');
  assert.equal(pipelineOptions.revision, w.MODELS.tiny.revision);
  const during = new AbortController();
  runtime.pipe = async () => { during.abort(); return { text: 'must not be accepted' }; };
  await assert.rejects(w.transcribe(audio, { model: 'tiny', signal: during.signal }), err => err.code === 'CANCELLED');
  console.log('whisper_test: passed (conversion, resampling, language, revisions, cancellation; mocked inference)');
})().catch(err => { console.error(err); process.exitCode = 1; });
