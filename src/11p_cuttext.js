/* JIZURA pack: レイアウト文字 — per-cut control of every text a layout draws.

   Standard text passes through J.drawItem(); optimized Canvas painters use J.txDirect.
   Both paths share the same recorder and filter:

     · probe  — report which strings this cut's layout really draws, so the panel lists
                exactly those rows (a layout that never prints a number shows no number row)
     · apply  — hide / replace them before painting

   A drawn string is matched to a slot by comparing *normalised* forms, because layouts
   rewrite what they are handed: they strip spaces, wrap lines with \n, split the line into
   words, uppercase romaji, or glue the serial number and the timecode together
   ("No.01 00:00.40"). Anything matching nothing is reported as "other", so a layout that
   letterpresses its own station code ("LY", "33", "← LY32") is still the user's to hide. */
(() => {
'use strict';

const RX_SP = /[\s\u3000]+/g;
const norm = s => String(s == null ? '' : s).replace(RX_SP, '');
const pad2 = n => String(Math.max(0, n | 0)).padStart(2, '0');

/* every spelling of this line's romaji a pack may print: plain / upper / Capitalised,
   with or without spaces (packs build them with J.romaji + toUpperCase + slice) */
const romajiSet = cut => {
  if (cut.__romajiSet) return cut.__romajiSet;
  const s = new Set();
  for (const t of [String(cut.text || ''), norm(cut.text), String(cut.lineText || '')]) {
    if (!t) continue;
    const r = J.romaji(t);
    if (!r) continue;
    for (const v of [r, norm(r)]) {
      s.add(v);
      s.add(v.toUpperCase());
      s.add(v.charAt(0).toUpperCase() + v.slice(1).toLowerCase());
    }
  }
  return (cut.__romajiSet = s);
};
const isRomajiExact = (cut, n) => romajiSet(cut).has(n);
const isRomajiPiece = (cut, n) => {
  if ([...n].length < 3) return false;
  for (const r of romajiSet(cut)) if (r.length >= 3 && r.includes(n)) return true;
  return false;
};

/* which controllable slot a drawn string belongs to */
J.txSlotOf = (cut, str, env) => {
  if (!cut || str == null) return null;
  const s = String(str);
  if (!s.trim()) return null;
  const n = norm(s);
  if (!n) return null;
  const main = norm(cut.text), note = norm(cut.note), line = norm(cut.lineText || cut.text);
  const tag = pad2((cut.line | 0) + 1);
  const noS = 'No.' + tag, hashS = '#' + tag;
  const times = [J.fmtTime(cut.start)];
  if (env) times.push(J.fmtTime(env.t), J.fmtTime(env.t, env.fps || (env.plan && env.plan.fps)));
  const hasTime = times.some(t => n.includes(norm(t)));
  // serial number / timecode, alone or glued together — one drawing, so the panel shows a
  // single row for the pair and strips whichever half was switched off
  const hasNo = n.includes(noS) || n.includes(hashS);
  if (hasNo || hasTime) {
    if (n === noS || n === hashS) return 'no';
    if (times.some(t => n === norm(t))) return 'time';
    if (hasNo && hasTime) return 'no+time';
    // The type layout joins its line number and live time in one label.
    if (hasTime && new RegExp('^LINE' + tag + '[─—/／]').test(n)) return 'no+time';
  }
  // Latin lyrics also equal their romaji spelling: the actual body wins that ambiguity.
  if (main && n === main) return 'main';
  if (note && n === note) return 'note';
  if (isRomajiExact(cut, n)) return 'romaji';
  const tt = cut.params && cut.params.titleText;
  if (tt && n === norm(tt)) return 'title';
  if (main && [...n].length === 1 && main.includes(n)) return 'main:split';
  // a decoration built by repeating the lyric ("nee, mada . nee, mada . ...") is still the lyric
  const SEP = /[・･／/、,،+\-]/g;
  if (main) {
    const fm = main.replace(SEP, '');
    const flat = n.replace(SEP, '');
    if (fm && flat.length >= fm.length * 2 && flat.length % fm.length === 0 && flat === fm.repeat(flat.length / fm.length)) return 'main';
  }
  if (isRomajiPiece(cut, n)) return 'romaji';
  if (line && n === line) return 'line';
  if (line && [...n].length >= 2 && (line.includes(n) || n.includes(line))) return 'line';
  return 'other';
};

// A replacement invalidates any cached glyph positions and keeps its semantic role
// when drawItem recursively renders a blurred item into an offscreen canvas.
const withText = (it, text, txSlot) => it.text === text ? it
  : Object.assign({}, it, { text, txSlot, _lay: null, _m: null });

/* apply a cut's override to one drawn item (null = do not draw) */
J.txApply = (env, it) => {
  const cut = env.cut, o = cut && cut.tx;
  const g = env.fx || {};
  if (!it || it.text == null) return it;
  if (!o && !g.hideNo && !g.hideTime) return it;      // nothing switched on anywhere
  const s = String(it.text);
  const slot = it.txSlot || J.txSlotOf(cut, s, env);
  if (!slot) return it;
  const hit = k => slot === k || slot.split('+').includes(k);
  const off = k => !!(o && o[k]);                     // per-cut flag, safe when the cut has no overrides
  // serial number / timecode: the per-cut boxes and the project-wide switches both count
  if (hit('no') || hit('time')) {
    const hNo = (o && o.hideNo) || !!g.hideNo, hTm = (o && o.hideTime) || !!g.hideTime;
    if (hit('no') && hit('time') && hNo && hTm) return null;
    if (slot === 'no+time') {
      if (hTm) {                                       // keep the serial number, drop only the timecode
        const t = s.replace(/\d+:\d{2}[.:]\d{2}/g, '').replace(/^[\s\u3000／/─—]+|[\s\u3000／/─—]+$/g, '');
        return t ? withText(it, t, hTm ? 'no' : 'time') : null;
      }
      if (!hNo) return it;
      const t = s
        .replace(new RegExp('(#|No\\.|LINE\\s*)\\s*' + pad2((cut.line | 0) + 1), 'g'), '')
        .replace(new RegExp('^\\s*' + pad2((cut.line | 0) + 1) + '\\s*[／/]\\s*'), '')
        .replace(/^[\s\u3000／/─—]+|[\s\u3000／/─—]+$/g, '');
      return t ? withText(it, t, hTm ? 'no' : 'time') : null;
    }
    if (hit('no')) return hNo ? null : it;
    if (hit('time')) return hTm ? null : it;
  }
  if (hit('main') || slot === 'main:split') {
    if (off('hideMain')) return null;
    if (o && o.main != null && slot === 'main') return withText(it, o.main, slot);
  } else if (hit('line')) {
    if (off('hideLine')) return null;
  } else if (hit('note')) {
    if (off('hideNote')) return null;
    if (o && o.note != null && slot === 'note') return withText(it, o.note, slot);
  } else if (hit('romaji')) {
    if (off('hideRomaji')) return null;
  } else if (hit('no')) {
    if (off('hideNo')) return null;
  } else if (hit('time')) {
    if (off('hideTime')) return null;
  } else if (hit('title')) {
    if (off('hideTitle')) return null;
    if (o && o.title != null && slot === 'title') return withText(it, o.title, slot);
  } else if (hit('other')) {
    if (off('hideOther')) return null;
  }
  return it;
};

/* the row list for the panel: what this cut's layout really draws.
   Sampling five instants covers layouts that reveal their text over time. */
J.txProbe = (cut, plan) => {
  const seen = [];
  const R = new J.Renderer();
  const st = plan.style, sch = st.schemes || [];
  const sc = sch[cut.scheme % sch.length] || sch[0] || {};
  const cv = document.createElement('canvas'); cv.width = cv.height = 8;
  const ctx = cv.getContext('2d');
  const td = Math.max(0.05, cut.dur || 0);
  for (const k of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const lt = td * k;
    const env = R.makeEnv(ctx, plan, cut, sc, { pass: 'main', layer: 'front', t: cut.start + lt, lt, ltb: lt, step: 1, scale: 1, allowFilter: false, energy: 0, bgOnly: false, zone: null });
    env.__rec = seen; env.__probe = true; env.__ly = true;
    try { (J.LAYOUTS[cut.layout] || J.LAYOUTS.center).render(env); } catch (e) { /* keep what we have */ }
  }
  const order = ['main', 'main:split', 'line', 'note', 'romaji', 'no', 'time', 'title', 'other'];
  const have = new Set();
  for (const slot of seen) if (slot) slot.split('+').forEach(x => have.add(x));
  return order.filter(x => have.has(x));
};

// Classify at draw time: a live time label differs at every probe sample.
const record = (env, it) => {
  if (env.__rec && it && it.text != null && String(it.text)) {
    env.__rec.push(it.txSlot || J.txSlotOf(env.cut, it.text, env));
  }
};

/* Optimized direct Canvas painters keep their original draw calls. Only probing or
   enabled controls allocate an item / classify text; ordinary rendering is unchanged. */
J.txDirect = (env, text, txSlot) => {
  if (!env.__rec && (!env.__ly || (!(env.cut && env.cut.tx) && !(env.fx && (env.fx.hideNo || env.fx.hideTime))))) return text;
  const it = { text, txSlot };
  record(env, it);
  if (env.__probe) return null;
  const filtered = env.__ly ? J.txApply(env, it) : it;
  return filtered ? filtered.text : null;
};

/* Standard text primitive. */
const drawItem = J.drawItem;
J.drawItem = (env, it) => {
  if (!env) return drawItem(env, it);
  if (env.__rec) {
    record(env, it);
    if (env.__probe) return null;                       // probe: report only, never paint
  }
  if (env.__ly) { try { it = J.txApply(env, it); } catch (e) { /* never drop a frame for a label */ } if (!it) return null; }
  return drawItem(env, it);
};

})();
