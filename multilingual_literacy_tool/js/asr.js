// Speech input for numeric answers. Each language's `asr` setting in js/languages.js picks an
// engine:
//
//   { engine: "vosk", model: "models/vosk/en.tar.gz" }
//       Vosk (Kaldi) in WebAssembly, restricted to number words with a grammar (js/numbers.js).
//   { engine: "onnx-ctc", model: "models/nah/" }
//       A model trained with offline_utils/train_nahuatl_asr.py, run with onnxruntime-web.
//       Every known spelling of every allowed number (lexicon.json) is scored against the
//       model's output and the best one wins.
//
// Everything runs on the device: no audio is sent anywhere.
//
// Usage (from a tap handler):
//   const r = await LitASR.listen({ lang: "es", values: [0..100], onState, onLevel });
//   → { value, text, confidence, speechStart } or null (nothing heard / not understood)
(function () {
  "use strict";

  const VOSK_URL = "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js";
  const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";

  const engines = {};
  const loaded = {}; // lang → Promise<recognizer>

  function register(name, engine) { engines[name] = engine; }
  const config = (lang) => (window.LANGS[lang] || {}).asr || null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("could not load " + src));
      document.head.append(s);
    });
  }

  const absolute = (url) => new URL(url, location.href).href;

  // ------------------------------------------------------------------ availability

  const micSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
    window.isSecureContext && location.protocol !== "file:";

  // Is there an engine + model for this language? Checks the model file exists (cached).
  const probes = {};
  function available(lang) {
    const cfg = config(lang);
    if (!cfg || !engines[cfg.engine] || !micSupported()) return Promise.resolve(false);
    if (!probes[lang]) {
      probes[lang] = fetch(absolute(engines[cfg.engine].probeUrl(cfg)), { method: "HEAD" })
        .then((r) => r.ok).catch(() => false);
    }
    return probes[lang];
  }

  function recognizer(lang) {
    if (!loaded[lang]) {
      const cfg = config(lang);
      loaded[lang] = engines[cfg.engine].load(cfg, lang).catch((e) => { delete loaded[lang]; throw e; });
    }
    return loaded[lang];
  }

  // ------------------------------------------------------------------ microphone + end of speech

  let ctx = null, stream = null, active = null;

  async function openMic() {
    if (!stream || stream.getAudioTracks().every((t) => t.readyState === "ended")) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    }
    return stream;
  }

  // Stop the current listen() (it resolves with null) but keep the microphone open.
  function cancel() {
    if (active) active.cancel();
  }

  // Stop listening and release the microphone (called when leaving a screen).
  function stop() {
    cancel();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  // Record until the child stops talking. Voice activity detection by loudness: the first
  // 0.25 s sets the noise floor, and speech is anything clearly louder than it. Recording ends
  // 0.7 s after the speech stops, after 4 s of speech, or after 5 s with no speech at all.
  const VAD = { calibrateMs: 250, endSilenceMs: 700, noSpeechMs: 5000, maxMs: 4000, minLevel: 0.012, ratio: 3 };

  async function listen(opts) {
    const { lang, values, onState = () => {}, onLevel = () => {} } = opts;
    if (active) active.cancel();
    // Create/resume audio while still inside the tap (iOS requirement).
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const resumed = ctx.resume();

    onState("loading");
    const [rec, mic] = await Promise.all([recognizer(lang), openMic(), resumed]);
    const session = rec.start(ctx.sampleRate);

    onState("listening");
    const source = ctx.createMediaStreamSource(mic);
    const node = ctx.createScriptProcessor(2048, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0; // ScriptProcessor must be connected to run; keep it silent
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);

    const t0 = performance.now();
    let floor = 0, floorN = 0, speechStart = null, lastLoud = 0, finished = false;
    const preroll = []; // audio just before speech starts, so the first sound isn't cut off

    const done = new Promise((resolve) => {
      function end(cancelled) {
        if (finished) return;
        finished = true;
        node.onaudioprocess = null;
        source.disconnect();
        node.disconnect();
        mute.disconnect();
        active = null;
        onLevel(0);
        resolve(cancelled || speechStart === null ? null : true);
      }
      active = { cancel: () => end(true) };
      node.onaudioprocess = (e) => {
        if (finished) return;
        const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
        const now = performance.now() - t0;
        let sum = 0;
        for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
        const rms = Math.sqrt(sum / chunk.length);
        onLevel(Math.min(1, rms * 12));
        if (now < VAD.calibrateMs) { floor += rms; floorN++; preroll.push(chunk); return; }
        const threshold = Math.max(VAD.minLevel, (floor / Math.max(1, floorN)) * VAD.ratio);
        if (speechStart === null) {
          preroll.push(chunk);
          if (preroll.length > 8) preroll.shift();
          if (rms > threshold) {
            speechStart = performance.now() - (chunk.length / ctx.sampleRate) * 1000;
            lastLoud = now;
            preroll.forEach((c) => session.push(c));
          } else if (now > VAD.noSpeechMs) end(false);
          return;
        }
        session.push(chunk);
        if (rms > threshold) lastLoud = now;
        if (now - lastLoud > VAD.endSilenceMs || now - (speechStart - t0) > VAD.maxMs) end(false);
      };
    });

    const heard = await done;
    if (!heard) { session.cancel && session.cancel(); onState("idle"); return null; }
    onState("thinking");
    const result = await session.finish({ values });
    onState("idle");
    return result ? { ...result, speechStart } : null;
  }

  // Run the recognizer on recorded audio (no microphone): used by tests and for debugging.
  async function recognizeAudio(lang, samples, sampleRate, values) {
    const rec = await recognizer(lang);
    const session = rec.start(sampleRate);
    for (let i = 0; i < samples.length; i += 2048) session.push(samples.subarray(i, i + 2048));
    return session.finish({ values });
  }

  // ------------------------------------------------------------------ Vosk engine

  register("vosk", {
    probeUrl: (cfg) => cfg.model,
    async load(cfg, lang) {
      await loadScript(cfg.lib || VOSK_URL);
      const model = await window.Vosk.createModel(absolute(cfg.model));
      const table = window.LitNumbers.table(lang);
      const grammar = JSON.stringify([...table.keys(), "[unk]"]);
      const recognizers = {}; // one per sample rate, reused (Vosk resets after each final result)
      return {
        start(sampleRate) {
          if (!recognizers[sampleRate]) {
            const r = new model.KaldiRecognizer(sampleRate, grammar);
            r.setWords(true);
            r.handlers = [];
            r.on("result", (m) => r.handlers.forEach((h) => h(m.result)));
            recognizers[sampleRate] = r;
          }
          const r = recognizers[sampleRate];
          const parts = [];
          const collect = (res) => parts.push(res);
          r.handlers = [collect];
          return {
            push: (chunk) => r.acceptWaveformFloat(chunk, sampleRate),
            cancel: () => r.retrieveFinalResult(),
            finish: ({ values } = {}) => new Promise((resolve) => {
              // The result after retrieveFinalResult() is the final one for this utterance.
              const timer = setTimeout(() => resolve(read()), 4000);
              r.handlers = [(res) => { parts.push(res); clearTimeout(timer); resolve(read()); }];
              r.retrieveFinalResult();
              function read() {
                r.handlers = [];
                const words = parts.flatMap((p) => p.result || []).filter((w) => w.word !== "[unk]");
                const text = words.map((w) => w.word).join(" ");
                let value = table.has(text) ? table.get(text) : null;
                if (value !== null && values && !values.includes(value)) value = null;
                const confidence = words.length ? Math.min(...words.map((w) => w.conf)) : 0;
                return text ? { value, text, confidence } : null;
              }
            }),
          };
        },
      };
    },
  });

  // ------------------------------------------------------------------ ONNX CTC engine

  // Same normalization as normalize_text() in offline_utils/train_nahuatl_asr.py.
  function normalizeText(s) {
    return s.normalize("NFC").toLowerCase()
      .replace(/[’ʼ]/g, "'")
      .replace(/[^\p{L}\p{M}']+/gu, " ")
      .trim().replace(/\s+/g, " ");
  }

  // log(exp(a) + exp(b))
  function logAdd(a, b) {
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    return a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b));
  }

  // CTC log-likelihood of a token sequence given per-frame log-probabilities
  // (lp: Float32Array of T*V values, row-major). Standard forward algorithm.
  function ctcScore(lp, T, V, ids, blank = 0) {
    const S = 2 * ids.length + 1;
    const label = (s) => (s % 2 === 0 ? blank : ids[(s - 1) >> 1]);
    let prev = new Float64Array(S).fill(-Infinity);
    let cur = new Float64Array(S);
    prev[0] = lp[blank];
    if (S > 1) prev[1] = lp[label(1)];
    for (let t = 1; t < T; t++) {
      const row = t * V;
      for (let s = 0; s < S; s++) {
        let a = prev[s];
        if (s > 0) a = logAdd(a, prev[s - 1]);
        if (s > 1 && s % 2 === 1 && label(s) !== label(s - 2)) a = logAdd(a, prev[s - 2]);
        cur[s] = a + lp[row + label(s)];
      }
      [prev, cur] = [cur, prev];
    }
    return S > 1 ? logAdd(prev[S - 1], prev[S - 2]) : prev[0];
  }

  // Best number for one utterance: max over spellings per value, then a softmax over values.
  function pickValue(lp, T, V, lexiconIds, values) {
    const scores = [];
    for (const [value, spellings] of lexiconIds) {
      if (values && !values.includes(value)) continue;
      let best = -Infinity, bestText = "";
      for (const { text, ids } of spellings) {
        const sc = ctcScore(lp, T, V, ids);
        if (sc > best) { best = sc; bestText = text; }
      }
      if (best > -Infinity) scores.push({ value, text: bestText, score: best });
    }
    if (!scores.length) return null;
    const top = Math.max(...scores.map((s) => s.score));
    const z = scores.reduce((acc, s) => acc + Math.exp(s.score - top), 0);
    const best = scores.find((s) => s.score === top);
    return { value: best.value, text: best.text, confidence: 1 / z };
  }

  async function resample(samples, from, to) {
    if (from === to) return samples;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    try {
      const off = new OAC(1, Math.ceil((samples.length * to) / from), to);
      const buf = off.createBuffer(1, samples.length, from);
      buf.copyToChannel(samples, 0);
      const src = off.createBufferSource();
      src.buffer = buf;
      src.connect(off.destination);
      src.start();
      return (await off.startRendering()).getChannelData(0);
    } catch (e) { // fallback: linear interpolation
      const out = new Float32Array(Math.floor((samples.length * to) / from));
      for (let i = 0; i < out.length; i++) {
        const x = (i * from) / to, j = Math.floor(x), f = x - j;
        out[i] = samples[j] * (1 - f) + (samples[j + 1] ?? samples[j]) * f;
      }
      return out;
    }
  }

  register("onnx-ctc", {
    probeUrl: (cfg) => cfg.model.replace(/\/?$/, "/") + "config.json",
    async load(cfg) {
      const base = absolute(cfg.model.replace(/\/?$/, "/"));
      await loadScript(cfg.lib || ORT_BASE + "ort.min.js");
      window.ort.env.wasm.wasmPaths = cfg.wasmPaths || ORT_BASE;
      const getJson = (f) => fetch(base + f).then((r) => { if (!r.ok) throw new Error(f + " " + r.status); return r.json(); });
      const [conf, vocab, lexicon] = await Promise.all(["config.json", "vocab.json", "lexicon.json"].map(getJson));
      const session = await window.ort.InferenceSession.create(base + (conf.model || "model.onnx"), { executionProviders: ["wasm"] });
      const charId = new Map(vocab.map((c, i) => [c, i]));
      const lexiconIds = Object.entries(lexicon).map(([value, spellings]) => [Number(value), spellings
        .map((text) => ({ text, ids: [...normalizeText(text)].map((ch) => charId.get(ch)).filter((i) => i !== undefined) }))
        .filter((s) => s.ids.length)]);
      const rate = conf.sample_rate || 16000;
      const maxSamples = Math.floor((conf.max_seconds || 4) * rate);

      return {
        values: lexiconIds.map(([v]) => v),
        start(sampleRate) {
          const chunks = [];
          return {
            push: (c) => chunks.push(c),
            cancel: () => { chunks.length = 0; },
            async finish({ values } = {}) {
              const n = chunks.reduce((a, c) => a + c.length, 0);
              if (!n) return null;
              const raw = new Float32Array(n);
              let o = 0;
              for (const c of chunks) { raw.set(c, o); o += c.length; }
              let audio = await resample(raw, sampleRate, rate);
              if (audio.length > maxSamples) audio = audio.subarray(0, maxSamples);
              if (audio.length < 1600) return null; // < 0.1 s
              const input = new window.ort.Tensor("float32", Float32Array.from(audio), [1, audio.length]);
              const out = (await session.run({ [conf.input || "audio"]: input }))[conf.output || "logprobs"];
              const [, T, V] = out.dims;
              return pickValue(out.data, T, V, lexiconIds, values);
            },
          };
        },
      };
    },
  });

  window.LitASR = { register, available, listen, cancel, stop, recognizeAudio, micSupported, ctcScore, pickValue, normalizeText };
})();
