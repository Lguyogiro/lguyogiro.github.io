// Text-to-speech. Each language's `tts` setting in js/languages.js chooses an engine:
//
//   { engine: "browser", lang: "es-MX", voiceName?, rate?, pitch? }
//       The device's built-in speech synthesis (Web Speech API).
//   { engine: "files", path: "audio/{lang}/{id}.mp3" }
//       Pre-recorded audio, one file per text ({lang}, {id} are filled in).
//   { engine: "http", url: "https://…/tts", method?: "POST" | "GET", headers?, params? }
//       Your own TTS server. It receives the text and must answer with audio bytes.
//
// `tts` may also be a list of these; they are tried in order until one works
// (e.g. a recording if there is one, otherwise a TTS model).
// More engines can be added with LitTTS.register(name, { available(cfg), speak(text, cfg, info) }).
(function () {
  "use strict";

  const engines = {};
  let current = null; // { stop() } for whatever is playing now
  let enabled = true; // false when audio.txt turns audio off (see app.js)

  function stop() {
    if (current) current.stop();
    current = null;
  }

  // One shared player. iOS Safari only lets an <audio> element play after a tap, and the
  // fetch in the "http" engine finishes after the tap is over, so speak() "unlocks" this
  // element with a silent clip while still inside the tap, and every later play reuses it.
  const player = new Audio();
  const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  let unlocked = false;

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    player.src = SILENT;
    player.play().catch(() => {});
  }

  function playUrl(url) {
    return new Promise((resolve, reject) => {
      player.onended = resolve;
      player.onerror = () => reject(new Error("could not play " + url));
      player.src = url;
      current = { stop: () => { player.pause(); resolve(); } };
      player.play().catch(reject);
    });
  }

  // ------------------------------------------------------------------ browser

  // Voice names that usually mean a higher-quality (neural / network) voice.
  const GOOD_VOICE = /natural|neural|enhanced|premium|online|google|siri/i;

  function getVoices() {
    return new Promise((resolve) => {
      const v = speechSynthesis.getVoices();
      if (v.length) return resolve(v);
      // Some browsers load the voice list asynchronously.
      speechSynthesis.addEventListener("voiceschanged", () => resolve(speechSynthesis.getVoices()), { once: true });
      setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
    });
  }

  function pickVoice(voices, cfg) {
    if (cfg.voiceName) {
      const named = voices.find((v) => v.name.toLowerCase().includes(cfg.voiceName.toLowerCase()));
      if (named) return named;
    }
    const want = cfg.lang.toLowerCase();
    const base = want.split("-")[0];
    const score = (v) => {
      const vl = v.lang.toLowerCase().replace("_", "-");
      return (vl === want ? 2 : 0) + (GOOD_VOICE.test(v.name) ? 3 : 0) + (v.localService ? 0 : 0.5);
    };
    return voices
      .filter((v) => v.lang.toLowerCase().replace("_", "-").split("-")[0] === base)
      .sort((a, b) => score(b) - score(a))[0] || null;
  }

  register("browser", {
    available: () => "speechSynthesis" in window,
    async speak(text, cfg) {
      const voices = await getVoices();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = cfg.lang;
      const voice = pickVoice(voices, cfg);
      if (voice) u.voice = voice;
      else if (cfg.requireVoice !== false) throw new Error("no " + cfg.lang + " voice on this device");
      u.rate = cfg.rate ?? 0.85;
      u.pitch = cfg.pitch ?? 1;
      speechSynthesis.cancel();
      return new Promise((resolve, reject) => {
        u.onend = resolve;
        u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new Error(e.error)));
        current = { stop: () => speechSynthesis.cancel() };
        speechSynthesis.speak(u);
      });
    },
  });

  // ------------------------------------------------------------------ files

  register("files", {
    available: () => true,
    speak(text, cfg, info) {
      const url = cfg.path.replace("{lang}", info.lang).replace("{id}", info.textId);
      return playUrl(url);
    },
  });

  // ------------------------------------------------------------------ http

  const httpCache = new Map(); // url+text → object URL, so replays don't hit the server

  register("http", {
    available: () => true,
    async speak(text, cfg, info) {
      const key = cfg.url + "\n" + text;
      if (!httpCache.has(key)) {
        const params = { text, lang: info.lang, ...(cfg.params || {}) };
        const method = (cfg.method || "POST").toUpperCase();
        const res = method === "GET"
          ? await fetch(cfg.url + (cfg.url.includes("?") ? "&" : "?") + new URLSearchParams(params), { headers: cfg.headers })
          : await fetch(cfg.url, {
            method,
            headers: { "Content-Type": "application/json", ...(cfg.headers || {}) },
            body: JSON.stringify(params),
          });
        if (!res.ok) throw new Error("TTS server answered " + res.status);
        httpCache.set(key, URL.createObjectURL(await res.blob()));
      }
      return playUrl(httpCache.get(key));
    },
  });

  // ------------------------------------------------------------------ public API

  function register(name, engine) {
    engines[name] = engine;
  }

  function configs(langCode) {
    const tts = (window.LANGS[langCode] || {}).tts;
    return (Array.isArray(tts) ? tts : tts ? [tts] : []).filter((c) => engines[c.engine]);
  }

  function available(langCode) {
    return enabled && configs(langCode).some((c) => engines[c.engine].available(c));
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) stop();
  }

  // info: { lang, textId }. Tries each configured engine in order.
  // Call directly from a tap handler (it unlocks audio before its first await).
  async function speak(text, info) {
    if (!enabled) throw new Error("audio is turned off (audio.txt)");
    stop();
    unlock();
    let lastError = new Error("no TTS configured for " + info.lang);
    for (const cfg of configs(info.lang)) {
      const engine = engines[cfg.engine];
      if (!engine.available(cfg)) continue;
      try {
        return await engine.speak(text, cfg, info);
      } catch (e) {
        lastError = e;
        console.warn(`TTS engine "${cfg.engine}" failed:`, e.message);
      }
    }
    throw lastError;
  }

  window.LitTTS = { register, available, speak, stop, pickVoice, setEnabled };
})();
