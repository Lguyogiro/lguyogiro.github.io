// Exercise generators. Pure functions: given a language's corpus, a level (1–5)
// and a random source, each returns a puzzle object that app.js renders.
// No DOM access here, so tests/generators.test.js can run them in Node.
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ random

  function makeRng(seed) {
    if (seed === undefined) return Math.random;
    let a = seed >>> 0;
    return function () { // mulberry32
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Shuffle, avoiding returning the original order when possible.
  function scramble(arr, rng, same) {
    let out = arr;
    for (let k = 0; k < 20; k++) {
      out = shuffle(arr, rng);
      if (!out.every((x, i) => same(x, arr[i]))) break;
    }
    return out;
  }

  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
  const sample = (arr, n, rng) => shuffle(arr, rng).slice(0, n);

  // ------------------------------------------------------------------ text

  const nfc = (s) => s.normalize("NFC");
  const isLetter = (s) => /\p{L}/u.test(s);
  const APOS = "'’ʼ";
  const WORD_RE = /\p{L}[\p{L}\p{M}'’ʼ-]*/gu;

  // Split text into alternating {type:"sep"} and {type:"word"} tokens.
  function tokenize(text, lang) {
    text = nfc(text);
    const tokens = [];
    let last = 0;
    for (const m of text.matchAll(WORD_RE)) {
      let w = m[0];
      const trail = new RegExp(lang.apostropheIsLetter ? "-+$" : "[-" + APOS + "]+$", "u");
      w = w.replace(trail, "");
      if (m.index > last) tokens.push({ type: "sep", text: text.slice(last, m.index) });
      tokens.push({ type: "word", text: w });
      last = m.index + w.length;
    }
    if (last < text.length) tokens.push({ type: "sep", text: text.slice(last) });
    return tokens;
  }

  const words = (text, lang) => tokenize(text, lang).filter((t) => t.type === "word").map((t) => t.text);

  // Characters with combining marks attached to their base letter.
  function chars(word) {
    const out = [];
    for (const ch of nfc(word)) {
      if (/\p{M}/u.test(ch) && out.length) out[out.length - 1] += ch;
      else out.push(ch);
    }
    return out;
  }

  // Letter units of a word, joining configured digraphs (e.g. "tl") into one unit.
  function graphemes(word, lang) {
    const units = chars(word);
    const digraphs = (lang.digraphs || []).map(chars).sort((a, b) => b.length - a.length);
    const out = [];
    for (let i = 0; i < units.length;) {
      const d = digraphs.find((d) => units.slice(i, i + d.length).join("").toLowerCase() === d.join(""));
      const n = d ? d.length : 1;
      out.push(units.slice(i, i + n).join(""));
      i += n;
    }
    return out;
  }

  const isVowel = (g, lang) => lang.vowels.includes(g.toLowerCase());
  // Letter without an accent, macron or diaeresis ("á" → "a", "ā" → "a"); "ñ" stays "ñ".
  const baseLetter = (g) => nfc(g.normalize("NFD").replace(/[\u0301\u0304\u0308]/g, ""));

  // Split into sentences at . ! ? … followed by space and a sentence start.
  function sentences(text) {
    return nfc(text).trim()
      .split(/(?<=[.!?…]["'”»)]*)\s+(?=[\p{Lu}¿¡"“«(—])/u)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function matchCase(value, original) {
    if (original.length > 1 && original === original.toUpperCase() && original !== original.toLowerCase()) {
      return value.toUpperCase();
    }
    if (original[0] !== original[0].toLowerCase()) return value[0].toUpperCase() + value.slice(1);
    return value;
  }

  // ------------------------------------------------------------------ corpus

  // Reading level of a text: given, or estimated from length.
  function tierOf(t) {
    if (t.level) return t.level;
    const n = t.text.split(/\s+/).length;
    return n <= 25 ? 1 : n <= 60 ? 2 : 3;
  }

  // Which text tiers suit each exercise level.
  const LEVEL_TIERS = { 1: [1], 2: [1, 2], 3: [2], 4: [2, 3], 5: [3] };

  // Precompute per-language data: vocabulary and letter inventory.
  function prepare(texts, lang) {
    const vocab = new Map(); // lower → { count, lower: seen in lowercase }
    const letterCounts = new Map();
    for (const t of texts) {
      for (const w of words(t.text, lang)) {
        const low = w.toLowerCase();
        const e = vocab.get(low) || { count: 0, lower: false };
        e.count++;
        if (w === low) e.lower = true;
        vocab.set(low, e);
        for (const g of graphemes(low, lang)) if (isLetter(g)) letterCounts.set(g, (letterCounts.get(g) || 0) + 1);
      }
    }
    let collator;
    try { collator = new Intl.Collator(lang.code); } catch (e) { collator = new Intl.Collator(); }
    // Letters common enough to use as distractors (so "ñ" from "piñata" stays out of English).
    const total = [...letterCounts.values()].reduce((a, b) => a + b, 0);
    const inventory = [...letterCounts].filter(([, n]) => n >= Math.min(5, total * 0.002)).map(([g]) => g);
    return { texts, lang, vocab, inventory, collator };
  }

  // Choose a text matching `filter`, preferring the tiers for this level and the
  // least recently used texts (recent = ids, oldest first).
  function pickText(ctx, filter) {
    const { data, level, recent, rng } = ctx;
    const tiers = LEVEL_TIERS[level];
    let pool = data.texts.filter((t) => tiers.includes(tierOf(t)) && filter(t));
    if (!pool.length) pool = data.texts.filter(filter);
    if (!pool.length) return null;
    const age = (t) => recent.indexOf(t.id); // -1 = never seen
    const best = Math.min(...pool.map(age));
    return pick(pool.filter((t) => age(t) === best), rng);
  }

  function base(text, type) {
    return { type, textId: text.id, title: text.title, source: text.text };
  }

  // ------------------------------------------------------------------ 1. missing letters

  const LETTER_LEVELS = {
    1: { vowelsOnly: true, rate: 0.2, distractors: 0, perWord: 0.34 },
    2: { vowelsOnly: true, rate: 0.45, distractors: 1, perWord: 0.5 },
    3: { vowelsOnly: false, rate: 0.2, distractors: 2, perWord: 0.4 },
    4: { vowelsOnly: false, rate: 0.35, distractors: 3, perWord: 0.5 },
    5: { vowelsOnly: false, rate: 0.5, distractors: 4, perWord: 0.67 },
  };
  const MAX_LETTER_BLANKS = 30;

  function genLetters(ctx) {
    const { data, level, rng } = ctx;
    const { lang } = data;
    const cfg = LETTER_LEVELS[level];
    const text = pickText(ctx, () => true);
    if (!text) return null;

    const items = [];
    const cands = [];
    for (const tok of tokenize(text.text, lang)) {
      if (tok.type === "sep") { items.push({ kind: "sep", text: tok.text }); continue; }
      const word = { kind: "word", parts: graphemes(tok.text, lang).map((g) => ({ text: g })) };
      word.parts.forEach((p, i) => {
        if (isLetter(p.text) && (!cfg.vowelsOnly || isVowel(p.text, lang))) cands.push({ word, i });
      });
      items.push(word);
    }

    const target = Math.min(MAX_LETTER_BLANKS, Math.max(1, Math.round(cands.length * cfg.rate)));
    const used = new Map();
    let n = 0;
    for (const { word, i } of shuffle(cands, rng)) {
      if (n >= target) break;
      const max = Math.max(1, Math.floor(word.parts.length * cfg.perWord));
      if ((used.get(word) || 0) >= max) continue;
      word.parts[i].answer = word.parts[i].text.toLowerCase();
      used.set(word, (used.get(word) || 0) + 1);
      n++;
    }

    const missing = new Set();
    items.forEach((it) => it.parts && it.parts.forEach((p) => p.answer && missing.add(p.answer)));
    const pool = data.inventory.filter((g) => !missing.has(g) && (!cfg.vowelsOnly || isVowel(g, lang)));
    const bank = [...missing, ...sample(pool, cfg.distractors, rng)].sort(data.collator.compare);

    return { ...base(text, "letters"), items, bank };
  }

  // ------------------------------------------------------------------ 2. missing words

  const WORD_LEVELS = {
    1: { blanks: 1, options: 2, similar: false },
    2: { blanks: 2, options: 3, similar: false },
    3: { blanks: 3, options: 3, similar: true },
    4: { blanks: 4, options: 4, similar: true },
    5: { blanks: 6, options: 4, similar: true },
  };

  function isContentWord(w, lang) {
    const low = w.toLowerCase();
    return chars(w).length >= lang.minWordLen && !lang.stopwords.includes(low) && !/[-'’ʼ]/.test(w);
  }

  function similarity(a, b) {
    const ca = chars(a), cb = chars(b);
    return Math.abs(ca.length - cb.length) + (ca[0] === cb[0] ? 0 : 2) + (ca[ca.length - 1] === cb[cb.length - 1] ? 0 : 1);
  }

  function genWords(ctx) {
    const { data, level, rng } = ctx;
    const { lang } = data;
    const cfg = WORD_LEVELS[level];
    const text = pickText(ctx, (t) => words(t.text, lang).some((w) => isContentWord(w, lang)));
    if (!text) return null;

    const items = tokenize(text.text, lang).map((t) => ({ kind: t.type === "word" ? "word" : "sep", text: t.text }));
    const wordItems = items.filter((it) => it.kind === "word");
    const chosen = [];
    for (const idx of shuffle(wordItems.map((_, i) => i), rng)) {
      if (chosen.length >= cfg.blanks) break;
      const w = wordItems[idx].text;
      if (!isContentWord(w, lang)) continue;
      if (chosen.some((c) => Math.abs(c - idx) <= 1 || wordItems[c].text.toLowerCase() === w.toLowerCase())) continue;
      chosen.push(idx);
    }

    const answers = new Set(chosen.map((i) => wordItems[i].text.toLowerCase()));
    for (const idx of chosen) {
      const it = wordItems[idx];
      const low = it.text.toLowerCase();
      const capital = it.text !== low;
      let pool = [...data.vocab.entries()]
        .filter(([w, e]) => !answers.has(w) && isContentWord(w, lang) && (capital || e.lower))
        .map(([w]) => w);
      if (cfg.similar) {
        pool = shuffle(pool, rng).sort((a, b) => similarity(low, a) - similarity(low, b)).slice(0, 10);
      } else {
        const different = pool.filter((w) => chars(w)[0] !== chars(low)[0]);
        if (different.length >= cfg.options - 1) pool = different;
      }
      const distractors = sample(pool, cfg.options - 1, rng).map((w) => matchCase(w, it.text));
      it.answer = it.text;
      it.options = shuffle([it.text, ...distractors], rng);
    }
    return { ...base(text, "words"), items };
  }

  // ------------------------------------------------------------------ 3. build the sentence

  const BUILDER_RANGES = { 1: [3, 5], 2: [4, 6], 3: [5, 8], 4: [7, 10], 5: [9, 14] };

  // Find a sentence whose word count is in [min, max], widening the range if needed.
  function pickSentence(ctx, range) {
    const { data, rng } = ctx;
    for (let widen = 0; widen <= 6; widen++) {
      const lo = Math.max(2, range[0] - widen), hi = range[1] + widen;
      const fits = (s) => { const n = s.split(/\s+/).length; return n >= lo && n <= hi; };
      const text = pickText(ctx, (t) => sentences(t.text).some(fits));
      if (text) return { text, sentence: pick(sentences(text.text).filter(fits), rng) };
    }
    return null;
  }

  function genBuilder(ctx) {
    const { data, level, rng } = ctx;
    const found = pickSentence(ctx, BUILDER_RANGES[level]);
    if (!found) return null;
    const { text, sentence } = found;
    let tiles = sentence.split(/\s+/);
    let ending = "";
    if (level >= 4) {
      // Harder: no punctuation or capital letter to give away the first and last word.
      ending = (sentence.match(/[.!?…]+["'”»]*$/u) || [""])[0];
      tiles = tiles.map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
      const first = tiles[0].toLowerCase();
      if (data.vocab.get(first) && data.vocab.get(first).lower) tiles[0] = first;
    }
    return {
      ...base(text, "builder"),
      answer: tiles,
      tiles: scramble(tiles, rng, (a, b) => a === b),
      ending,
    };
  }

  // ------------------------------------------------------------------ 4. spot the mistakes

  const SPOT_LEVELS = {
    1: { errors: 1, edits: 2, minLen: 4 },
    2: { errors: 2, edits: 2, minLen: 4 },
    3: { errors: 2, edits: 1, minLen: 4 },
    4: { errors: 3, edits: 1, minLen: 3 },
    5: { errors: 4, edits: 1, minLen: 3 },
  };

  // Apply one random spelling change to a list of letters.
  function misspellOnce(g, lang, rng) {
    const n = g.length;
    const vowelBase = lang.vowels.filter((v) => /^[aeiou]$/.test(v));
    const edits = [
      () => { // swap two neighbouring letters (not the first)
        const opts = [];
        for (let i = 1; i < n - 1; i++) if (g[i] !== g[i + 1]) opts.push(i);
        if (!opts.length) return null;
        const i = pick(opts, rng), h = g.slice();
        [h[i], h[i + 1]] = [h[i + 1], h[i]];
        return h;
      },
      () => { // change a vowel
        const opts = g.map((x, i) => i).filter((i) => isVowel(g[i], lang));
        if (!opts.length) return null;
        const i = pick(opts, rng), h = g.slice();
        h[i] = pick(vowelBase.filter((v) => v !== g[i]), rng);
        return h;
      },
      () => { // drop a letter from the middle
        if (n < 4) return null;
        const i = 1 + Math.floor(rng() * (n - 2)), h = g.slice();
        h.splice(i, 1);
        return h;
      },
      () => { // double a consonant
        const opts = g.map((x, i) => i).filter((i) => i > 0 && isLetter(g[i]) && !isVowel(g[i], lang) && g[i] !== g[i - 1]);
        if (!opts.length) return null;
        const i = pick(opts, rng), h = g.slice();
        h.splice(i, 0, g[i]);
        return h;
      },
    ];
    return pick(edits, rng)();
  }

  function misspell(word, edits, ctx) {
    const { data, rng } = ctx;
    const low = word.toLowerCase();
    for (let attempt = 0; attempt < 30; attempt++) {
      let g = graphemes(low, data.lang);
      for (let e = 0; e < edits && g; e++) g = misspellOnce(g, data.lang, rng);
      if (!g) continue;
      const wrong = g.join("");
      if (wrong !== low && !data.vocab.has(wrong)) return matchCase(wrong, word);
    }
    return null;
  }

  function genSpot(ctx) {
    const { data, level, rng } = ctx;
    const { lang } = data;
    const cfg = SPOT_LEVELS[level];
    const eligible = (w) => chars(w).length >= Math.max(cfg.minLen, lang.minWordLen - 1) && !/[-'’ʼ]/.test(w);
    const text = pickText(ctx, (t) => words(t.text, lang).filter(eligible).length >= cfg.errors * 2);
    if (!text) return null;

    const items = tokenize(text.text, lang).map((t) => ({ kind: t.type === "word" ? "word" : "sep", text: t.text }));
    const wordItems = items.filter((it) => it.kind === "word");
    const chosen = [];
    for (const idx of shuffle(wordItems.map((_, i) => i), rng)) {
      if (chosen.length >= cfg.errors) break;
      const it = wordItems[idx];
      if (!eligible(it.text) || chosen.some((c) => Math.abs(c - idx) <= 1)) continue;
      const wrong = misspell(it.text, cfg.edits, ctx);
      if (!wrong) continue;
      it.correct = it.text;
      it.text = wrong;
      chosen.push(idx);
    }
    if (!chosen.length) return null;
    return { ...base(text, "spot"), items, errors: chosen.length };
  }

  // ------------------------------------------------------------------ 5. split the words

  const BREAK_RANGES = { 1: [2, 3], 2: [3, 4], 3: [4, 6], 4: [5, 8], 5: [7, 11] };

  function genBreaks(ctx) {
    const { data, level } = ctx;
    const found = pickSentence(ctx, BREAK_RANGES[level]);
    if (!found) return null;
    const { text, sentence } = found;
    let ws = words(sentence, data.lang);
    if (level >= 4) ws = ws.map((w) => w.toLowerCase());
    const letters = [];
    const breaks = []; // index of the letter after which a space belongs
    ws.forEach((w, i) => {
      letters.push(...chars(w));
      if (i < ws.length - 1) breaks.push(letters.length - 1);
    });
    const ending = (sentence.match(/[.!?…]/gu) || []).pop() || "";
    return { ...base(text, "breaks"), letters, breaks, ending, sentence };
  }

  // ------------------------------------------------------------------ quick rounds
  // Picture Words and Listen & Find are rounds of ROUND_SIZE short questions (like the math
  // quizzes) instead of one puzzle per text. Questions are either multiple choice
  // ({ options, answer }) or "build" questions ({ pieces, answerPieces, answer }) where the
  // child taps pieces (syllables or letters) in order.

  const ROUND_SIZE = 5;
  const MIN_PICTURES = 8;

  // Letters that sound alike (or are often mixed up) never appear as each other's distractors,
  // e.g. "c" is not a wrong choice for "cerdo" when "s" is the answer.
  function confusable(a, b, lang) {
    return a === b || (lang.letterConfusions || []).some((g) => g.includes(a) && g.includes(b));
  }

  // 1 first letter · 2 choose the word · 3 build it from syllables · 4 choose among look-alikes · 5 spell it
  const PICTURE_LEVELS = {
    1: { mode: "first", options: 3 },
    2: { mode: "choose", options: 3, similar: false },
    3: { mode: "syllables", extra: 1 },
    4: { mode: "choose", options: 4, similar: true },
    5: { mode: "spell", extra: 2 },
  };

  // Entries of the picture dictionary that have a word in this language.
  function pictureWords(entries, lang) {
    return entries.filter((e) => e[lang.code]).map((e) => {
      const syll = nfc(e[lang.code]).toLowerCase().split("-");
      return { pic: e.pic, syll, word: syll.join("") };
    });
  }

  function genPicture(ctx) {
    const { data: { pictures, lang }, level, rng, used } = ctx;
    let cfg = PICTURE_LEVELS[level];
    const skip = lang.firstLetterSkip || [];
    const eligible = {
      first: (w) => !skip.some((s) => w.word.startsWith(s)) && isLetter(chars(w.word)[0]),
      choose: () => true,
      syllables: (w) => w.syll.length >= 2,
      spell: (w) => chars(w.word).length >= 3 && chars(w.word).length <= 8,
    };
    let pool = pictures.filter((w) => eligible[cfg.mode](w) && !used.has(w.pic));
    if (pool.length < 3) { cfg = PICTURE_LEVELS[2]; pool = pictures.filter((w) => !used.has(w.pic)); }
    if (!pool.length) return null;
    const w = pick(pool, rng);
    const others = pictures.filter((o) => o.word !== w.word);
    const q = { kind: "picture", mode: cfg.mode, key: w.pic, pic: w.pic, word: w.word };

    if (cfg.mode === "first") {
      const first = baseLetter(chars(w.word)[0]);
      const letters = [...new Set([...others.map((o) => chars(o.word)[0]), ...ctx.data.inventory].map(baseLetter))]
        .filter((l) => isLetter(l) && !confusable(l, first, lang));
      q.answer = first;
      q.options = shuffle([first, ...sample(letters, cfg.options - 1, rng)], rng);
    } else if (cfg.mode === "choose") {
      let cands = others.map((o) => o.word);
      if (cfg.similar) cands = shuffle(cands, rng).sort((a, b) => similarity(w.word, a) - similarity(w.word, b)).slice(0, 6);
      else {
        const different = cands.filter((c) => chars(c)[0] !== chars(w.word)[0]);
        if (different.length >= cfg.options - 1) cands = different;
      }
      q.answer = w.word;
      q.options = shuffle([w.word, ...sample(cands, cfg.options - 1, rng)], rng);
    } else {
      const parts = cfg.mode === "syllables" ? w.syll : chars(w.word);
      const spare = cfg.mode === "syllables"
        ? [...new Set(others.flatMap((o) => o.syll))].filter((s) => !parts.includes(s))
        // Spare letters: plain letters that don't sound like any letter of the word.
        : ctx.data.inventory.filter((l) => baseLetter(l) === l && !parts.some((pc) => confusable(l, baseLetter(pc), lang)));
      q.answer = w.word;
      q.answerPieces = parts;
      q.pieces = scramble([...parts, ...sample(spare, cfg.extra, rng)], rng, (a, b) => a === b);
    }
    return q;
  }

  // Words that sound the same can't be told apart by ear: "que"/"qué", "to"/"two", "casa"/"caza".
  function sameSound(a, b, lang) {
    const strip = (w) => [...chars(w)].map(baseLetter).join("");
    if (strip(a) === strip(b)) return true;
    if ((lang.homophones || []).some((g) => g.includes(a) && g.includes(b))) return true;
    return !!lang.soundKey && lang.soundKey(strip(a)) === lang.soundKey(strip(b));
  }

  // Listen & Find: hear a word, tap it. Short, frequent words (sight words such as "the" or
  // "es" included) at the low levels; longer words and look-alike choices higher up.
  const LISTEN_LEVELS = {
    1: { len: [2, 4], top: 30, options: 2, similar: false },
    2: { len: [2, 5], top: 60, options: 3, similar: false },
    3: { len: [3, 6], top: 120, options: 3, similar: true },
    4: { len: [3, 8], top: Infinity, options: 4, similar: true },
    5: { len: [5, 12], top: Infinity, options: 4, similar: true },
  };

  function genListen(ctx) {
    const { data, level, rng, used } = ctx;
    const cfg = LISTEN_LEVELS[level];
    // Only words seen in lowercase (not names) and made of plain letters.
    const vocab = [...data.vocab.entries()]
      .filter(([w, e]) => e.lower && /^\p{L}+$/u.test(w))
      .sort((a, b) => b[1].count - a[1].count)
      .map(([w]) => w);
    const fits = (w, [lo, hi]) => chars(w).length >= lo && chars(w).length <= hi;
    let pool = vocab.slice(0, cfg.top).filter((w) => fits(w, cfg.len) && !used.has(w));
    if (pool.length < 3) pool = vocab.filter((w) => fits(w, cfg.len) && !used.has(w));
    if (pool.length < 3) pool = vocab.filter((w) => !used.has(w));
    if (!pool.length) return null;
    const word = pick(pool, rng);
    let cands = vocab.slice(0, Math.max(cfg.top * 2, 80))
      .filter((w) => !sameSound(w, word, data.lang) && fits(w, [Math.max(1, cfg.len[0] - 1), cfg.len[1] + 2]));
    if (cfg.similar) cands = shuffle(cands, rng).sort((a, b) => similarity(word, a) - similarity(word, b)).slice(0, 6);
    else {
      const different = cands.filter((c) => chars(c)[0] !== chars(word)[0]);
      if (different.length >= cfg.options - 1) cands = different;
    }
    return { kind: "listen", key: word, word, answer: word, options: shuffle([word, ...sample(cands, cfg.options - 1, rng)], rng) };
  }

  const ROUNDS = { pictures: genPicture, listen: genListen };

  // round("pictures", { data: prepare(...), pictures: window.PICTURES, level, seed? }) → questions
  function round(type, opts) {
    const data = { ...opts.data, pictures: pictureWords(opts.pictures || [], opts.data.lang) };
    const ctx = { data, level: opts.level, rng: makeRng(opts.seed), used: new Set() };
    const out = [];
    for (let k = 0; k < ROUND_SIZE; k++) {
      const q = ROUNDS[type](ctx);
      if (!q) break;
      ctx.used.add(q.key);
      out.push(q);
    }
    return out;
  }

  // Can this activity be played in this language? (Listen & Find also needs a voice; app.js checks that.)
  function roundAvailable(type, opts) {
    if (type === "pictures") return pictureWords(opts.pictures || [], opts.data.lang).length >= MIN_PICTURES;
    return opts.data.vocab.size >= 10;
  }

  // ------------------------------------------------------------------ 6. word search

  // Directions as [row step, column step].
  const RIGHT = [0, 1], DOWN = [1, 0], DOWN_RIGHT = [1, 1], UP_RIGHT = [-1, 1];
  const WORDSEARCH_LEVELS = {
    1: { size: 5, words: 3, dirs: [RIGHT], overlap: false },
    2: { size: 6, words: 4, dirs: [RIGHT, DOWN], overlap: false },
    3: { size: 7, words: 5, dirs: [RIGHT, DOWN, DOWN_RIGHT], overlap: true },
    4: { size: 8, words: 6, dirs: [RIGHT, DOWN, DOWN_RIGHT, UP_RIGHT], overlap: true },
    // also backwards
    5: { size: 9, words: 7, dirs: [RIGHT, DOWN, DOWN_RIGHT, UP_RIGHT, [0, -1], [-1, 0], [-1, -1], [1, -1]], overlap: true },
  };

  function genWordSearch(ctx) {
    const { data, level, rng } = ctx;
    const { lang } = data;
    const cfg = WORDSEARCH_LEVELS[level];
    // Content words seen in lowercase (not names), made of letters only, that fit in the grid.
    const usable = (t) => [...new Set(words(t.text, lang).map((w) => w.toLowerCase()))].filter((w) =>
      isContentWord(w, lang) && /^\p{L}+$/u.test(w) && (data.vocab.get(w) || {}).lower
      && graphemes(w, lang).length >= 3 && graphemes(w, lang).length <= cfg.size);
    const text = pickText(ctx, (t) => usable(t).length >= cfg.words) || pickText(ctx, (t) => usable(t).length >= 2);
    if (!text) return null;

    const n = cfg.size;
    const grid = Array.from({ length: n }, () => new Array(n).fill(null));
    const placed = [];
    // Longest words first: they are the hardest to fit.
    const cands = shuffle(usable(text), rng).slice(0, cfg.words + 3)
      .sort((a, b) => graphemes(b, lang).length - graphemes(a, lang).length);
    for (const word of cands) {
      if (placed.length >= cfg.words) break;
      const g = graphemes(word, lang);
      // Choose the direction first so every direction comes up about as often.
      const spots = [];
      for (const [dr, dc] of shuffle(cfg.dirs, rng)) {
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            const er = r + dr * (g.length - 1), ec = c + dc * (g.length - 1);
            if (er < 0 || er >= n || ec < 0 || ec >= n) continue;
            const cells = g.map((_, k) => [r + dr * k, c + dc * k]);
            const fits = cells.every(([cr, cc], k) => grid[cr][cc] === null || (cfg.overlap && grid[cr][cc] === g[k]));
            if (fits) spots.push(cells);
          }
        }
        if (spots.length) break;
      }
      if (!spots.length) continue;
      const cells = pick(spots, rng);
      cells.forEach(([r, c], k) => (grid[r][c] = g[k]));
      placed.push({ word, cells });
    }
    if (placed.length < 2) return null;

    // Fill the rest with letters from the same text, so they look like the language.
    const filler = words(text.text, lang).flatMap((w) => graphemes(w.toLowerCase(), lang)).filter(isLetter);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (grid[r][c] === null) grid[r][c] = pick(filler, rng);
    // The word list is shown in the order the words appear in the text.
    const order = words(text.text, lang).map((w) => w.toLowerCase());
    placed.sort((a, b) => order.indexOf(a.word) - order.indexOf(b.word));
    return { ...base(text, "wordsearch"), size: n, grid, words: placed };
  }

  // ------------------------------------------------------------------ registry

  const GENERATORS = {
    letters: genLetters,
    words: genWords,
    builder: genBuilder,
    spot: genSpot,
    breaks: genBreaks,
    wordsearch: genWordSearch,
  };

  // generate("letters", { data: prepare(...), level: 1..5, recent: [ids], seed? })
  function generate(type, opts) {
    const ctx = { data: opts.data, level: opts.level, recent: opts.recent || [], rng: makeRng(opts.seed) };
    if (!ctx.data.texts.length) return null;
    return GENERATORS[type](ctx);
  }

  root.LitGen = {
    EXERCISES: Object.keys(GENERATORS),
    ROUNDS: Object.keys(ROUNDS),
    MIN_PICTURES,
    prepare, generate, round, roundAvailable,
    // exposed for tests
    tokenize, graphemes, sentences, chars, tierOf, matchCase, sameSound, WORDSEARCH_LEVELS,
  };
})(typeof window !== "undefined" ? window : globalThis);
