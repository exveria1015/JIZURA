// Dependency-free Chrome CDP smoke of built editions and real-Canvas layouts.
// Run after python3 build.py: node dev/test_editions.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';
const wait = ms => new Promise(r => setTimeout(r, ms));
const root = resolve(process.env.JIZURA_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const editions = ['', 'en', 'zh-hans', 'zh-hant', 'ko', 'id', 'vi'];
const urls = editions.map(e => pathToFileURL(resolve(root, e, 'index.html')).href);

test('seven editions initialize and all registered layouts render with text controls', { timeout: 180000 }, async () => {
  const dir = await mkdtemp(tmpdir() + '/jizura-editions-test-');
  const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--remote-debugging-port=0', '--user-data-dir=' + dir, '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try { port = (await readFile(dir + '/DevToolsActivePort', 'utf8')).split('\n')[0]; break; } catch { await wait(100); }
    }
    assert.ok(port, 'Chrome started');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map(), exceptions = [];
    ws.onmessage = event => {
      const m = JSON.parse(event.data);
      if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails);
      if (!m.id) return;
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(m.error) : p.resolve(m.result);
    };
    const send = (method, params = {}) => new Promise((r, j) => {
      const n = ++id; pending.set(n, { resolve: r, reject: j }); ws.send(JSON.stringify({ id: n, method, params }));
    });
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(r.exceptionDetails, undefined, JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    // Initialization and render smoke must not download fonts, models or a remote backend.
    await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.clear(); localStorage.setItem('jizura.tourDone','1');" });
    const navigate = async url => {
      exceptions.length = 0;
      await send('Page.navigate', { url });
      for (let i = 0; i < 150; i++) {
        try { if (await evaluate(`location.href === ${JSON.stringify(url)} && !!window.J?.ui?.plan`)) return; } catch (e) {
          if (!/context|navigat/i.test(String(e.message))) throw e;
        }
        await wait(100);
      }
      assert.fail('Initialization timeout: ' + url + ' ' + JSON.stringify(exceptions));
    };
    for (let i = 0; i < urls.length; i++) {
      await navigate(urls[i]);
      const actual = await evaluate(`(() => {
        const byId = id => document.getElementById(id);
        const options = id => [...byId(id).options].map(o => o.value);
        const box = byId('whisperBox');
        return { whisperLang: options('whisperLang'), model: options('whisperModel'), defaultModel: byId('whisperModel').value,
          lyricLang: options('lyricLang'), lyricDefault: byId('lyricLang').value,
          whisperText: box.textContent + [...box.querySelectorAll('[aria-label],[title],[placeholder]')].map(e => e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder')).join(' '),
          nav: [...document.querySelectorAll('.lang-switch option')].map(o => ({ raw: o.value, url: new URL(o.value, location.href).href })),
          controls: !!J.txDirect && !!J.whisper && !!J.uiApi };
      })()`);
      const name = editions[i] || 'ja';
      assert.deepEqual(actual.whisperLang, ['japanese', 'english'], name + ' explicit transcription languages');
      assert.deepEqual(actual.model, ['base', 'tiny'], name + ' approved models');
      assert.equal(actual.defaultModel, 'base', name + ' Base default');
      assert.ok(actual.lyricLang.includes('auto'), name + ' lyric auto option retained');
      assert.equal(actual.lyricDefault, 'auto', name + ' lyric auto default retained');
      assert.equal(actual.controls, true, name + ' latest scripts present');
      if (i) assert.doesNotMatch(actual.whisperText, /[ぁ-ゟ゠-ヿ]/u, name + ' no untranslated Japanese kana in Whisper UI');
      assert.deepEqual(actual.nav.map(o => o.url).sort(), [...urls].sort(), name + ' all language links remain in this checkout/fork');
      assert.ok(actual.nav.every(o => !/^(?:[a-z]+:|\/)/i.test(o.raw)), name + ' language paths are relative');
      assert.deepEqual(exceptions, [], name + ' no initialization exceptions');
      console.log('edition initialized:', name);
    }
    await navigate(urls[0]);
    const keys = await evaluate(`(() => {
      J.uiApi.pause();
      const p = J.defaultProject(); p.lyrics = '夜空にひかる夢の続き'; p.title = '作品'; p.artist = '作者';
      const plan = J.plan(p, null); plan.W = 480; plan.H = 270;
      const base = plan.cuts.find(c => c.line >= 0 && !J.LAYOUTS[c.layout].special);
      if (!base) throw new Error('No baseline lyric cut');
      const cv = document.createElement('canvas'); cv.width = 480; cv.height = 270;
      window.editionRenderSmoke = { plan, base, cv, renderer: new J.Renderer() };
      return Object.keys(J.LAYOUTS);
    })()`);
    let renders = 0;
    const failures = [];
    for (let i = 0; i < keys.length; i += 12) {
      const result = await evaluate(`(() => {
        const { plan, base, cv, renderer } = editionRenderSmoke;
        const failures = []; let renders = 0; let current = '';
        const warn = console.warn; console.warn = (...a) => failures.push(current + ': warning: ' + a.map(String).join(' '));
        try {
          for (const key of ${JSON.stringify(keys.slice(i, i + 12))}) {
            const L = J.LAYOUTS[key];
            const candidates = ['夜空にひかる夢', '夜空', '夢', '夜空にひかる夢の続きをいつまでも覚えている'];
            const text = candidates.find(t => !L.fits || L.fits([...t].length)) || candidates[0];
            for (const hidden of [false, true]) for (const lt of [0.25, 1.2, 2.7]) {
              current = key + '/' + (hidden ? 'hidden' : 'default') + '/' + lt;
              try {
                const cut = { ...base, text, lineText: text, note: '注釈', words: J.chunkText(text), start: 0.4, end: 3.4, dur: 3,
                  layout: key, enter: 'cut', exit: 'cut', hold: 'still', treat: null, inDur: 0.2, outDur: 0.2, stagger: 0, n: [...text].length, W: plan.W, H: plan.H,
                  tx: hidden ? { hideMain: true, hideNo: true, hideTime: true } : undefined };
                cut.params = L.plan ? L.plan(J.rng(1234), cut, plan.style) : {};
                cv.width = 480;
                const ctx = cv.getContext('2d');
                const env = renderer.makeEnv(ctx, { ...plan, fx: { ...plan.fx, hideNo: hidden, hideTime: hidden } }, cut, plan.style.schemes[0],
                  { pass: 'main', layer: 'front', t: cut.start + lt, lt, ltb: lt, step: Math.floor(lt * 24), scale: 1, allowFilter: false, energy: 0.5, beat: { phase: 0.5, pulse: 0.5 }, bgOnly: false });
                env.__ly = true; L.render(env); renders++;
              } catch (e) { failures.push(current + ': ' + e.stack); }
            }
          }
        } finally { console.warn = warn; }
        return { renders, failures };
      })()`);
      renders += result.renders; failures.push(...result.failures);
    }
    assert.deepEqual(failures, [], 'all layouts must render without caught errors or warnings');
    const textChecks = await evaluate(`(() => {
      const { plan, base, cv, renderer } = editionRenderSmoke;
      const fill = CanvasRenderingContext2D.prototype.fillText;
      let calls = [];
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { calls.push(String(text)); return fill.call(this, text, ...args); };
      const run = (hidden, what) => {
        calls = []; cv.width = 480;
        const cut = { ...base, text: '夜空', lineText: '夜空', tx: hidden ? { hideMain: true } : undefined };
        const env = renderer.makeEnv(cv.getContext('2d'), { ...plan, fx: { ...plan.fx, hideTime: hidden } }, cut, plan.style.schemes[0],
          { pass: 'main', t: 0.4, lt: 1, ltb: 1, step: 24, scale: 1, allowFilter: false });
        env.__ly = true;
        if (what === 'body') J.drawItem(env, { text: '夜空', font: plan.style.fonts.body[0], size: 32, x: 100, y: 100, color: '#fff' });
        else J.drawHUD(env, plan);
        return calls.slice();
      };
      try { return { body: run(false, 'body'), hiddenBody: run(true, 'body'), hud: run(false, 'hud'), hiddenHud: run(true, 'hud') }; }
      finally { CanvasRenderingContext2D.prototype.fillText = fill; }
    })()`);
    assert.ok(textChecks.body.length > 0, 'body positive control paints glyphs');
    assert.equal(textChecks.hiddenBody.length, 0, 'hidden body emits no real Canvas fillText');
    assert.equal(textChecks.hud.length - textChecks.hiddenHud.length, '00:00:09'.length, 'HUD hideTime removes exactly the timecode glyphs');
    assert.deepEqual(exceptions, [], 'no page exceptions during layout rendering');
    console.log(JSON.stringify({ editions: editions.length, layouts: keys.length, renderCases: renders, focusedCanvasChecks: 'passed', externalNetwork: 'blocked' }));
  } finally {
    ws?.close();
    if (chrome.exitCode === null) { chrome.kill(); await new Promise(r => chrome.once('exit', r)); }
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
