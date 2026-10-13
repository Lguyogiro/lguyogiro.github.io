// UI: screens, exercise renderers, progress storage.
(function () {
  "use strict";

  const EX_ICONS = {
    pictures: "🖼️", listen: "👂", letters: "🔤", words: "🧩", builder: "🧱", spot: "🔍", breaks: "✂️", wordsearch: "🔎",
    facts: "⚡", equations: "➕", problems: "📝", sumgrid: "🧮", count: "🍎", compare: "⚖️", pattern: "🔢", place: "🧊",
    shapes: "🔷", clock: "🕒", kokoma: "⬠", kokomaMul: "✖️",
  };
  const LANG_ICONS = { en: "🦉", es: "🌵", nah: "🌽" };
  const app = document.getElementById("app");
  const titleEl = document.getElementById("title");
  const backBtn = document.getElementById("back");

  // ------------------------------------------------------------------ storage

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("lit." + key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("lit." + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    },
  };

  const state = {
    uiLang: store.get("uiLang", (navigator.language || "es").startsWith("en") ? "en" : "es"),
    section: null, // "reading" | "math"
    lang: null,
    exercise: null,
    player: null, // { id, name } (see players below)
    level: 1,
    rerender: null, // redraws the current screen (used when the interface language changes)
    voiceLang: store.get("voiceLang", null), // language for spoken math answers, or null
    data: {}, // lang → LitGen.prepare(...) result
  };

  function t(key, vars) {
    const pack = UI_STRINGS[state.uiLang] || {};
    let s = key.split(".").reduce((o, k) => (o ? o[k] : undefined), pack);
    if (s === undefined) s = key.split(".").reduce((o, k) => (o ? o[k] : undefined), UI_STRINGS.es);
    if (typeof s === "string" && vars) s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
    return s;
  }

  // ------------------------------------------------------------------ players
  //
  // Several children can share a device. Each player's stars, levels, Math Facts history and
  // recent texts are kept under their own keys ("player.<id>.progress", …). The guest (id "")
  // uses the plain keys, so progress saved before there were players belongs to the guest.
  // Interface language, sound and voice answers are settings for the whole device.

  const GUEST = { id: "", name: null };
  const listPlayers = () => [GUEST, ...store.get("players", [])]; // [{ id, name }]
  function loadPlayer() {
    const id = store.get("player", "");
    return listPlayers().find((p) => p.id === id) || GUEST;
  }
  const playerName = (p) => p.name || t("guest");
  const pkey = (key, id = state.player.id) => (id ? `player.${id}.${key}` : key);

  function selectPlayer(p) {
    state.player = p;
    store.set("player", p.id);
  }

  // Returns the new player, or null if the name is empty or already used.
  function addPlayer(name) {
    name = name.trim().replace(/\s+/g, " ").slice(0, 30);
    const taken = (p) => playerName(p).toLocaleLowerCase() === name.toLocaleLowerCase();
    if (!name || listPlayers().some(taken)) return null;
    const p = { id: Date.now().toString(36), name };
    store.set("players", [...store.get("players", []), p]);
    selectPlayer(p);
    return p;
  }

  // Removes a player and everything saved for them. The guest can't be removed.
  function removePlayer(p) {
    if (!p.id) return;
    store.set("players", store.get("players", []).filter((x) => x.id !== p.id));
    try {
      const prefix = `lit.player.${p.id}.`;
      Object.keys(localStorage).filter((k) => k.startsWith(prefix)).forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* private mode */ }
    if (state.player.id === p.id) selectPlayer(GUEST);
  }
  state.player = loadPlayer();

  // progress[lang][exercise][level] = { plays, best, stars }
  function getProgress(lang, ex, level) {
    const p = store.get(pkey("progress"), {});
    return (((p[lang] || {})[ex] || {})[level]) || { plays: 0, best: 0, stars: 0 };
  }
  function addProgress(lang, ex, level, stars) {
    const p = store.get(pkey("progress"), {});
    p[lang] = p[lang] || {};
    p[lang][ex] = p[lang][ex] || {};
    const cur = p[lang][ex][level] || { plays: 0, best: 0, stars: 0 };
    p[lang][ex][level] = { plays: cur.plays + 1, best: Math.max(cur.best, stars), stars: cur.stars + stars };
    store.set(pkey("progress"), p);
  }

  function totalStars(id = state.player.id) {
    let n = 0;
    for (const exs of Object.values(store.get(pkey("progress", id), {}))) {
      for (const levels of Object.values(exs)) for (const rec of Object.values(levels)) n += rec.stars || 0;
    }
    return n;
  }

  // Least-recently-used text ids per language, so texts don't repeat soon.
  function recentTexts(lang) { return store.get(pkey("recent." + lang), []); }
  function markUsed(lang, id) {
    const r = recentTexts(lang).filter((x) => x !== id);
    r.push(id);
    store.set(pkey("recent." + lang), r.slice(-200));
  }

  // ------------------------------------------------------------------ DOM helpers

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
  }

  // Each screen gets a token; timers and key handlers from an old screen check it and stop.
  let screenToken = 0;
  let cleanup = null;
  function screen(title, showBack, onBack) {
    screenToken++;
    if (cleanup) { cleanup(); cleanup = null; }
    LitASR.stop();
    LitTTS.stop();
    titleEl.textContent = title;
    backBtn.hidden = !showBack;
    backBtn.onclick = onBack;
    backBtn.setAttribute("aria-label", t("back"));
    app.replaceChildren();
    window.scrollTo(0, 0);
  }

  function dataFor(lang) {
    if (!state.data[lang]) state.data[lang] = LitGen.prepare(CORPUS[lang] || [], LANGS[lang]);
    return state.data[lang];
  }

  const starString = (n) => "★".repeat(n) + "☆".repeat(3 - n);

  // ------------------------------------------------------------------ screens

  const levelKey = () => pkey(state.section === "math" ? "level.math" : "level");
  function setLevel(n) { state.level = n; store.set(levelKey(), n); }

  function levelRow(redraw) {
    return h("div", { class: "levels", role: "radiogroup", "aria-label": t("level") },
      h("span", { class: "levels-label" }, t("level")),
      [1, 2, 3, 4, 5].map((n) => h("button", {
        class: "level-btn" + (n === state.level ? " active" : ""),
        role: "radio", "aria-checked": String(n === state.level),
        onclick: () => { setLevel(n); redraw(); },
      }, String(n))));
  }

  function card(icon, name, sub, onclick, opts = {}) {
    return h("button", { class: "card " + (opts.class || ""), disabled: opts.disabled, onclick },
      h("span", { class: "card-icon" }, icon),
      h("span", { class: "card-name" }, name),
      h("span", { class: "card-sub " + (opts.subClass || "") }, sub));
  }

  function enterSection(section) {
    state.section = section;
    state.level = store.get(levelKey(), 1);
  }

  function showHome() {
    state.section = null;
    state.lang = null;
    state.rerender = showHome;
    screen(t("appTitle"), false);
    app.append(
      h("div", { class: "hero" },
        h("p", { class: "hero-name", lang: "nah" }, "Matimomachtikan!"),
        h("p", { class: "hero-sub" }, h("span", { lang: "es" }, "¡A aprender!"), " · ", h("span", { lang: "en" }, "Let's Learn!")),
        h("div", { class: "hero-player" },
          h("button", { class: "player-chip", onclick: () => showAdmin(), "aria-label": t("changePlayer") }, "👤 ", playerName(state.player)),
          totalStars() > 0 && h("p", { class: "star-total" }, "⭐ ", t("totalStars", { n: totalStars() })))),
      h("div", { class: "card-grid sections" },
      card("📖", t("reading"), t("readingSub"), () => { enterSection("reading"); showLanguages(); }, { class: "section-card reading" }),
      card("🔢", t("math"), t("mathSub"), () => { enterSection("math"); showMath(); }, { class: "section-card math" })),
      h("div", { class: "admin-link" }, h("button", { class: "btn", onclick: () => showAdmin() }, "⚙️ ", t("admin"))));
  }

  // Admin: choose, add or remove a player, and clear the current player's stars.
  function showAdmin(opts = {}) {
    state.rerender = showAdmin;
    screen("⚙️ " + t("admin"), true, showHome);
    const cur = state.player;

    // Each player is a row: the name selects them, 🗑️ asks before removing them.
    function playerRow(p) {
      const row = h("div", { class: "player-row" });
      const normal = () => row.replaceChildren(
        h("button", {
          class: "player-btn" + (p.id === cur.id ? " active" : ""),
          role: "radio", "aria-checked": String(p.id === cur.id),
          onclick: () => { selectPlayer(p); showAdmin(); },
        }, h("span", { class: "player-name" }, "👤 ", playerName(p)), h("span", { class: "player-stars" }, "⭐ " + totalStars(p.id))),
        p.id && h("button", { class: "player-remove", "aria-label": t("removePlayer", { name: p.name }), onclick: confirm }, "🗑️"));
      const confirm = () => row.replaceChildren(h("div", { class: "player-confirm" },
        h("p", { class: "admin-msg" }, t("removePlayerConfirm", { name: p.name, n: totalStars(p.id) })),
        h("div", { class: "btn-row" },
          h("button", { class: "btn danger", onclick: () => { removePlayer(p); showAdmin(); } }, t("yesRemove")),
          h("button", { class: "btn", onclick: normal }, t("cancel")))));
      normal();
      return row;
    }
    const list = h("div", { class: "player-list", role: "radiogroup", "aria-label": t("players") }, listPlayers().map(playerRow));

    const input = h("input", { type: "text", class: "player-input", maxlength: 30, placeholder: t("playerName"), "aria-label": t("playerName") });
    const error = h("p", { class: "admin-msg bad", hidden: true });
    const form = h("form", {
      class: "player-form",
      onsubmit: (e) => {
        e.preventDefault();
        if (!input.value.trim()) return input.focus();
        if (addPlayer(input.value)) return showAdmin();
        error.textContent = t("nameTaken", { name: input.value.trim() });
        error.hidden = false;
      },
    }, input, h("button", { class: "btn primary", type: "submit" }, "＋ ", t("addPlayer")));

    // Clearing asks first, in the page, so a stray tap can't do it.
    const clearArea = h("div", { class: "clear-area" });
    function clearButton() {
      clearArea.replaceChildren(
        h("button", { class: "btn", disabled: totalStars() === 0, onclick: confirmClear }, "🗑️ ", t("clearStars")),
        opts.cleared && h("p", { class: "admin-msg ok" }, t("starsCleared")));
    }
    function confirmClear() {
      clearArea.replaceChildren(
        h("p", { class: "admin-msg" }, t("clearStarsConfirm", { name: playerName(cur), n: totalStars() })),
        h("div", { class: "btn-row" },
          h("button", { class: "btn danger", onclick: () => { store.set(pkey("progress"), {}); showAdmin({ cleared: true }); } }, t("yesClear")),
          h("button", { class: "btn", onclick: () => { opts = {}; clearButton(); } }, t("cancel"))));
    }
    clearButton();

    app.append(
      h("section", { class: "admin-section" }, h("h2", null, t("players")), h("p", { class: "admin-hint" }, t("changePlayer")), list, form, error),
      h("section", { class: "admin-section" }, h("h2", null, "⭐ ", t("starsOf", { name: playerName(cur) })), clearArea));
  }

  function showLanguages() {
    state.lang = null;
    state.rerender = showLanguages;
    screen(t("reading"), true, showHome);
    app.append(
      h("p", { class: "prompt" }, t("chooseLanguage")),
      h("div", { class: "card-grid langs" },
        Object.values(LANGS).map((L) => {
          const n = (CORPUS[L.code] || []).length;
          return card(LANG_ICONS[L.code] || "📖", L.name, n ? t("texts", { n }) : t("noTexts"),
            () => { state.lang = L.code; showExercises(); }, { class: "lang-card", disabled: n === 0 });
        })),
    );
  }

  function activityCards(progressKey, activities, onPick, subFor) {
    return h("div", { class: "card-grid" },
      activities.map((ex) => {
        const prog = getProgress(progressKey, ex, state.level);
        const stars = prog.plays ? starString(prog.best) : "\u00a0";
        return card(EX_ICONS[ex], t(`ex.${ex}.name`), subFor ? subFor(ex, stars) : stars,
          () => { state.exercise = ex; onPick(ex); }, { class: "ex-card", subClass: "stars" });
      }));
  }

  function showExercises() {
    state.rerender = showExercises;
    screen(LANGS[state.lang].name, true, showLanguages);
    app.append(
      levelRow(showExercises),
      h("p", { class: "prompt" }, t("chooseActivity")),
      activityCards(state.lang, readingActivities(), play),
    );
  }

  // Picture Words needs pictures with words in this language; Listen & Find needs a voice.
  function readingActivities() {
    const data = dataFor(state.lang);
    const rounds = LitGen.ROUNDS.filter((r) => LitGen.roundAvailable(r, { data, pictures: window.PICTURES })
      && (r !== "listen" || LitTTS.available(state.lang)));
    return [...rounds, ...LitGen.EXERCISES];
  }

  function showMath() {
    state.rerender = showMath;
    screen(t("math"), true, showHome);
    app.append(
      levelRow(showMath),
      voiceRow(),
      h("p", { class: "prompt" }, t("chooseActivity")),
      activityCards("math", LitMath.ACTIVITIES, playMath,
        (ex, stars) => (ex === "facts" ? h("span", { class: "deck-info" }, LitMath.DECK_INFO[state.level]) : stars)),
    );
  }

  // Choose the language for spoken answers. Only languages whose speech model is present
  // (see offline_utils/) are offered; the row stays hidden if there are none.
  function voiceRow() {
    const row = h("div", { class: "levels voice-row", hidden: true },
      h("span", { class: "levels-label" }, "🎤 " + t("voice")));
    const langs = Object.keys(LANGS).filter((l) => LANGS[l].asr);
    const token = screenToken;
    Promise.all(langs.map((l) => LitASR.available(l))).then((ok) => {
      const avail = langs.filter((l, i) => ok[i]);
      if (token !== screenToken || !avail.length) return;
      if (state.voiceLang && !avail.includes(state.voiceLang)) state.voiceLang = null;
      const btn = (code, label) => h("button", {
        class: "voice-btn" + (state.voiceLang === code ? " active" : ""),
        "aria-pressed": String(state.voiceLang === code),
        onclick: () => { state.voiceLang = code; store.set("voiceLang", code); showMath(); },
      }, label);
      row.append(btn(null, t("voiceOff")), ...avail.map((l) => btn(l, LANGS[l].name)));
      row.hidden = false;
    });
    return row;
  }

  // ------------------------------------------------------------------ play screen

  // Text for speech: drop emoji and symbols the voice would read out ("check mark").
  const speakable = (text) => text.replace(/[\p{Extended_Pictographic}\uFE0F✓⌫→]/gu, "").replace(/\s+/g, " ").trim();

  // Reads text aloud in a language. Returns null when there is no voice for that language.
  // hooks.before/after run around the speech (used to pause the microphone).
  function speakButton(getText, lang, opts = {}) {
    if (!LitTTS.available(lang)) return null;
    const label = opts.label || t("readAloud");
    const btn = h("button", { class: opts.class || "icon-btn small speak", title: label, "aria-label": label, onclick: () => say(getText(), lang, btn, opts) }, opts.content || "🔊");
    return btn;
  }

  async function say(text, lang, btn, hooks = {}) {
    if (!text || !LitTTS.available(lang)) return;
    if (hooks.before) hooks.before();
    if (btn) btn.classList.add("speaking");
    try {
      await LitTTS.speak(speakable(text), { lang });
    } catch (e) {
      console.warn("speech failed:", e);
    }
    if (btn) btn.classList.remove("speaking");
    if (hooks.after) hooks.after();
  }

  // Level badge, instructions with a 🔊 button that reads them aloud (for children who can't
  // read them yet), and a button for a new puzzle.
  function playHead(level, helpText, onNew, newLabel) {
    const help = h("p", { class: "help" }, helpText);
    return h("div", { class: "play-head" },
      h("span", { class: "badge" }, `${t("level")} ${level}`),
      speakButton(() => help.textContent, state.uiLang),
      help,
      h("button", { class: "icon-btn small", title: newLabel, "aria-label": newLabel, onclick: onNew }, "🔀"));
  }

  function play() {
    state.rerender = play;
    const { lang, exercise, level } = state;
    if (LitGen.ROUNDS.includes(exercise)) return playRound();
    if (exercise === "wordsearch") return playWordSearch();
    const puzzle = LitGen.generate(exercise, { data: dataFor(lang), level, recent: recentTexts(lang) });
    screen(`${EX_ICONS[exercise]} ${t(`ex.${exercise}.name`)}`, true, showExercises);
    app.append(playHead(level, t(`ex.${exercise}.help`), play, t("newText")));

    if (!puzzle) { app.append(h("p", { class: "empty" }, t("noPuzzle"))); return; }
    markUsed(lang, puzzle.textId);
    window.__puzzle = puzzle; // for browser tests

    const stage = h("section", { class: "stage", lang });
    const tray = h("section", { class: "tray", lang });
    const footer = h("footer", { class: "play-foot" });
    app.append(stage, tray, footer);

    // Hearing the sentence first helps early readers (it is a listening activity then, like a
    // dictation); the other exercises only offer "Listen" once solved.
    if (exercise === "builder" && LitTTS.available(lang)) {
      const text = puzzle.answer.join(" ") + (puzzle.ending || "");
      stage.append(speakButton(() => text, lang, { class: "btn listen-hint", content: "🔊 " + t("listen"), label: t("listen") }));
    }

    let firstScore = null;
    // Renderers may call onChange while being built, before `renderer` is assigned.
    let renderer = null;
    renderer = RENDERERS[exercise](puzzle, stage, tray, () => renderer && updateFooter());

    function updateFooter(result) {
      footer.replaceChildren();
      if (!result) {
        footer.append(h("button", { class: "btn primary", disabled: !renderer.ready(), onclick: doCheck }, t("check")));
        return;
      }
      if (result.done) {
        const stars = result.revealed ? 0 : firstScore >= 1 ? 3 : firstScore >= 0.7 ? 2 : 1;
        addProgress(lang, exercise, level, stars);
        const msg = result.revealed ? t("answerShown") : pickOne(t("great"));
        footer.append(
          h("div", { class: "result" + (result.revealed ? "" : " win") },
            !result.revealed && h("div", { class: "big-stars", "aria-label": `${stars}/3` }, starString(stars)),
            h("p", null, msg)),
          h("div", { class: "btn-row" },
            LitTTS.available(lang) && listenButton(puzzle, lang),
            stars === 3 && level < 5 && h("button", {
              class: "btn", onclick: () => { setLevel(level + 1); play(); },
            }, t("nextLevel") + " ⬆"),
            h("button", { class: "btn primary", onclick: play }, t("next") + " ▶")));
        if (!result.revealed) { celebrate(); LitSfx.win(); }
        return;
      }
      LitSfx.bad();
      footer.append(
        h("p", { class: "score-line" }, t("scoreLine", { c: result.correct, t: result.total }) + " — " + t("keepGoing")),
        h("div", { class: "btn-row" },
          h("button", { class: "btn", onclick: () => { renderer.reveal(); updateFooter({ done: true, revealed: true }); } }, t("showAnswer")),
          h("button", { class: "btn primary", onclick: () => { renderer.retry(); updateFooter(); } }, t("tryAgain"))));
    }

    function doCheck() {
      const r = renderer.check();
      const score = r.total ? Math.max(0, r.correct) / r.total : 0;
      if (firstScore === null) firstScore = score;
      updateFooter({ ...r, done: r.correct === r.total && !r.extra });
    }

    updateFooter();
  }

  // ------------------------------------------------------------------ math

  function playMath() {
    state.rerender = playMath;
    const { exercise, level } = state;
    if (exercise === "facts") playFacts();
    else if (exercise === "sumgrid") playSumGrid();
    else playQuiz(LitMath.round(exercise, level), { voice: true });
  }

  // Word search: tap the first and the last letter of a word, or drag from one to the other.
  // Words can be read aloud from the list. Stars count the wrong tries.
  // No yellow: that is the colour of the current selection.
  const WS_COLORS = ["#06d6a0", "#73b7ff", "#ff8fab", "#c9a7ff", "#ffad66", "#9be564", "#5ed8e6"];
  const WS_ARROWS = { "0,1": "→", "1,0": "↓", "1,1": "↘", "-1,1": "↗", "0,-1": "←", "-1,0": "↑", "-1,-1": "↖", "1,-1": "↙" };

  function playWordSearch() {
    const { lang, level } = state;
    const p = LitGen.generate("wordsearch", { data: dataFor(lang), level, recent: recentTexts(lang) });
    const view = mathScreen(play, { back: showExercises, progressKey: lang, help: t("ex.wordsearch.help") });
    if (!p) { view.stage.append(h("p", { class: "empty" }, t("noPuzzle"))); return; }
    markUsed(lang, p.textId);
    window.__puzzle = p; // for browser tests

    const n = p.size;
    const cells = p.grid.map((row, r) => row.map((ch, c) => h("span", { class: "ws-cell", "data-r": r, "data-c": c }, ch)));
    const grid = h("div", { class: "ws-grid", lang, style: `--n:${n}` }, cells.flat());
    const dirs = h("p", { class: "ws-dirs", "aria-hidden": "true" },
      LitGen.WORDSEARCH_LEVELS[level].dirs.map((d) => h("span", null, WS_ARROWS[d.join(",")])));
    view.stage.append(p.title && h("h2", { class: "text-title" }, p.title), dirs, grid);

    const canSay = LitTTS.available(lang);
    const chips = p.words.map((w) => h(canSay ? "button" : "span", {
      class: "ws-word", lang, onclick: canSay ? () => say(w.word, lang) : null,
    }, canSay && h("span", { class: "ws-speak", "aria-hidden": "true" }, "🔊"), w.word));
    const counter = h("p", { class: "counter" });
    view.tray.append(h("div", { class: "ws-words" }, chips), counter);

    const found = new Set();
    let misses = 0, start = null, downAt = null, dragging = false;

    const pos = (el) => (el && el.classList && el.classList.contains("ws-cell") ? { r: +el.dataset.r, c: +el.dataset.c } : null);
    const at = (e) => pos(document.elementFromPoint(e.clientX, e.clientY));
    // Cells from a to b, if they are in a row, a column or a diagonal.
    function line(a, b) {
      const rr = b.r - a.r, cc = b.c - a.c;
      if (rr !== 0 && cc !== 0 && Math.abs(rr) !== Math.abs(cc)) return null;
      const len = Math.max(Math.abs(rr), Math.abs(cc));
      return Array.from({ length: len + 1 }, (_, k) => ({ r: a.r + Math.sign(rr) * k, c: a.c + Math.sign(cc) * k }));
    }
    function mark(list, cls) {
      grid.querySelectorAll("." + cls).forEach((el) => el.classList.remove(cls));
      (list || []).forEach(({ r, c }) => cells[r][c].classList.add(cls));
    }

    function update() {
      counter.textContent = t("wordsFound", { m: found.size, n: p.words.length });
    }

    function color(list, k, cls) {
      const col = WS_COLORS[k % WS_COLORS.length];
      list.forEach(({ r, c }) => { cells[r][c].classList.add(cls); cells[r][c].style.setProperty("--c", col); });
      chips[k].classList.add(cls);
      chips[k].style.setProperty("--c", col);
    }

    function tryLine(a, b) {
      start = null;
      mark(null, "sel");
      mark(null, "start");
      const ln = line(a, b);
      if (!ln || ln.length < 2) return;
      const letters = ln.map(({ r, c }) => p.grid[r][c]);
      const fwd = letters.join(""), back = letters.reverse().join("");
      const k = p.words.findIndex((w, i) => !found.has(i) && (w.word === fwd || w.word === back));
      if (k < 0) {
        misses++;
        LitSfx.bad();
        mark(ln, "miss");
        const token = view.token;
        setTimeout(() => token === screenToken && mark(null, "miss"), 500);
        return;
      }
      found.add(k);
      color(ln, k, "found");
      LitSfx.ok();
      say(p.words[k].word, lang);
      update();
      if (found.size === p.words.length) finish();
    }

    grid.addEventListener("pointerdown", (e) => {
      const a = pos(e.target.closest(".ws-cell"));
      if (!a || found.size === p.words.length) return;
      e.preventDefault();
      downAt = a;
      dragging = true;
      mark(start ? line(start, a) || [a] : [a], "sel");
    });
    grid.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const b = at(e);
      if (b) mark(line(downAt, b) || [downAt], "sel");
    });
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      const b = at(e);
      if (b && (b.r !== downAt.r || b.c !== downAt.c)) tryLine(downAt, b); // dragged
      else if (start && b) tryLine(start, b); // second tap (the same cell again cancels)
      else if (b) { start = b; mark([b], "sel"); mark([b], "start"); } // first tap
      else mark(start ? [start] : null, "sel");
    };
    const onCancel = () => { dragging = false; mark(start ? [start] : null, "sel"); };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    cleanup = () => { window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel); };

    function finish() {
      const stars = misses <= 1 ? 3 : misses <= 3 ? 2 : 1;
      mathResult(view, stars, [], { extra: canSay && listenButton(p, lang) });
    }

    function reveal() {
      p.words.forEach((w, k) => { if (!found.has(k)) color(w.cells.map(([r, c]) => ({ r, c })), k, "shown"); });
      found.clear();
      p.words.forEach((_, k) => found.add(k));
      mark(null, "sel");
      addProgress(lang, "wordsearch", level, 0);
      view.footer.replaceChildren(h("div", { class: "result" }, h("p", null, t("answerShown"))),
        h("div", { class: "btn-row" }, canSay && listenButton(p, lang), h("button", { class: "btn primary", onclick: play }, t("next") + " ▶")));
    }

    view.footer.append(h("button", { class: "btn", onclick: reveal }, t("showAnswer")));
    update();
  }

  // Reading activities played as quick rounds (Picture Words, Listen & Find).
  function playRound() {
    const { lang, exercise, level } = state;
    const questions = LitGen.round(exercise, { data: dataFor(lang), pictures: window.PICTURES, level });
    const help = exercise === "pictures" && questions.length ? t(`pictureMode.${questions[0].mode}`) : t(`ex.${exercise}.help`);
    playQuiz(questions, { back: showExercises, progressKey: lang, replay: play, help, wordLang: lang });
  }

  // Screen for the quick-round activities. Math by default; reading rounds pass their own
  // back screen, progress key (the language) and replay function.
  function mathScreen(onNew, opts = {}) {
    const { exercise, level } = state;
    screen(`${EX_ICONS[exercise]} ${t(`ex.${exercise}.name`)}`, true, opts.back || showMath);
    const help = opts.help || t(`ex.${exercise}.help`) +
      (state.voiceLang && (exercise === "facts" || VOICE_VALUES[exercise]) ? " " + t("helpVoice") : "");
    app.append(playHead(level, help, onNew, t("next")));
    const stage = h("section", { class: "stage math-stage" });
    const tray = h("section", { class: "tray" });
    const footer = h("footer", { class: "play-foot" });
    app.append(stage, tray, footer);
    return { stage, tray, footer, token: screenToken, progressKey: opts.progressKey || "math", replay: onNew };
  }

  // Result panel shared by the math activities and the reading rounds.
  function mathResult(view, stars, lines, opts = {}) {
    const { exercise, level } = state;
    addProgress(view.progressKey, exercise, level, stars);
    view.tray.replaceChildren();
    view.footer.replaceChildren(
      h("div", { class: "result win" },
        h("div", { class: "big-stars", "aria-label": `${stars}/3` }, starString(stars)),
        h("p", null, pickOne(t("great"))),
        lines.map((l) => h("div", { class: "result-line" }, l))),
      h("div", { class: "btn-row" },
        opts.extra,
        (opts.canLevelUp ?? stars === 3) && level < 5 &&
          h("button", { class: "btn", onclick: () => { setLevel(level + 1); view.replay(); } }, t("nextLevel") + " ⬆"),
        h("button", { class: "btn primary", onclick: view.replay }, t("next") + " ▶")));
    celebrate();
    LitSfx.win();
  }

  // Microphone button for spoken numbers. After the first tap it listens again by itself on
  // every new question (autoStart), so a child can answer a whole round hands-free.
  // onResult(result) returns true if the answer was used; otherwise it listens once more.
  const MIN_CONFIDENCE = 0.5;
  const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

  function micControl({ values, onResult, token }) {
    const lang = state.voiceLang;
    const label = h("span", { class: "mic-label" }, t("micIdle"));
    const btn = h("button", { class: "mic idle", "aria-label": t("micIdle") }, h("span", { class: "mic-icon" }, "🎤"), label);
    let handsFree = false, listening = false, retries = 0;

    function setState(st) {
      btn.className = "mic " + st;
      if (st === "listening") label.textContent = t("listening");
      else if (st === "loading") label.textContent = t("micLoading");
      else if (st === "thinking") label.textContent = "…";
    }

    async function go() {
      if (listening) { LitASR.cancel(); return; } // tap again to stop
      listening = true;
      let r;
      try {
        r = await LitASR.listen({
          lang, values: values(), onState: setState,
          onLevel: (v) => btn.style.setProperty("--level", v.toFixed(2)),
        });
      } catch (e) {
        console.warn("speech recognition failed:", e);
        listening = false;
        setState("error");
        label.textContent = t("micError");
        return;
      }
      listening = false;
      if (token !== screenToken) return;
      setState("idle");
      window.__heard = r; // for browser tests
      if (!r) { label.textContent = t("micIdle"); return; } // nothing said
      const understood = r.value !== null && r.confidence >= MIN_CONFIDENCE;
      label.textContent = understood ? t("heard", { x: r.value }) : t("notUnderstood");
      const used = understood && onResult(r);
      if (!used && handsFree && retries++ < 1) go();
    }

    btn.addEventListener("click", () => { handsFree = true; retries = 0; go(); });
    return {
      el: btn,
      autoStart() { if (handsFree && !listening) { retries = 0; go(); } },
      cancel() { if (listening) LitASR.cancel(); },
    };
  }

  const VOICE_VALUES = { equations: () => range(0, 200), problems: () => range(0, 200), count: () => range(0, 30), pattern: () => range(0, 1000), place: () => range(0, 1000), kokoma: () => range(0, 300), kokomaMul: () => range(0, 300) };

  const wait = (ms, token) => new Promise((resolve) => setTimeout(() => token === screenToken && resolve(), ms));

  // A round of questions. Multiple choice: a wrong choice is crossed out and the child tries
  // again. Build questions (q.pieces): tap syllables or letters in order; a wrong word keeps
  // its correct beginning and returns the rest of the pieces.
  //   opts.voice     spoken number answers (math)
  //   opts.wordLang  language of q.word, which is read aloud (reading rounds)
  function playQuiz(questions, opts = {}) {
    const { exercise } = state;
    const replay = opts.replay || playMath;
    const view = mathScreen(replay, opts);
    if (!questions.length) { view.stage.append(h("p", { class: "empty" }, t("noPuzzle"))); return; }
    const dots = h("div", { class: "quiz-dots", "aria-hidden": "true" }, questions.map(() => h("span")));
    view.stage.before(dots);
    let i = 0, firstTry = 0, missed = false;
    // Spoken answers for the activities whose answers are numbers.
    const mic = opts.voice && state.voiceLang && VOICE_VALUES[exercise] && micControl({
      values: VOICE_VALUES[exercise],
      token: view.token,
      onResult(r) {
        const btn = [...view.tray.querySelectorAll(".options .tile")].find((b) => b.textContent === String(r.value));
        if (!btn || btn.disabled) return false;
        choose(btn, btn.textContent);
        return true;
      },
    });
    // Speech must not be heard by the microphone, so it pauses while something is read aloud.
    const micHooks = { before: () => mic && mic.cancel(), after: () => mic && mic.autoStart() };
    const ctx = {
      sayWord: (word) => opts.wordLang && say(word, opts.wordLang),
      canSayWord: !!opts.wordLang && LitTTS.available(opts.wordLang),
      speakUi: (text) => speakButton(() => text, state.uiLang, micHooks),
    };

    function show() {
      const q = questions[i];
      window.__current = q; // for browser tests
      [...dots.children].forEach((d, j) => d.classList.toggle("current", j === i));
      dots.setAttribute("aria-label", t("question", { i: i + 1, n: questions.length }));
      view.stage.replaceChildren(MATH_VIEWS[q.kind](q, ctx));
      if (q.pieces) showBuild(q);
      else {
        const content = OPTION_VIEWS[q.kind] || ((q, o) => o);
        view.tray.replaceChildren(h("div", { class: `tiles options ${q.kind} ${q.mode || ""}` },
          q.options.map((o, k) => h("button", { class: "tile", "aria-label": q.kind === "shape" && q.mode !== "sides" ? String(k + 1) : o, onclick: (e) => choose(e.currentTarget, o) }, content(q, o, k)))));
      }
      if (mic) { view.tray.append(mic.el); mic.autoStart(); }
      // Say the word when hearing it is part of the task, and the shape question for pre-readers.
      if (q.kind === "listen" || (q.kind === "picture" && q.mode !== "choose")) ctx.sayWord(q.word);
      if (q.kind === "shape") say(shapePrompt(q), state.uiLang);
    }

    function showBuild(q) {
      const placed = []; // { text, tile, locked }
      const slots = h("div", { class: "build-slots " + q.mode, style: `--n:${q.answerPieces.length}` });
      const pool = h("div", { class: "tiles build " + q.mode });
      view.stage.append(slots);
      view.tray.replaceChildren(pool);
      const tiles = q.pieces.map((text) => h("button", { class: "tile", onclick: (e) => put(e.currentTarget, text) }, text));
      pool.append(...tiles);

      function render(wrong) {
        slots.replaceChildren(...q.answerPieces.map((_, k) => {
          const pc = placed[k];
          return h("button", {
            class: "build-slot" + (pc ? " filled" : "") + (pc && pc.locked ? " ok" : "") + (wrong && pc && !pc.locked ? " wrong" : ""),
            disabled: !pc || pc.locked, "aria-label": pc ? pc.text : "?",
            onclick: () => { placed.splice(k, 1)[0].tile.classList.remove("used"); render(); },
          }, pc ? pc.text : "");
        }));
      }

      function put(tile, text) {
        if (tile.classList.contains("used") || placed.length >= q.answerPieces.length) return;
        tile.classList.add("used");
        placed.push({ text, tile, locked: false });
        render();
        if (placed.length < q.answerPieces.length) return;
        if (placed.every((pc, k) => pc.text === q.answerPieces[k])) { placed.forEach((pc) => (pc.locked = true)); render(); succeed(); return; }
        // Wrong: keep the correct beginning, give the rest back.
        missed = true;
        LitSfx.bad();
        const keep = placed.findIndex((pc, k) => pc.text !== q.answerPieces[k]);
        placed.slice(0, keep).forEach((pc) => (pc.locked = true));
        render(true);
        const token = view.token;
        setTimeout(() => {
          if (token !== screenToken) return;
          placed.splice(keep).forEach((pc) => pc.tile.classList.remove("used"));
          render();
        }, 800);
      }
      render();
    }

    function choose(btn, option) {
      const q = questions[i];
      if (option !== q.answer) {
        if (mic) mic.cancel();
        btn.classList.add("wrong");
        btn.disabled = true;
        missed = true;
        LitSfx.bad();
        // Give the "wrong" sound time to end before listening again.
        if (mic) wait(400, view.token).then(() => mic.autoStart());
        return;
      }
      btn.classList.add("ok");
      succeed();
    }

    async function succeed() {
      const q = questions[i];
      if (mic) mic.cancel();
      LitSfx.ok();
      view.tray.querySelectorAll("button").forEach((b) => (b.disabled = true));
      const slot = view.stage.querySelector(".slot");
      if (slot) { slot.textContent = slot.dataset.fill || q.answer; slot.classList.add("filled"); }
      // Picture Words: show and say the word once it is found.
      const card = view.stage.querySelector(".pic-card");
      if (card && q.word && !card.querySelector(".pic-caption")) card.append(h("span", { class: "pic-caption" }, q.word));
      if (q.word && q.kind === "picture") ctx.sayWord(q.word);
      if (!missed) firstTry++;
      dots.children[i].classList.add(missed ? "miss" : "ok");
      await wait(q.word && ctx.canSayWord ? 1500 : 900, view.token);
      i++;
      missed = false;
      if (i < questions.length) show();
      else {
        if (mic) mic.el.remove();
        dots.querySelectorAll(".current").forEach((d) => d.classList.remove("current"));
        const n = questions.length;
        mathResult(view, firstTry === n ? 3 : firstTry >= n - 1 ? 2 : 1, [t("firstTry", { c: firstTry, t: n })]);
      }
    }
    show();
  }

  const FACT_STAGES = ["new", "learning", "known", "mastered"];
  const stageLabel = (st) => t("facts" + st[0].toUpperCase() + st.slice(1));

  // Flashcards with spaced repetition (see LitMath.buildSession / grade).
  function playFacts() {
    const { level } = state;
    const records = store.get(pkey("srs"), {});
    const queue = LitMath.buildSession(level, records, Date.now());
    const view = mathScreen(playMath);
    const total = queue.length;
    const missedIds = new Set();
    const requeued = {};
    let value = "", startedAt = 0, busy = false, current = null;

    const answerEl = h("span", { class: "fact-answer" });
    const counter = h("div", { class: "quiz-count" });
    view.stage.before(counter);
    const maxAnswer = Math.max(...LitMath.deck(level).map((f) => f.answer));
    const mic = state.voiceLang && micControl({
      values: () => range(0, maxAnswer),
      token: view.token,
      onResult(r) {
        if (busy) return false;
        value = String(r.value);
        answerEl.textContent = value;
        // For fluency, time how long the child took to start answering.
        submit(Math.max(0, r.speechStart - startedAt));
        return true;
      },
    });

    function show() {
      current = queue[0];
      window.__current = current; // for browser tests
      value = "";
      answerEl.textContent = "?";
      answerEl.className = "fact-answer";
      counter.textContent = t("question", { i: total - queue.length + 1, n: total });
      view.stage.replaceChildren(h("div", { class: "flashcard" },
        h("span", null, `${current.a} ${current.op} ${current.b} =`), answerEl));
      startedAt = performance.now();
      if (mic) mic.autoStart();
    }

    function press(key) {
      if (busy) return;
      if (key === "⌫") value = value.slice(0, -1);
      else if (key === "✓") { if (value) submit(); return; }
      else if (value.length < 3) value += key;
      answerEl.textContent = value || "?";
    }

    async function submit(msToAnswer) {
      busy = true;
      if (mic) mic.cancel();
      const f = current;
      const ms = msToAnswer ?? performance.now() - startedAt;
      const correct = Number(value) === f.answer;
      records[f.id] = LitMath.grade(records[f.id], correct, ms, Date.now());
      store.set(pkey("srs"), records);
      queue.shift();
      if (correct) {
        LitSfx.ok();
        answerEl.classList.add("ok");
        await wait(500, view.token);
      } else {
        missedIds.add(f.id);
        LitSfx.bad();
        answerEl.classList.add("wrong");
        answerEl.replaceChildren(h("s", null, value), " ", h("span", { class: "fix" }, String(f.answer)));
        // Ask again a few cards later (at most twice per session).
        requeued[f.id] = (requeued[f.id] || 0) + 1;
        if (requeued[f.id] <= 2) queue.splice(Math.min(queue.length, 3), 0, f);
        await wait(1800, view.token);
      }
      busy = false;
      if (queue.length) show(); else finish();
    }

    function finish() {
      counter.remove();
      if (mic) mic.el.remove();
      const right = total - missedIds.size;
      const stats = LitMath.deckStats(level, records);
      const chart = factsChart(level, records);
      chart.hidden = true;
      view.stage.replaceChildren(statsBar(stats), chart);
      mathResult(view, right === total ? 3 : right >= total * 0.7 ? 2 : 1,
        [t("firstTry", { c: right, t: total })], {
          canLevelUp: stats.mastered / stats.total >= 0.8,
          extra: h("button", { class: "btn", onclick: () => { chart.hidden = !chart.hidden; } }, "📊 " + t("factsChart")),
        });
    }

    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"];
    if (mic) view.tray.append(mic.el);
    view.tray.append(h("div", { class: "keypad" },
      keys.map((k) => h("button", { class: "tile key" + (k === "✓" ? " enter" : k === "⌫" ? " erase" : ""), onclick: () => press(k) }, k))));

    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter") press("✓");
    };
    document.addEventListener("keydown", onKey);
    cleanup = () => document.removeEventListener("keydown", onKey);
    show();
  }

  // Sum grid: fill the blanks so that every row and column adds up to the target.
  function playSumGrid() {
    const { level } = state;
    const p = LitMath.sumGrid(level);
    window.__current = p; // for browser tests
    const view = mathScreen(playMath);
    const n = p.size;
    const help = view.stage.parentElement.querySelector(".help");
    help.textContent = t("ex.sumgrid.help", { n: p.target });

    const blanks = p.blanks.map(([r, c]) => ({ r, c, answer: p.cells[r][c], value: "", locked: false, el: null }));
    let active = null, firstScore = null;
    const grid = h("div", { class: "sumgrid", role: "grid" });
    grid.style.setProperty("--n", n + 1);
    const rowHeads = [], colHeads = [];
    grid.append(h("span", { class: "sg-corner", "aria-hidden": "true" }, "+"));
    for (let c = 0; c < n; c++) grid.append(colHeads[c] = h("span", { class: "sg-head col" }, String(p.target)));
    for (let r = 0; r < n; r++) {
      grid.append(rowHeads[r] = h("span", { class: "sg-head row" }, String(p.target)));
      for (let c = 0; c < n; c++) {
        const b = blanks.find((x) => x.r === r && x.c === c);
        if (!b) { grid.append(h("span", { class: "sg-cell given" }, String(p.cells[r][c]))); continue; }
        b.el = h("button", { class: "sg-cell blank", "aria-label": "?", onclick: () => select(b) }, "");
        grid.append(b.el);
      }
    }
    view.stage.append(grid);

    const valueAt = (r, c) => {
      const b = blanks.find((x) => x.r === r && x.c === c);
      return b ? (b.value === "" ? null : Number(b.value)) : p.cells[r][c];
    };
    // A row/column header turns green when its line is full and adds up, orange when full but wrong.
    function updateHeads() {
      for (let k = 0; k < n; k++) {
        for (const [head, vals] of [[rowHeads[k], [...Array(n).keys()].map((c) => valueAt(k, c))],
          [colHeads[k], [...Array(n).keys()].map((r) => valueAt(r, k))]]) {
          const full = vals.every((v) => v !== null);
          const sum = vals.reduce((a, v) => a + (v || 0), 0);
          head.classList.toggle("ok", full && sum === p.target);
          head.classList.toggle("bad", full && sum !== p.target);
          head.title = full ? `= ${sum}` : "";
        }
      }
    }

    function select(b) {
      if (!b || b.locked) return;
      active = b;
      blanks.forEach((x) => x.el.classList.toggle("active", x === b));
    }
    function selectNext() {
      const i = blanks.indexOf(active);
      for (let k = 1; k <= blanks.length; k++) {
        const b = blanks[(i + k) % blanks.length];
        if (!b.locked && b.value === "") return select(b);
      }
      for (let k = 1; k <= blanks.length; k++) {
        const b = blanks[(i + k) % blanks.length];
        if (!b.locked) return select(b);
      }
    }
    function press(key) {
      if (!active) return;
      if (key === "⌫") active.value = active.value.slice(0, -1);
      else if (key === "→") return selectNext();
      else active.value = (active.value.length >= 2 ? "" : active.value) + key;
      active.el.textContent = active.value;
      active.el.classList.remove("wrong");
      updateHeads();
      updateFooter();
    }

    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "→"];
    view.tray.append(h("div", { class: "keypad" },
      keys.map((k) => h("button", { class: "tile key" + (k === "⌫" ? " erase" : k === "→" ? " next" : ""), onclick: () => press(k) }, k))));
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter" || e.key === "Tab" || e.key === "ArrowRight") { e.preventDefault(); press("→"); }
    };
    document.addEventListener("keydown", onKey);
    cleanup = () => document.removeEventListener("keydown", onKey);

    function updateFooter(result) {
      view.footer.replaceChildren();
      if (!result) {
        view.footer.append(h("button", { class: "btn primary", disabled: !blanks.every((b) => b.value !== ""), onclick: check }, t("check")));
        return;
      }
      view.footer.append(
        h("p", { class: "score-line" }, t("scoreLine", { c: result.correct, t: blanks.length }) + " — " + t("keepGoing")),
        h("div", { class: "btn-row" },
          h("button", { class: "btn", onclick: reveal }, t("showAnswer")),
          h("button", { class: "btn primary", onclick: retry }, t("tryAgain"))));
    }

    function check() {
      let correct = 0;
      for (const b of blanks) {
        const ok = Number(b.value) === b.answer;
        b.el.classList.toggle("ok", ok);
        b.el.classList.toggle("wrong", !ok);
        if (ok) { b.locked = true; b.el.disabled = true; correct++; }
      }
      blanks.forEach((b) => b.el.classList.remove("active"));
      active = null;
      if (firstScore === null) firstScore = correct / blanks.length;
      if (correct === blanks.length) {
        cleanup && cleanup();
        cleanup = null;
        mathResult(view, firstScore === 1 ? 3 : firstScore >= 0.7 ? 2 : 1, [t("firstTry", { c: Math.round(firstScore * blanks.length), t: blanks.length })]);
      } else { LitSfx.bad(); updateFooter({ correct }); }
    }

    function retry() {
      for (const b of blanks) if (!b.locked) { b.value = ""; b.el.textContent = ""; b.el.classList.remove("wrong"); }
      updateHeads();
      selectNext();
      updateFooter();
    }

    function reveal() {
      for (const b of blanks) {
        b.el.textContent = String(b.answer);
        b.el.classList.remove("wrong", "active");
        if (!b.locked) b.el.classList.add("shown");
        b.el.disabled = true;
        b.value = String(b.answer);
      }
      updateHeads();
      addProgress("math", "sumgrid", level, 0);
      view.tray.replaceChildren();
      view.footer.replaceChildren(h("div", { class: "result" }, h("p", null, t("answerShown"))),
        h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: playMath }, t("next") + " ▶")));
    }

    select(blanks[0]);
    updateFooter();
  }

  function statsBar(stats) {
    return h("div", { class: "facts-stats" },
      h("div", { class: "facts-bar" }, FACT_STAGES.map((st) => {
        const seg = h("span", { class: "seg " + st });
        seg.style.flexGrow = stats[st];
        return seg;
      })),
      h("div", { class: "facts-legend" }, FACT_STAGES.map((st) =>
        h("span", { class: "legend " + st }, h("i"), `${stageLabel(st)}: ${stats[st]}`))));
  }

  function factsChart(level, records) {
    return h("div", { class: "facts-chart" }, LitMath.deck(level).map((f) =>
      h("span", { class: "fact-chip " + LitMath.stage(records[f.id]), title: stageLabel(LitMath.stage(records[f.id])) },
        `${f.a}${f.op}${f.b}`)));
  }

  // Pictures for each quiz question kind.
  const SVG_NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    for (const c of children.flat()) if (c) el.append(c);
    return el;
  }

  function thingGroup(n, thing, crossed = 0) {
    return h("div", { class: "thing-group" }, Array.from({ length: n }, (_, k) =>
      h("span", { class: "thing" + (k >= n - crossed ? " crossed" : "") }, thing)));
  }

  function tenFrame(filled, thing) {
    return h("div", { class: "ten-frame" }, Array.from({ length: 10 }, (_, k) => h("span", { class: "cell" }, k < filled ? thing : "")));
  }

  function shapeSvg(sh, cls) {
    return svg("svg", { viewBox: "0 0 100 100", class: "shape " + (cls || ""), "aria-hidden": "true" },
      sh.circle ? svg("circle", { cx: 50, cy: 50, r: 40, fill: sh.fill })
        : svg("polygon", { points: sh.points.map((pt) => pt.join(",")).join(" "), fill: sh.fill }));
  }

  function shapePrompt(q) {
    if (q.mode === "find") return t("shapePrompt.find", { shape: t(`shapes.${q.target}`) });
    if (q.mode === "which") return t("shapePrompt.which", { n: q.sides });
    return t("shapePrompt.sides");
  }

  // A question line with a 🔊 button that reads it in the interface language.
  const promptLine = (text, ctx, cls = "") => h("div", { class: "q-prompt " + cls }, ctx.speakUi(text), h("p", null, text));

  function problemText(q) {
    const thing = q.thing;
    return t(`problem.${q.type}`, {
      name: q.name, name2: q.name2, a: q.a, b: q.b, things: thing[state.uiLang] || thing.es,
      Cuantos: thing.g === "f" ? "Cuántas" : "Cuántos", algunos: thing.g === "f" ? "algunas" : "algunos",
    });
  }

  // What goes inside the answer buttons, when it isn't just the option text.
  const OPTION_VIEWS = {
    shape: (q, o, k) => (q.mode === "sides" ? o : shapeSvg(q.shapes[k])),
    compare: (q, o) => [h("span", { class: "cmp-sym" }, o), h("span", { class: "cmp-word" }, t(`cmp.${o}`))],
  };

  const MATH_VIEWS = {
    picture(q, ctx) {
      const card = h(ctx.canSayWord ? "button" : "div", {
        class: "pic-card", "aria-label": ctx.canSayWord ? t("listenAgain") : null,
        onclick: ctx.canSayWord ? () => ctx.sayWord(q.word) : null,
      }, h("span", { class: "pic", "aria-hidden": "true" }, q.pic), ctx.canSayWord && h("span", { class: "pic-speak", "aria-hidden": "true" }, "🔊"));
      const parts = [card];
      if (q.mode === "first") {
        const [first, ...rest] = LitGen.chars(q.word);
        parts.push(h("div", { class: "pic-word" }, h("span", { class: "slot", "data-fill": first }, "?"), rest.join("")));
      }
      return h("div", { class: "pic-view" }, parts);
    },

    listen(q, ctx) {
      return h("div", { class: "listen-view" },
        h("button", { class: "big-speak", "aria-label": t("listenAgain"), onclick: () => ctx.sayWord(q.word) }, "🔊"),
        h("p", { class: "listen-label" }, t("listenAgain")));
    },

    problem(q, ctx) {
      const parts = [];
      const pic = q.thing.pic;
      if (q.picture && q.type === "compare") {
        // One row each, lined up, so the extra ones stand out.
        const cols = Math.max(q.a, q.b);
        const row = (name, n) => h("div", { class: "cmp-row" }, h("span", { class: "cmp-name" }, name),
          h("span", { class: "cmp-things", style: `--cols:${cols}` }, Array.from({ length: n }, () => h("span", { class: "thing" }, pic))));
        parts.push(h("div", { class: "cmp-rows" }, row(q.name, q.a), row(q.name2, q.b)));
      } else if (q.picture && q.type === "separate") {
        parts.push(h("div", { class: "eq-picture" }, thingGroup(q.a, pic, q.b)));
      } else if (q.picture) {
        const group = (name, n) => h("div", { class: "named-group" }, thingGroup(n, pic), q.type === "total" && h("span", { class: "cmp-name" }, name));
        parts.push(h("div", { class: "eq-picture" }, group(q.name, q.a), h("span", { class: "op" }, q.type === "join" ? "+" : "\u00a0"), group(q.name2, q.b)));
      }
      parts.push(promptLine(problemText(q), ctx, "problem-text"));
      return h("div", { class: "eq-view" }, parts);
    },

    shape(q, ctx) {
      return h("div", { class: "shape-view" }, q.mode === "sides" && shapeSvg(q.shape, "big"), promptLine(shapePrompt(q), ctx));
    },

    // The five numbers are the answer buttons, laid out as a pentagon by the CSS. Once found,
    // the sum (or product) is shown.
    kokoma(q, ctx) {
      const [a, b] = q.parts;
      return h("div", { class: "eq-view" }, promptLine(t(`kokomaPrompt.${q.op}`), ctx),
        h("div", { class: "eq-line" }, h("span", { class: "slot", "data-fill": `${a} ${q.op} ${b} = ${q.answer}` }, `? ${q.op} ? = ?`)));
    },

    equation(q) {
      const parts = [];
      if (q.picture) {
        const { groups, thing, crossed } = q.picture;
        parts.push(h("div", { class: "eq-picture" }, groups.length === 2
          ? [thingGroup(groups[0], thing), h("span", { class: "op" }, "+"), thingGroup(groups[1], thing)]
          : thingGroup(groups[0], thing, crossed)));
      }
      if (q.frame) parts.push(h("div", { class: "frames" }, tenFrame(q.frame.filled, q.frame.thing)));
      if (q.tokens) {
        parts.push(h("div", { class: "eq-line" }, q.tokens.map((tk) => (tk === null
          ? h("span", { class: "slot" }, "?")
          : h("span", { class: typeof tk === "string" ? "op" : "num" }, String(tk))))));
      }
      if (q.bond) {
        const circle = (v, cls) => h("span", { class: `bond-circle ${cls}` + (v === null ? " slot" : "") }, v === null ? "?" : String(v));
        parts.push(h("div", { class: "bond" },
          svg("svg", { class: "bond-lines", viewBox: "0 0 100 60", preserveAspectRatio: "none", "aria-hidden": "true" },
            svg("line", { x1: 50, y1: 14, x2: 22, y2: 46 }), svg("line", { x1: 50, y1: 14, x2: 78, y2: 46 })),
          circle(q.bond.whole, "whole"), circle(q.bond.parts[0], "left"), circle(q.bond.parts[1], "right")));
      }
      if (q.column) {
        parts.push(h("div", { class: "column-sum" },
          h("span"), h("span", { class: "num" }, String(q.column.top)),
          h("span", { class: "op" }, q.column.op), h("span", { class: "num" }, String(q.column.bottom)),
          h("span", { class: "rule" }),
          h("span"), h("span", { class: "slot" }, "?")));
      }
      return h("div", { class: "eq-view" }, parts);
    },

    count(q) {
      const thing = () => h("span", { class: "thing" }, q.thing);
      if (q.layout === "row") return h("div", { class: "count-row" }, Array.from({ length: q.n }, thing));
      if (q.layout === "frames") {
        const frames = [];
        for (let start = 0; start < q.n; start += 10) {
          frames.push(h("div", { class: "ten-frame" }, Array.from({ length: 10 }, (_, k) =>
            h("span", { class: "cell" }, start + k < q.n ? q.thing : ""))));
        }
        return h("div", { class: "frames" }, frames);
      }
      const box = h("div", { class: "count-scatter" });
      for (const p of q.positions) {
        const el = thing();
        el.style.left = p.x * 100 + "%";
        el.style.top = p.y * 100 + "%";
        box.append(el);
      }
      return box;
    },

    compare(q) {
      const side = (label, value) => h("div", { class: "cmp-side" },
        h("span", { class: "cmp-num" }, label),
        q.dots && h("span", { class: "dots" }, Array.from({ length: value }, () => h("i"))));
      return h("div", { class: "compare" }, side(q.left, q.lv), h("span", { class: "slot" }, "?"), side(q.right, q.rv));
    },

    pattern(q) {
      return h("div", { class: "pattern" }, q.seq.map((v) =>
        v === null ? h("span", { class: "num slot" }, "?") : h("span", { class: "num" }, String(v))));
    },

    place(q) {
      const flat = () => svg("svg", { viewBox: "0 0 10 10", class: "block hundred" },
        svg("rect", { width: 10, height: 10 }),
        svg("path", { d: Array.from({ length: 9 }, (_, i) => `M${i + 1} 0V10M0 ${i + 1}H10`).join("") }));
      const rod = () => svg("svg", { viewBox: "0 0 1 10", class: "block ten" },
        svg("rect", { width: 1, height: 10 }),
        svg("path", { d: Array.from({ length: 9 }, (_, i) => `M0 ${i + 1}H1`).join("") }));
      const cube = () => svg("svg", { viewBox: "0 0 1 1", class: "block one" }, svg("rect", { width: 1, height: 1 }));
      const group = (n, make, cls) => n > 0 && h("div", { class: "block-group " + cls }, Array.from({ length: n }, make));
      return h("div", { class: "blocks" },
        group(q.hundreds, flat, "hundreds"), group(q.tens, rod, "tens"), group(q.ones, cube, "ones"));
    },

    clock(q) {
      const R = 100;
      const face = svg("svg", { viewBox: "-110 -110 220 220", class: "clock", role: "img", "aria-label": "clock" },
        svg("circle", { r: R, class: "face" }));
      for (let k = 0; k < 60; k++) {
        const a = (k * 6 * Math.PI) / 180, big = k % 5 === 0;
        const r1 = big ? 86 : 92;
        face.append(svg("line", {
          x1: r1 * Math.sin(a), y1: -r1 * Math.cos(a), x2: 97 * Math.sin(a), y2: -97 * Math.cos(a),
          class: big ? "tick big" : "tick",
        }));
      }
      for (let k = 1; k <= 12; k++) {
        const a = (k * 30 * Math.PI) / 180;
        const label = svg("text", { x: 70 * Math.sin(a), y: -70 * Math.cos(a), class: "num" });
        label.textContent = k;
        face.append(label);
      }
      const hand = (deg, len, cls) => {
        const a = (deg * Math.PI) / 180;
        return svg("line", { x1: 0, y1: 0, x2: len * Math.sin(a), y2: -len * Math.cos(a), class: "hand " + cls });
      };
      face.append(hand(((q.h % 12) + q.m / 60) * 30, 48, "hour"), hand(q.m * 6, 78, "minute"), svg("circle", { r: 6, class: "pin" }));
      return h("div", { class: "clock-wrap" }, face);
    },
  };

  const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function listenButton(puzzle, lang) {
    const label = "🔊 " + t("listen");
    const btn = h("button", { class: "btn", onclick: async () => {
      btn.disabled = true;
      btn.textContent = "🔊 …";
      try {
        await LitTTS.speak(puzzle.source, { lang, textId: puzzle.textId });
        btn.textContent = label;
      } catch (e) {
        console.warn("Listen failed:", e);
        btn.textContent = "🔇";
      }
      btn.disabled = false;
    } }, label);
    return btn;
  }

  // Bursts out from the middle of the visible screen, so it is seen wherever the page is
  // scrolled and never hides under the header.
  function celebrate() {
    const burst = h("div", { class: "confetti", "aria-hidden": "true" });
    const symbols = ["⭐", "🎉", "✨", "🌟"];
    for (let i = 0; i < 20; i++) {
      const s = h("span", null, pickOne(symbols));
      const angle = (i / 20) * 2 * Math.PI + Math.random() * 0.3;
      const dist = 28 + Math.random() * 16; // in vmin
      s.style.setProperty("--dx", (Math.cos(angle) * dist).toFixed(1) + "vmin");
      s.style.setProperty("--dy", (Math.sin(angle) * dist).toFixed(1) + "vmin");
      s.style.animationDelay = Math.random() * 0.15 + "s";
      burst.append(s);
    }
    document.body.append(burst);
    setTimeout(() => burst.remove(), 2200);
  }

  // ------------------------------------------------------------------ renderers
  // Each renderer(puzzle, stage, tray, onChange) returns:
  //   ready()  → can the Check button be pressed
  //   check()  → marks right/wrong in the UI, returns { correct, total, extra? }
  //   retry()  → clears wrong answers
  //   reveal() → shows the full answer

  // Shared logic for "tap a blank, then pick a value from the tray".
  function blankRenderer(puzzle, stage, tray, onChange, opts) {
    const blanks = [];
    let active = -1;
    const reading = h("div", { class: "reading" });
    if (puzzle.title) stage.append(h("h2", { class: "text-title" }, puzzle.title));
    stage.append(reading);

    opts.build(reading, (answer, original, choices) => {
      const i = blanks.length;
      const el = h("button", { class: "blank " + opts.blankClass, "aria-label": "?", onclick: () => select(i) }, opts.empty);
      blanks.push({ el, answer, original, choices, value: null, locked: false });
      return el;
    });

    function select(i) {
      if (i < 0 || blanks[i].locked) return;
      active = i;
      blanks.forEach((b, j) => b.el.classList.toggle("active", j === i));
      renderTray();
    }

    function selectNextEmpty(from) {
      for (let k = 1; k <= blanks.length; k++) {
        const j = (from + k) % blanks.length;
        if (!blanks[j].value && !blanks[j].locked) return select(j);
      }
      blanks.forEach((b) => b.el.classList.remove("active"));
      active = -1;
      renderTray();
    }

    function fill(value) {
      if (active < 0) return;
      const b = blanks[active];
      b.value = value;
      b.el.textContent = opts.display(value, b.original);
      b.el.classList.add("filled");
      b.el.classList.remove("wrong");
      selectNextEmpty(active);
      onChange();
    }

    function clear() {
      if (active < 0 || !blanks[active].value) return;
      const b = blanks[active];
      b.value = null;
      b.el.textContent = opts.empty;
      b.el.classList.remove("filled", "wrong");
      onChange();
    }

    function renderTray() {
      const choices = opts.trayChoices(active >= 0 ? blanks[active] : null);
      tray.replaceChildren(
        h("div", { class: "tiles " + opts.trayClass },
          choices.map((c) => h("button", { class: "tile", onclick: () => fill(c) }, c)),
          opts.eraser && h("button", { class: "tile erase", "aria-label": "⌫", onclick: clear }, "⌫")));
    }

    select(0);
    return {
      ready: () => blanks.every((b) => b.value),
      check() {
        let correct = 0;
        for (const b of blanks) {
          const ok = b.value === b.answer;
          b.el.classList.toggle("ok", ok);
          b.el.classList.toggle("wrong", !ok);
          if (ok) { b.locked = true; b.el.disabled = true; correct++; }
        }
        blanks.forEach((b) => b.el.classList.remove("active"));
        tray.replaceChildren();
        return { correct, total: blanks.length };
      },
      retry() {
        for (const b of blanks) {
          if (!b.locked) { b.value = null; b.el.textContent = opts.empty; b.el.classList.remove("filled", "wrong"); }
        }
        selectNextEmpty(-1);
      },
      reveal() {
        for (const b of blanks) {
          b.el.textContent = opts.display(b.answer, b.original);
          b.el.classList.remove("wrong", "active");
          b.el.classList.add(b.locked ? "ok" : "shown");
          b.el.disabled = true;
        }
        tray.replaceChildren();
      },
    };
  }

  function addText(parent, text) {
    text.split("\n").forEach((line, i) => { if (i) parent.append(h("br")); if (line) parent.append(line); });
  }

  const RENDERERS = {
    letters(p, stage, tray, onChange) {
      return blankRenderer(p, stage, tray, onChange, {
        blankClass: "letter-blank",
        trayClass: "letter-bank",
        empty: " ",
        eraser: true,
        build(reading, makeBlank) {
          for (const it of p.items) {
            if (it.kind === "sep") { addText(reading, it.text); continue; }
            reading.append(h("span", { class: "word" },
              it.parts.map((part) => (part.answer ? makeBlank(part.answer, part.text) : part.text))));
          }
        },
        display: (v, original) => LitGen.matchCase(v, original),
        trayChoices: () => p.bank,
      });
    },

    words(p, stage, tray, onChange) {
      return blankRenderer(p, stage, tray, onChange, {
        blankClass: "word-blank",
        trayClass: "word-bank",
        empty: " ".repeat(6),
        eraser: false,
        build(reading, makeBlank) {
          for (const it of p.items) {
            if (it.kind === "sep") addText(reading, it.text);
            else if (it.options) reading.append(makeBlank(it.answer, it.answer, it.options));
            else reading.append(it.text);
          }
        },
        display: (v) => v,
        trayChoices: (b) => (b ? b.choices : []),
      });
    },

    builder(p, stage, tray, onChange) {
      return orderRenderer(p, stage, tray, onChange, { kind: "words", ending: p.ending });
    },

    spot(p, stage, tray, onChange) {
      if (p.title) stage.append(h("h2", { class: "text-title" }, p.title));
      const reading = h("div", { class: "reading spot" });
      const counter = h("p", { class: "counter" });
      stage.append(reading);
      tray.append(counter);
      const words = [];
      for (const it of p.items) {
        if (it.kind === "sep") { addText(reading, it.text); continue; }
        const w = { it, marked: false, locked: false };
        w.el = h("button", { class: "spot-word", onclick: () => {
          if (w.locked) return;
          w.marked = !w.marked;
          w.el.classList.toggle("marked", w.marked);
          w.el.classList.remove("wrong");
          update();
        } }, it.text);
        words.push(w);
        reading.append(w.el);
      }
      function update() {
        counter.textContent = t("mistakesFound", { m: words.filter((w) => w.marked).length, n: p.errors });
        onChange();
      }
      function showCorrection(w, cls) {
        w.el.replaceChildren(h("s", null, w.it.text), " ", h("span", { class: "fix" }, w.it.correct));
        w.el.classList.add(cls);
        w.locked = true;
      }
      update();
      return {
        ready: () => words.some((w) => w.marked),
        check() {
          let hits = 0, extra = 0;
          for (const w of words) {
            if (!w.marked || w.locked) { if (w.locked && w.it.correct) hits++; continue; }
            if (w.it.correct) { hits++; showCorrection(w, "ok"); } else { extra++; w.el.classList.add("wrong"); }
          }
          return { correct: Math.max(0, hits - extra), total: p.errors, extra };
        },
        retry() {
          words.forEach((w) => { if (!w.locked && w.marked && !w.it.correct) { w.marked = false; w.el.classList.remove("marked", "wrong"); } });
          update();
        },
        reveal() {
          words.forEach((w) => {
            w.el.disabled = true;
            if (w.it.correct && !w.locked) showCorrection(w, "shown");
            if (!w.it.correct) w.el.classList.remove("marked", "wrong");
          });
        },
      };
    },

    breaks(p, stage, tray, onChange) {
      const row = h("div", { class: "reading breaks" });
      stage.append(row);
      const cuts = new Set();
      const answer = new Set(p.breaks);
      const cells = p.letters.map((ch, i) => {
        const last = i === p.letters.length - 1;
        const el = h("button", { class: "letter", disabled: last, onclick: () => toggle(i) }, ch);
        row.append(el);
        return el;
      });
      if (p.ending) row.append(h("span", { class: "letter ending" }, p.ending));
      function toggle(i) {
        if (cells[i].classList.contains("ok")) return;
        cuts.has(i) ? cuts.delete(i) : cuts.add(i);
        cells[i].classList.toggle("cut", cuts.has(i));
        cells[i].classList.remove("wrong");
        onChange();
      }
      return {
        ready: () => cuts.size > 0,
        check() {
          let hits = 0, extra = 0;
          cuts.forEach((i) => {
            if (answer.has(i)) { hits++; cells[i].classList.add("ok"); } else { extra++; cells[i].classList.add("wrong"); }
          });
          return { correct: Math.max(0, hits - extra), total: answer.size, extra };
        },
        retry() {
          cuts.forEach((i) => { if (!answer.has(i)) { cuts.delete(i); cells[i].classList.remove("cut", "wrong"); } });
          onChange();
        },
        reveal() {
          cells.forEach((el, i) => {
            el.disabled = true;
            el.classList.remove("wrong");
            el.classList.toggle("cut", answer.has(i));
            if (answer.has(i) && !el.classList.contains("ok")) el.classList.add("shown");
          });
        },
      };
    },
  };

  // "Tap pieces in the right order" (Build the Sentence).
  function orderRenderer(p, stage, tray, onChange, opts) {
    const line = h("ol", { class: "answer-line " + opts.kind });
    const endEl = opts.ending ? h("span", { class: "ending" }, opts.ending) : null;
    stage.append(h("div", { class: "answer-wrap " + opts.kind }, line, endEl));
    const pool = h("div", { class: "tiles " + opts.kind });
    tray.append(pool);
    const pieces = p.tiles.map((text) => ({ text, placed: false, locked: false, el: null }));
    let order = [];

    function render() {
      line.replaceChildren(...order.map((pc, i) => {
        const el = h("li", null, h("button", {
          class: "tile placed" + (pc.locked ? " ok" : "") + (pc.wrong ? " wrong" : ""),
          disabled: pc.locked,
          onclick: () => { order.splice(i, 1); pc.placed = false; pc.wrong = false; render(); },
        }, pc.text));
        return el;
      }));
      pool.replaceChildren(...pieces.filter((pc) => !pc.placed).map((pc) =>
        h("button", { class: "tile", onclick: () => { pc.placed = true; order.push(pc); render(); } }, pc.text)));
      line.classList.toggle("empty", order.length === 0);
      onChange();
    }
    render();

    return {
      ready: () => order.length === pieces.length,
      check() {
        let correct = 0;
        order.forEach((pc, i) => {
          const ok = pc.text === p.answer[i];
          pc.wrong = !ok;
          if (ok) correct++;
        });
        // Lock the correct beginning of the answer.
        for (const pc of order) { if (pc.wrong) break; pc.locked = true; }
        render();
        return { correct, total: pieces.length };
      },
      retry() {
        const keep = order.findIndex((pc) => !pc.locked);
        if (keep >= 0) order.splice(keep).forEach((pc) => { pc.placed = false; pc.wrong = false; });
        render();
      },
      reveal() {
        const left = pieces.slice();
        order = p.answer.map((text) => left.splice(left.findIndex((pc) => pc.text === text), 1)[0]);
        pieces.forEach((pc) => { pc.placed = true; pc.wrong = false; pc.locked = true; });
        render();
      },
    };
  }

  // ------------------------------------------------------------------ boot

  const soundBtn = document.getElementById("sound");
  function updateSoundBtn() {
    soundBtn.textContent = LitSfx.enabled ? "🔔" : "🔕";
    soundBtn.setAttribute("aria-pressed", String(LitSfx.enabled));
    soundBtn.setAttribute("aria-label", t("sounds"));
    soundBtn.title = t("sounds");
  }
  soundBtn.addEventListener("click", () => {
    LitSfx.setEnabled(!LitSfx.enabled);
    updateSoundBtn();
    LitSfx.ok();
  });

  function setUiLang(code) {
    state.uiLang = code;
    store.set("uiLang", code);
    document.documentElement.lang = code;
    document.querySelectorAll(".ui-lang button").forEach((b) => b.classList.toggle("active", b.dataset.ui === code));
    updateSoundBtn();
  }

  document.querySelectorAll(".ui-lang button").forEach((b) =>
    b.addEventListener("click", () => {
      setUiLang(b.dataset.ui);
      (state.rerender || showHome)();
    }));

  // audio.txt holds "1" (read-aloud buttons, spoken words and sound effects) or "0" (the app
  // makes no sound: no 🔊 buttons, no 🔔 button, and Listen & Find is hidden). If the file
  // can't be read (missing, or the app was opened from disk), audio stays on.
  function applyAudioSetting(text) {
    const value = String(text).trim();
    if (value !== "0" && value !== "1") console.warn(`audio.txt should contain 0 or 1, not "${value}"; audio stays on`);
    const on = value !== "0";
    LitTTS.setEnabled(on);
    LitSfx.setAllowed(on);
    soundBtn.hidden = !on;
  }

  setUiLang(state.uiLang);
  fetch("audio.txt", { cache: "no-store" })
    .then((res) => (res.ok ? res.text() : "1"))
    .catch(() => "1")
    .then(applyAudioSetting)
    .finally(showHome);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
