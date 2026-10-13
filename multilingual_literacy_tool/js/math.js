// Math activities: fact decks with spaced repetition, and question generators for the
// quick-round activities. Pure functions (no DOM), tested by tests/math.test.js.
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
  const randInt = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // The answer plus up to n-1 distinct distractors (in the order given), shuffled.
  function withDistractors(answer, candidates, n, rng, valid) {
    const opts = [answer];
    for (const c of candidates) {
      if (opts.length >= n) break;
      if (!opts.includes(c) && (!valid || valid(c))) opts.push(c);
    }
    return shuffle(opts, rng);
  }

  // ------------------------------------------------------------------ fact decks

  // Each level is a deck of facts, ordered roughly easiest first so new facts come in gently.
  const DECK_INFO = {
    1: "+ ≤ 10",
    2: "− ≤ 10",
    3: "+ − ≤ 20",
    4: "× 0–5",
    5: "× ÷ ≤ 100",
  };

  function fact(a, op, b) {
    const answer = op === "+" ? a + b : op === "−" ? a - b : op === "×" ? a * b : a / b;
    return { id: `${a}${op}${b}`, a, op, b, answer };
  }

  function buildDeck(level) {
    const out = [];
    const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    if (level === 1) {
      for (const s of range(0, 10)) for (const a of range(0, s)) out.push(fact(a, "+", s - a));
    } else if (level === 2) {
      for (const a of range(0, 10)) for (const b of range(0, a)) out.push(fact(a, "−", b));
    } else if (level === 3) {
      for (const s of range(11, 20)) {
        for (const a of range(s - 10, 10)) {
          out.push(fact(a, "+", s - a));
          out.push(fact(s, "−", a));
        }
      }
    } else if (level === 4) {
      for (const a of range(0, 5)) for (const b of range(0, 10)) out.push(fact(a, "×", b));
      out.sort((x, y) => Math.max(x.a, x.b) - Math.max(y.a, y.b) || x.answer - y.answer);
    } else {
      for (const a of range(6, 10)) {
        for (const b of range(1, 10)) {
          out.push(fact(a, "×", b));
          out.push(fact(a * b, "÷", a));
        }
      }
    }
    return out;
  }

  const decks = {};
  const deck = (level) => decks[level] || (decks[level] = buildDeck(level));

  // ------------------------------------------------------------------ spaced repetition
  //
  // Leitner boxes. A fact's record is { box, due, right, wrong }.
  //   box 0  = new or just missed: asked again in the same session
  //   box n  = next review after BOX_DAYS[n] days
  // A fast correct answer moves the fact up one box. A slow correct answer keeps it in its box
  // (it is known but not yet automatic). A wrong answer sends it back to box 0.

  const DAY = 24 * 60 * 60 * 1000;
  const BOX_DAYS = [0, 1, 2, 4, 8, 16, 32];
  const MAX_BOX = BOX_DAYS.length - 1;
  const MASTERED_BOX = 4;
  const FLUENT_MS = 6000;
  const SESSION_SIZE = 10;
  const MAX_NEW = 4;

  // Choose the facts for one session: due reviews first (most overdue first), then a few new
  // facts, then extra practice on the least-known facts if there is room.
  function buildSession(level, records, now, rng = Math.random) {
    const facts = deck(level);
    const due = facts.filter((f) => records[f.id] && records[f.id].due <= now)
      .sort((x, y) => records[x.id].due - records[y.id].due || records[x.id].box - records[y.id].box);
    const fresh = facts.filter((f) => !records[f.id]);
    const session = due.slice(0, SESSION_SIZE);
    // Always leave room for a couple of new facts while there are any.
    const newCount = Math.min(fresh.length, MAX_NEW, Math.max(SESSION_SIZE - session.length, Math.min(2, fresh.length)));
    if (session.length + newCount > SESSION_SIZE) session.length = SESSION_SIZE - newCount;
    session.push(...fresh.slice(0, newCount));
    if (session.length < SESSION_SIZE) {
      const extra = facts.filter((f) => records[f.id] && !session.includes(f))
        .sort((x, y) => records[x.id].box - records[y.id].box || records[x.id].due - records[y.id].due);
      session.push(...extra.slice(0, SESSION_SIZE - session.length));
    }
    return shuffle(session, rng);
  }

  // Returns the updated record for one answer.
  function grade(record, correct, ms, now) {
    const r = record ? { ...record } : { box: 0, due: now, right: 0, wrong: 0 };
    if (correct) {
      r.right++;
      r.box = ms <= FLUENT_MS ? Math.min(MAX_BOX, r.box + 1) : Math.max(1, r.box);
    } else {
      r.wrong++;
      r.box = 0;
    }
    r.due = now + BOX_DAYS[r.box] * DAY;
    return r;
  }

  // How many facts of a deck are new / learning / known / mastered.
  function deckStats(level, records) {
    const s = { total: 0, new: 0, learning: 0, known: 0, mastered: 0 };
    for (const f of deck(level)) {
      s.total++;
      const r = records[f.id];
      if (!r) s.new++;
      else s[stage(r)]++;
    }
    return s;
  }

  function stage(record) {
    if (!record) return "new";
    if (record.box >= MASTERED_BOX) return "mastered";
    if (record.box >= 2) return "known";
    return "learning";
  }

  // ------------------------------------------------------------------ quick-round activities

  const ROUND_SIZE = 5;

  // Counting objects.
  const COUNT_LEVELS = {
    1: { min: 1, max: 5, layout: "row", options: 3 },
    2: { min: 3, max: 10, layout: "frames", options: 3 },
    3: { min: 3, max: 10, layout: "scatter", options: 4 },
    4: { min: 11, max: 20, layout: "frames", options: 4 },
    5: { min: 11, max: 20, layout: "scatter", options: 4 },
  };
  const THINGS = ["🍎", "⭐", "🐟", "🌽", "🦋", "🐞", "🌸", "⚽", "🐢", "🍓", "🐥", "🌵"];
  const SCATTER_COLS = 6, SCATTER_ROWS = 4;

  function genCount(level, rng) {
    const cfg = COUNT_LEVELS[level];
    const n = randInt(cfg.min, cfg.max, rng);
    const q = { kind: "count", key: "c" + n, n, thing: pick(THINGS, rng), layout: cfg.layout, answer: String(n) };
    if (cfg.layout === "scatter") {
      // Random cells of a grid, jittered so it doesn't look like a grid.
      const cells = shuffle(Array.from({ length: SCATTER_COLS * SCATTER_ROWS }, (_, i) => i), rng).slice(0, n);
      q.positions = cells.map((c) => ({
        x: ((c % SCATTER_COLS) + 0.2 + rng() * 0.6) / SCATTER_COLS,
        y: (Math.floor(c / SCATTER_COLS) + 0.2 + rng() * 0.6) / SCATTER_ROWS,
      }));
    }
    q.options = withDistractors(n, shuffle([n - 1, n + 1, n - 2, n + 2], rng), cfg.options, rng, (x) => x >= 1).map(String);
    return q;
  }

  // Comparing numbers with <, =, >.
  const COMPARE_LEVELS = {
    1: { max: 10, dots: true },
    2: { max: 20 },
    3: { max: 100 },
    4: { min: 100, max: 999 },
    5: { expr: true, max: 20 },
  };

  function genCompare(level, rng) {
    const cfg = COMPARE_LEVELS[level];
    const num = () => randInt(cfg.min || 0, cfg.max, rng);
    let left, right, lv, rv;
    if (cfg.expr) {
      // a + b  vs  c (or vs another sum), close together so it needs working out.
      const a = randInt(1, 10, rng), b = randInt(1, 10, rng);
      lv = a + b;
      rv = Math.max(0, lv + pick([-2, -1, 0, 0, 1, 2], rng));
      left = `${a} + ${b}`;
      if (rng() < 0.5) {
        const c = randInt(Math.max(0, rv - 10), Math.min(10, rv), rng);
        right = `${c} + ${rv - c}`;
      } else right = String(rv);
    } else {
      lv = num();
      // Equal about 1 time in 6; otherwise often close (same tens digit) to make it interesting.
      const r = rng();
      if (r < 0.17) rv = lv;
      else if (r < 0.6 && cfg.max > 20) rv = Math.min(cfg.max, Math.max(cfg.min || 0, lv + randInt(-9, 9, rng)));
      else rv = num();
      left = String(lv);
      right = String(rv);
    }
    const answer = lv < rv ? "<" : lv > rv ? ">" : "=";
    return { kind: "compare", key: `${left}|${right}`, left, right, lv, rv, dots: !!cfg.dots, options: ["<", "=", ">"], answer };
  }

  // Missing number in a counting pattern.
  const PATTERN_LEVELS = {
    1: { steps: [1], max: 20, back: false },
    2: { steps: [1], max: 50, back: true },
    3: { steps: [2, 5, 10], max: 100, back: false },
    4: { steps: [2, 3, 5, 10], max: 100, back: true },
    5: { steps: [3, 4, 25, 100], max: 1000, back: true },
  };

  function genPattern(level, rng) {
    const cfg = PATTERN_LEVELS[level];
    const step = pick(cfg.steps, rng) * (cfg.back && rng() < 0.4 ? -1 : 1);
    const len = 5;
    const span = Math.abs(step) * (len - 1);
    let start = randInt(0, Math.max(0, cfg.max - span), rng);
    // Skip counting by 5/10/25/100 starts on a multiple, as in class.
    if ([5, 10, 25, 100].includes(Math.abs(step))) start -= start % Math.abs(step);
    if (step < 0) start += span;
    const seq = Array.from({ length: len }, (_, i) => start + step * i);
    const hole = level === 1 ? randInt(2, 4, rng) : randInt(1, 4, rng);
    const answer = seq[hole];
    const a = Math.abs(step);
    const lo = Math.min(...seq), hi = Math.max(...seq);
    const near = [answer + 1, answer - 1, answer + a, answer - a, answer + 2 * a, answer + 3 * a];
    const far = [lo - a, hi + a, answer + 10, answer - 10, lo - 1, hi + 1];
    // Numbers already shown in the pattern are not useful choices.
    const options = withDistractors(answer, [...shuffle(near, rng), ...shuffle(far, rng)], 4, rng,
      (x) => x >= 0 && !seq.includes(x));
    return {
      kind: "pattern", key: seq.join(","),
      seq: seq.map((v, i) => (i === hole ? null : v)), options: options.map(String), answer: String(answer),
    };
  }

  // Place value with base-ten blocks.
  const PLACE_LEVELS = { 1: [11, 19], 2: [20, 59], 3: [10, 99], 4: [100, 299], 5: [100, 999] };

  function genPlace(level, rng) {
    const [lo, hi] = PLACE_LEVELS[level];
    const n = randInt(lo, hi, rng);
    const hundreds = Math.floor(n / 100), tens = Math.floor(n / 10) % 10, ones = n % 10;
    // Typical mistakes: swapping tens and ones, being off by one block.
    const swapped = hundreds * 100 + ones * 10 + tens;
    const cands = shuffle([n + 10, n - 10, n + 1, n - 1, ...(hundreds ? [n + 100, n - 100] : [])], rng);
    if (swapped !== n && ones !== 0) cands.unshift(swapped);
    const options = withDistractors(n, cands, 4, rng, (x) => x > 0);
    return { kind: "place", key: "p" + n, hundreds, tens, ones, options: options.map(String), answer: String(n) };
  }

  // Telling time on an analog clock.
  const CLOCK_MINUTES = {
    1: [0],
    2: [0, 30],
    3: [0, 15, 30, 45],
    4: Array.from({ length: 12 }, (_, i) => i * 5),
    5: Array.from({ length: 60 }, (_, i) => i),
  };
  const fmtTime = (h, m) => `${h}:${String(m).padStart(2, "0")}`;
  const wrapHour = (h) => ((h - 1 + 12) % 12) + 1;

  function genClock(level, rng) {
    const mins = CLOCK_MINUTES[level];
    const h = randInt(1, 12, rng), m = pick(mins, rng);
    const answer = fmtTime(h, m);
    const cands = [
      fmtTime(wrapHour(h + (m >= 30 ? 1 : -1)), m), // reading the hour hand wrongly
      fmtTime(wrapHour(h + (m >= 30 ? -1 : 1)), m),
    ];
    // Mixing up the hands: hour hand read as minutes and minute hand as hours.
    if (m % 5 === 0 && m !== 0) cands.push(fmtTime(m / 5, (h % 12) * 5));
    for (const om of shuffle(mins.length > 1 ? mins : [0, 30], rng)) cands.push(fmtTime(h, om));
    for (const om of shuffle(mins, rng)) cands.push(fmtTime(wrapHour(h + 1), om));
    const options = withDistractors(answer, cands.slice(0, 3).concat(shuffle(cands.slice(3), rng)), 4, rng);
    return { kind: "clock", key: answer, h, m, options, answer };
  }

  // Addition and subtraction in many forms. Each level cycles through its forms, so a round
  // mixes them. Every question has exactly one unknown (null in `tokens`, or in the bond/column).
  const EQUATION_FORMS = {
    1: ["picAdd", "picSub"],
    2: ["missAdd", "bond", "makeTen", "picSub"],
    3: ["missSub", "three", "bond", "missAdd"],
    4: ["colAdd", "colSub", "missTens", "three"],
    5: ["balance", "colAdd", "colSub", "missBig"],
  };
  const EQUATION_MAX = { 1: 10, 2: 10, 3: 20, 4: 30, 5: 20 };

  // Two-digit numbers for column sums; `regroup` forces a carry (add) or a borrow (subtract).
  function columnPair(op, regroup, rng) {
    for (;;) {
      const a1 = randInt(1, 8, rng), b1 = randInt(1, 8, rng), a0 = randInt(0, 9, rng), b0 = randInt(0, 9, rng);
      if (op === "+") {
        if (a1 + b1 + (a0 + b0 >= 10 ? 1 : 0) > 9 || (a0 + b0 >= 10) !== regroup) continue;
      } else if (a1 <= b1 || (a0 < b0) !== regroup) continue;
      return [a1 * 10 + a0, b1 * 10 + b0];
    }
  }

  function genEquation(level, rng, index = 0) {
    const forms = EQUATION_FORMS[level];
    const form = forms[index % forms.length];
    const max = EQUATION_MAX[level];
    const q = { kind: "equation", form };
    let answer, near = [];
    switch (form) {
      case "picAdd": { // 🍎🍎🍎 + 🍎🍎 = ?
        const a = randInt(1, max - 1, rng), b = randInt(1, max - a, rng);
        answer = a + b;
        q.tokens = [a, "+", b, "=", null];
        q.picture = { groups: [a, b], thing: pick(THINGS, rng) };
        near = [answer + 1, answer - 1, Math.abs(a - b), answer + 2];
        break;
      }
      case "picSub": { // 🍎🍎🍎🍎 with some crossed out
        const a = randInt(3, max, rng), b = randInt(1, a - 1, rng);
        answer = a - b;
        q.tokens = [a, "−", b, "=", null];
        q.picture = { groups: [a], crossed: b, thing: pick(THINGS, rng) };
        near = [answer + 1, answer - 1, a + b, b];
        break;
      }
      case "missAdd": { // 3 + ? = 7  /  ? + 4 = 7
        const c = randInt(3, max, rng), a = randInt(1, c - 1, rng), b = c - a;
        if (rng() < 0.5) { q.tokens = [a, "+", null, "=", c]; answer = b; } else { q.tokens = [null, "+", b, "=", c]; answer = a; }
        near = [c, answer + 1, answer - 1, c + (c - answer)];
        break;
      }
      case "missSub": { // 9 − ? = 3  /  ? − 4 = 5
        const a = randInt(4, max, rng), b = randInt(1, a - 1, rng), d = a - b;
        if (rng() < 0.5) { q.tokens = [a, "−", null, "=", d]; answer = b; near = [a + d, d, b + 1, b - 1]; } else { q.tokens = [null, "−", b, "=", d]; answer = a; near = [d - b, a + 1, a - 1, d]; }
        break;
      }
      case "bond": { // part-part-whole
        const whole = randInt(5, max, rng), part = randInt(1, whole - 1, rng);
        if (rng() < 0.3) { q.bond = { whole: null, parts: [part, whole - part] }; answer = whole; near = [whole + 1, whole - 1, Math.abs(whole - 2 * part)]; } else {
          q.bond = rng() < 0.5 ? { whole, parts: [part, null] } : { whole, parts: [null, part] };
          answer = whole - part;
          near = [whole + part, answer + 1, answer - 1, whole];
        }
        break;
      }
      case "makeTen": { // ten-frame with a dots: a + ? = 10
        const a = randInt(1, 9, rng);
        answer = 10 - a;
        q.tokens = [a, "+", null, "=", 10];
        q.frame = { filled: a, thing: pick(THINGS, rng) };
        near = [a, answer + 1, answer - 1, 10 + a];
        break;
      }
      case "three": { // 4 + 3 + 5 = ?
        const a = randInt(1, Math.floor(max / 2), rng), b = randInt(1, max - a - 1, rng), c = randInt(1, Math.max(1, Math.min(9, max - a - b)), rng);
        answer = a + b + c;
        q.tokens = [a, "+", b, "+", c, "=", null];
        near = [a + b, b + c, answer + 1, answer - 1, answer + 10];
        break;
      }
      case "colAdd":
      case "colSub": { // two-digit numbers in columns
        const op = form === "colAdd" ? "+" : "−";
        const [a, b] = columnPair(op, level >= 5 || rng() < 0.5, rng);
        answer = op === "+" ? a + b : a - b;
        q.column = { top: a, bottom: b, op };
        // Typical slips: forgetting the carry, or subtracting the smaller ones digit from the larger.
        const slip = op === "+" ? answer - 10 : Math.floor(answer / 10) * 10 + Math.abs((a % 10) - (b % 10));
        near = [slip, answer + 10, answer - 10, answer + 1, answer - 1];
        break;
      }
      case "missTens": { // 30 + ? = 70  /  70 − ? = 40
        const c = 10 * randInt(3, 9, rng), a = 10 * randInt(1, c / 10 - 1, rng);
        answer = c - a;
        q.tokens = rng() < 0.5 ? [a, "+", null, "=", c] : [c, "−", null, "=", a];
        near = [answer + 10, answer - 10, c, answer + 20];
        break;
      }
      case "missBig": { // 45 + ? = 72
        const c = randInt(30, 99, rng), a = randInt(11, c - 11, rng);
        answer = c - a;
        q.tokens = [a, "+", null, "=", c];
        near = [answer + 10, answer - 10, answer + 1, answer - 1];
        break;
      }
      case "balance": { // 5 + 3 = ? + 6
        const a = randInt(2, 10, rng), b = randInt(2, 10, rng), s = a + b, c = randInt(1, s - 1, rng);
        answer = s - c;
        q.tokens = rng() < 0.5 ? [a, "+", b, "=", null, "+", c] : [c, "+", null, "=", a, "+", b];
        near = [s, s + c, answer + 1, answer - 1];
        break;
      }
    }
    q.answer = String(answer);
    q.key = form + JSON.stringify(q.tokens || q.bond || q.column) + (q.picture ? q.picture.crossed || "" : "");
    q.options = withDistractors(answer, shuffle(near, rng).concat([answer + 2, answer - 2, answer + 3]), 4, rng,
      (x) => Number.isInteger(x) && x >= 0).map(String);
    return q;
  }

  // Story problems (word problems). The generator picks the numbers and the story type; the
  // sentences come from the interface language (UI_STRINGS.*.problem in i18n.js), so a child can
  // read or hear the same problem in English or Spanish.
  //   join      a + b = ?      separate  a − b = ?      total   a + b (two children)
  //   compare   a − b (how many more)                  change  a + ? = c
  const PROBLEM_LEVELS = {
    1: { types: ["join", "separate"], max: 5, picture: true },
    2: { types: ["join", "separate", "total"], max: 10, picture: true },
    3: { types: ["join", "separate", "total", "compare"], max: 20, picture: true },
    4: { types: ["join", "separate", "compare", "change"], max: 20, picture: false },
    5: { types: ["join", "separate", "total", "compare", "change"], max: 100, picture: false },
  };
  const PROBLEM_NAMES = ["Ana", "Luis", "Itzel", "Mateo", "Sofía", "Diego", "Xóchitl", "Pedro", "Lucía", "Tonatiuh"];
  // es: Spanish plural and grammatical gender (for "¿Cuántos/Cuántas…?").
  const PROBLEM_THINGS = [
    { pic: "🍎", en: "apples", es: "manzanas", g: "f" },
    { pic: "🌽", en: "ears of corn", es: "elotes", g: "m" },
    { pic: "🎈", en: "balloons", es: "globos", g: "m" },
    { pic: "🐟", en: "fish", es: "peces", g: "m" },
    { pic: "🍪", en: "cookies", es: "galletas", g: "f" },
    { pic: "⚽", en: "balls", es: "pelotas", g: "f" },
    { pic: "🌸", en: "flowers", es: "flores", g: "f" },
    { pic: "✏️", en: "pencils", es: "lápices", g: "m" },
    { pic: "🍓", en: "strawberries", es: "fresas", g: "f" },
    { pic: "🐥", en: "chicks", es: "pollitos", g: "m" },
  ];

  function genProblem(level, rng, index = 0) {
    const cfg = PROBLEM_LEVELS[level];
    const type = cfg.types[(index + Math.floor(rng() * cfg.types.length)) % cfg.types.length];
    const max = cfg.max;
    const lo = 2; // numbers in the text are at least 2, so the nouns are always plural
    const [name, name2] = shuffle(PROBLEM_NAMES, rng);
    const thing = pick(PROBLEM_THINGS, rng);
    let a, b, answer, near;
    if (type === "join" || type === "total") {
      a = randInt(lo, max - lo, rng); b = randInt(lo, max - a, rng);
      answer = a + b;
      near = [Math.abs(a - b), answer + 1, answer - 1, answer + 2];
    } else if (type === "separate" || type === "compare") {
      a = randInt(lo + 1, max, rng); b = randInt(lo, a - 1, rng);
      answer = a - b;
      near = [a + b, answer + 1, answer - 1, b];
    } else { // change unknown: a, then some more, now c (stored as b)
      a = randInt(lo, max - lo, rng); const c = randInt(a + 1, max, rng);
      b = c;
      answer = c - a;
      near = [a + c, answer + 1, answer - 1, c];
    }
    const q = { kind: "problem", type, key: `${type}${a},${b}`, name, name2, thing, a, b, answer: String(answer) };
    if (cfg.picture) q.picture = type === "separate" ? { groups: [a], crossed: b } : type === "compare" ? { groups: [a, b], compare: true } : type === "change" ? null : { groups: [a, b] };
    q.options = withDistractors(answer, shuffle(near, rng).concat([answer + 2, answer - 2, answer + 3]), 4, rng,
      (x) => Number.isInteger(x) && x >= 0).map(String);
    return q;
  }

  // Shapes. Levels 1–3: "Find the triangle" with more shapes and less typical drawings
  // (turned, stretched, irregular) as the level goes up. Level 4: count the sides.
  // Level 5: "Which shape has 5 sides?" with irregular polygons.
  const SHAPE_SIDES = { circle: 0, triangle: 3, square: 4, rectangle: 4, pentagon: 5, hexagon: 6, octagon: 8 };
  const SHAPE_LEVELS = {
    1: { shapes: ["circle", "triangle", "square", "rectangle"], options: 3, vary: false },
    2: { shapes: ["circle", "triangle", "square", "rectangle", "pentagon", "hexagon"], options: 4, vary: false },
    3: { shapes: ["triangle", "square", "rectangle", "pentagon", "hexagon", "octagon"], options: 4, vary: true },
    4: { mode: "sides", sides: [3, 4, 5, 6, 8], vary: true },
    5: { mode: "which", sides: [3, 4, 5, 6, 7, 8], options: 4, vary: true },
  };
  const SHAPE_COLORS = ["#ef476f", "#f8961e", "#06d6a0", "#118ab2", "#9b5de5", "#ffd166"];

  // Points of a polygon in a 100×100 box, centred on (50, 50).
  function polygon(name, sides, vary, rng) {
    const rot = vary ? rng() * Math.PI * 2 : 0;
    let pts;
    if (name === "square" || name === "rectangle") {
      const w = 34, hgt = name === "square" ? 34 : vary ? randInt(14, 22, rng) : 20;
      pts = [[-w, -hgt], [w, -hgt], [w, hgt], [-w, hgt]];
    } else {
      // Regular polygons (flat bottom) or, when varied, irregular ones with uneven corners.
      const base = Math.PI / 2 + Math.PI / sides;
      pts = Array.from({ length: sides }, (_, i) => {
        const ang = base + (i * 2 * Math.PI) / sides + (vary ? (rng() - 0.5) * (2.4 / sides) : 0);
        const r = vary ? 30 + rng() * 14 : 40;
        return [r * Math.cos(ang), r * Math.sin(ang)];
      });
    }
    return pts.map(([x, y]) => [
      +(50 + x * Math.cos(rot) - y * Math.sin(rot)).toFixed(1),
      +(50 + x * Math.sin(rot) + y * Math.cos(rot)).toFixed(1),
    ]);
  }

  function drawShape(name, vary, rng, color) {
    const sides = SHAPE_SIDES[name] ?? name; // a number = polygon with that many sides
    const fill = color || pick(SHAPE_COLORS, rng);
    if (sides === 0) {
      return { name, sides, fill, circle: true };
    }
    return { name, sides, fill, points: polygon(typeof name === "number" ? "poly" : name, sides, vary, rng) };
  }

  function genShape(level, rng) {
    const cfg = SHAPE_LEVELS[level];
    const colors = shuffle(SHAPE_COLORS, rng);
    if (cfg.mode === "sides") {
      const n = pick(cfg.sides, rng);
      const shape = drawShape(n, cfg.vary, rng, colors[0]);
      const options = withDistractors(n, shuffle(cfg.sides, rng), 4, rng).map(String);
      return { kind: "shape", mode: "sides", key: "s" + n, shape, options, answer: String(n) };
    }
    if (cfg.mode === "which") {
      const [n, ...rest] = shuffle(cfg.sides, rng);
      const shapes = [n, ...rest.slice(0, cfg.options - 1)].map((s, i) => drawShape(s, true, rng, colors[i]));
      const shuffled = shuffle(shapes, rng);
      return { kind: "shape", mode: "which", key: "w" + n, sides: n, shapes: shuffled, options: shuffled.map((x) => String(x.sides)), answer: String(n) };
    }
    const target = pick(cfg.shapes, rng);
    // A square is also a rectangle, so they never appear together.
    const names = [target];
    for (const s of shuffle(cfg.shapes, rng)) {
      if (names.length >= cfg.options) break;
      if (!names.includes(s) && !(SHAPE_SIDES[s] === 4 && names.some((x) => SHAPE_SIDES[x] === 4))) names.push(s);
    }
    const shapes = names.map((s, i) => drawShape(s, cfg.vary, rng, colors[i]));
    const shuffled = shuffle(shapes, rng);
    return {
      kind: "shape", mode: "find", key: "f" + target + shapes.map((x) => x.name).sort(), target,
      shapes: shuffled, options: shuffled.map((x) => x.name), answer: target,
    };
  }

  // Kokoma: five numbers on the corners of a pentagon. Exactly one of them is the sum of two
  // others (or, in Kokoma ×, the product); the child taps it. Wrong numbers are chosen to tempt:
  // the other operation on the same two numbers, and near misses, often bigger than the answer so
  // "pick the biggest" fails. The ranges are for the two numbers that are added or multiplied.
  const KOKOMA_LEVELS = {
    "+": { 1: [1, 5], 2: [1, 9], 3: [2, 15], 4: [5, 30], 5: [10, 60] },
    "×": { 1: [2, 5], 2: [2, 7], 3: [2, 10], 4: [3, 12], 5: [6, 15] },
  };
  const KOKOMA_OPS = { "+": (x, y) => x + y, "×": (x, y) => x * y };

  // Every [i, j, k] with numbers[i] op numbers[j] = numbers[k] (i < j, all different places).
  function kokomaTriples(numbers, op = "+") {
    const f = KOKOMA_OPS[op];
    const out = [];
    for (let i = 0; i < numbers.length; i++) {
      for (let j = i + 1; j < numbers.length; j++) {
        for (let k = 0; k < numbers.length; k++) {
          if (k !== i && k !== j && f(numbers[i], numbers[j]) === numbers[k]) out.push([i, j, k]);
        }
      }
    }
    return out;
  }

  function genKokoma(op, level, rng) {
    const [lo, hi] = KOKOMA_LEVELS[op][level];
    for (;;) {
      const a = randInt(lo, hi, rng), b = randInt(lo, hi, rng), c = KOKOMA_OPS[op](a, b);
      if (a === b) continue; // two equal numbers on the pentagon would be confusing
      const tempting = shuffle(op === "+"
        ? [Math.abs(a - b), c + 1, c - 1, c + 2, c + 10, c - 10, a + 10, b + 10, ...(a * b <= 2 * c + 10 ? [a * b] : [])]
        : [a + b, (a + 1) * b, a * (b + 1), (a - 1) * b, a * (b - 1), c + a, c + b, c + 1, c - 1], rng);
      const top = op === "+" ? 2 * hi : hi;
      const plain = shuffle(Array.from({ length: top - lo + 1 }, (_, k) => lo + k), rng);
      // Usually one tempting number and one plain one; sometimes two tempting numbers.
      const pools = rng() < 0.5 ? [tempting, plain] : [tempting, tempting];
      const numbers = [a, b, c];
      for (const pool of pools) {
        const x = pool.find((v) => v > (op === "+" ? 0 : 1) && !numbers.includes(v) && kokomaTriples([...numbers, v], op).length === 1);
        if (x !== undefined) numbers.push(x);
      }
      if (numbers.length < 5) continue;
      const ring = shuffle(numbers, rng);
      return {
        kind: "kokoma", op, key: op + numbers.slice().sort((x, y) => x - y).join(","),
        numbers: ring, parts: [a, b], options: ring.map(String), answer: String(c),
      };
    }
  }

  const QUIZZES = { problems: genProblem, shapes: genShape, equations: genEquation, count: genCount, compare: genCompare, pattern: genPattern, place: genPlace, clock: genClock,
    kokoma: (level, rng) => genKokoma("+", level, rng), kokomaMul: (level, rng) => genKokoma("×", level, rng) };

  // ------------------------------------------------------------------ sum grid
  //
  // A size×size grid of numbers in which every row and every column adds up to `target`.
  // Some cells are blank; the blanks are chosen so the puzzle can be solved step by step
  // (there is always a row or column with exactly one blank), which also makes the answer unique.

  const SUMGRID_LEVELS = {
    1: { size: 2, target: 10, blanks: 2 },
    2: { size: 3, target: 10, blanks: 3 },
    3: { size: 3, target: 10, blanks: 5 },
    4: { size: 3, target: 20, blanks: 5 },
    5: { size: 4, target: 20, blanks: 7 },
  };

  // Solve by repeatedly filling a row or column that has one blank. Returns true if it finishes.
  function solvableStepByStep(size, blanks) {
    const open = new Set(blanks.map(([r, c]) => r * size + c));
    let progress = true;
    while (open.size && progress) {
      progress = false;
      for (let line = 0; line < 2 * size && !progress; line++) {
        const cells = [];
        for (let k = 0; k < size; k++) {
          const id = line < size ? line * size + k : k * size + (line - size);
          if (open.has(id)) cells.push(id);
        }
        if (cells.length === 1) { open.delete(cells[0]); progress = true; }
      }
    }
    return open.size === 0;
  }

  function sumGrid(level, seed) {
    const rng = makeRng(seed);
    const { size, target, blanks: nBlanks } = SUMGRID_LEVELS[level];
    let cells;
    // A sum of `target` random permutation matrices has every row and column summing to target.
    // Prefer grids without zeros (more interesting); fall back after a few tries.
    for (let tries = 0; ; tries++) {
      cells = Array.from({ length: size }, () => new Array(size).fill(0));
      for (let k = 0; k < target; k++) {
        shuffle([...Array(size).keys()], rng).forEach((c, r) => cells[r][c]++);
      }
      if (cells.flat().every((v) => v > 0) || tries > 50) break;
    }
    const all = [];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) all.push([r, c]);
    let blanks;
    for (let tries = 0; tries < 1000; tries++) {
      blanks = shuffle(all, rng).slice(0, nBlanks);
      if (solvableStepByStep(size, blanks)) break;
    }
    blanks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return { kind: "sumgrid", size, target, cells, blanks };
  }

  // A round of distinct questions.
  function round(type, level, seed) {
    const rng = makeRng(seed);
    const out = [];
    const keys = new Set();
    for (let tries = 0; out.length < ROUND_SIZE && tries < 200; tries++) {
      const q = QUIZZES[type](level, rng, out.length);
      if (keys.has(q.key)) continue;
      keys.add(q.key);
      out.push(q);
    }
    return out;
  }

  root.LitMath = {
    ACTIVITIES: ["count", "compare", "equations", "problems", "facts", "sumgrid", "pattern", "place", "shapes", "clock", "kokoma", "kokomaMul"],
    QUIZZES: Object.keys(QUIZZES),
    DECK_INFO, deck, buildSession, grade, deckStats, stage, round, makeRng, sumGrid, solvableStepByStep, kokomaTriples,
    EQUATION_FORMS, SUMGRID_LEVELS, PROBLEM_LEVELS, SHAPE_SIDES, KOKOMA_LEVELS,
    constants: { DAY, BOX_DAYS, MASTERED_BOX, FLUENT_MS, SESSION_SIZE, MAX_NEW, ROUND_SIZE },
  };
})(typeof window !== "undefined" ? window : globalThis);
