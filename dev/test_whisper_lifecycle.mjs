import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('transcription results stay with their project and audio', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(tmpdir() + '/jizura-audio-reset-test-');
  const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-networking', '--remote-debugging-port=0',
    '--user-data-dir=' + dir, '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try { port = (await readFile(dir + '/DevToolsActivePort', 'utf8')).split('\n')[0]; break; }
      catch { await wait(100); }
    }
    assert.ok(port, 'Chrome started');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const p = pending.get(message.id);
      pending.delete(message.id);
      message.error ? p.reject(message.error) : p.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(r.exceptionDetails, undefined);
      return r.result.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('jizura.tourDone','1')" });
    await send('Page.navigate', { url: pathToFileURL(resolve(process.env.JIZURA_TEST_INDEX || 'index.html')).href });
    for (let i = 0; i < 100 && !await evaluate('!!window.J?.ui?.plan'); i++) await wait(100);
    assert.equal(await evaluate('!!window.J?.ui?.plan'), true, 'app initialized');


    await evaluate(`(() => {
      window.confirm = () => true;
      J.forgetSong = async () => true; J.saveSong = async () => true;
      window.startWhisperTest = async () => {
        J.ui.project = J.defaultProject(); J.ui.project.lyrics = 'original';
        J.ui.audio = { buffer: { song: 'A' }, duration: 12, bpm: 120, beats: [] };
        J.uiApi.syncUI(); J.uiApi.replan();
        window.whisperCalls = 0; window.releaseWhisper = null;
        J.whisper.transcribe = (buffer, options) => {
          window.whisperCalls++; window.whisperBuffer = buffer; window.whisperOptions = options;
          return new Promise((resolve, reject) => { window.releaseWhisper = resolve; window.rejectWhisper = reject; });
        };
        document.getElementById('btnWhisper').click();
        for (let n = 0; n < 100 && !window.releaseWhisper; n++) await new Promise(r => setTimeout(r, 10));
        if (!window.releaseWhisper) throw new Error('transcription did not start');
      };
      window.finishWhisperTest = async () => {
        window.releaseWhisper({ lrc: '[00:01.00]recognized', device: 'wasm' });
        for (let n = 0; n < 100 && document.getElementById('btnWhisper').disabled; n++) await new Promise(r => setTimeout(r, 10));
      };
      window.whisperState = () => ({
        text: document.getElementById('whisperPreview').value,
        hidden: document.getElementById('whisperResult').hidden,
        disabled: document.getElementById('btnApplyWhisper').disabled,
        busy: document.getElementById('btnWhisper').disabled,
        lyrics: J.ui.project.lyrics,
      });
    })()`);

    const reset = await evaluate(`(async () => {
      await startWhisperTest();
      const dialog = document.getElementById('resetDlg'); dialog.returnValue = 'reset'; dialog.dispatchEvent(new Event('close'));
      await finishWhisperTest();
      return { ...whisperState(), aborted: whisperOptions.signal.aborted };
    })()`);
    assert.deepEqual(reset, { text: '', hidden: true, disabled: true, busy: false, lyrics: '', aborted: true });

    const project = await evaluate(`(async () => {
      await startWhisperTest();
      const p = J.defaultProject(); p.lyrics = 'project B';
      const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(p)], 'b.json', { type: 'application/json' }));
      const el = document.getElementById('fileProject'); el.files = dt.files; el.dispatchEvent(new Event('change'));
      for (let n = 0; n < 100 && J.ui.project.lyrics !== 'project B'; n++) await new Promise(r => setTimeout(r, 10));
      whisperOptions.onProgress({ phase: 'transcribing', device: 'wasm' });
      await finishWhisperTest();
      return { ...whisperState(), progressHidden: document.getElementById('whisperProgressBox').hidden };
    })()`);
    assert.deepEqual(project, { text: '', hidden: true, disabled: true, busy: false, lyrics: 'project B', progressHidden: true });

    const host = await evaluate(`(async () => {
      await startWhisperTest();
      J.analyzeAudio = async () => ({ buffer: { song: 'B' }, duration: 10, bpm: 100, beats: [] });
      await J.uiApi.loadAudioFile(new File(['x'], 'b.wav'));
      await finishWhisperTest();
      return { ...whisperState(), song: J.ui.audio.buffer.song };
    })()`);
    assert.equal(host.song, 'B'); assert.equal(host.text, ''); assert.equal(host.disabled, true);

    const success = await evaluate(`(async () => {
      await startWhisperTest(); await finishWhisperTest();
      const apply = document.getElementById('btnApplyWhisper');
      J.ui.tap = {}; apply.click(); const duringTap = J.ui.project.lyrics; J.ui.tap = null;
      J.ui.exporting = true; apply.click(); const duringExport = J.ui.project.lyrics; J.ui.exporting = false;
      apply.click(); const applied = J.ui.project.lyrics;
      document.getElementById('btnUndoEdit').click(); const undone = J.ui.project.lyrics;
      await J.uiApi.loadAudioFile(new File(['x'], 'next.wav'));
      return { duringTap, duringExport, applied, undone, ...whisperState() };
    })()`);
    assert.equal(success.duringTap, 'original'); assert.equal(success.duringExport, 'original');
    assert.equal(success.applied, '[00:01.00]recognized'); assert.equal(success.undone, 'original');
    assert.equal(success.text, ''); assert.equal(success.disabled, true);

    const discarded = await evaluate(`(async () => {
      await startWhisperTest(); document.getElementById('btnDiscardWhisper').click();
      document.getElementById('btnWhisper').click(); const calls = whisperCalls;
      const blocked = document.getElementById('btnWhisper').disabled;
      await finishWhisperTest(); return { calls, blocked, ...whisperState() };
    })()`);
    assert.equal(discarded.calls, 1); assert.equal(discarded.blocked, true);
    assert.equal(discarded.busy, false); assert.equal(discarded.disabled, true); assert.equal(discarded.text, '');

    const failed = await evaluate(`(async () => {
      await startWhisperTest(); rejectWhisper(new Error('intentional test failure'));
      for (let n = 0; n < 100 && document.getElementById('btnWhisper').disabled; n++) await new Promise(r => setTimeout(r, 10));
      return whisperState();
    })()`);
    assert.equal(failed.busy, false); assert.equal(failed.disabled, true);
    const guarded = await evaluate(`(() => {
      const count = whisperCalls; J.ui.tap = {}; document.getElementById('btnWhisper').click(); J.ui.tap = null;
      J.ui.exporting = true; document.getElementById('btnWhisper').click(); J.ui.exporting = false;
      return whisperCalls === count;
    })()`);
    assert.equal(guarded, true);
    assert.equal(await evaluate("document.getElementById('whisperLang').querySelector('[value=auto]') === null"), true);
  } finally {
    ws?.close();
    if (chrome.exitCode === null) {
      chrome.kill();
      await new Promise(resolve => chrome.once('exit', resolve));
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
