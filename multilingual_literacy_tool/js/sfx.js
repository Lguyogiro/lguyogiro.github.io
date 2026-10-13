// Short feedback sounds (right, wrong, round finished), made with the Web Audio API so there
// are no audio files to download. The 🔔 button in the top bar turns them off; the choice is
// stored on the device.
(function () {
  "use strict";

  const KEY = "lit.sound";
  let on = true;
  try { on = localStorage.getItem(KEY) !== "off"; } catch (e) { /* private mode */ }
  let allowed = true; // false when audio.txt turns audio off (see app.js); overrides the 🔔 button
  let ctx = null;

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // notes: [frequency Hz, start s, length s]
  function play(notes, { type = "sine", volume = 0.18 } = {}) {
    if (!on || !allowed) return;
    const ac = audio();
    if (!ac) return;
    const t0 = ac.currentTime + 0.01;
    for (const [freq, start, len] of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + start);
      gain.gain.linearRampToValueAtTime(volume, t0 + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + len + 0.05);
    }
  }

  window.LitSfx = {
    ok: () => play([[660, 0, 0.18], [880, 0.09, 0.28]]),
    bad: () => play([[220, 0, 0.16], [185, 0.08, 0.22]], { type: "triangle", volume: 0.14 }),
    win: () => play([[523, 0, 0.2], [659, 0.12, 0.2], [784, 0.24, 0.2], [1047, 0.36, 0.45]]),
    get enabled() { return on; },
    get allowed() { return allowed; },
    setAllowed(v) { allowed = !!v; },
    setEnabled(v) {
      on = !!v;
      try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* private mode */ }
    },
  };
})();
