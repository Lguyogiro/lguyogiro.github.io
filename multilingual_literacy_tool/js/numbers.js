// Number words 0–1000 for speech recognition. phrases(lang, n) lists every way of saying n
// that the recognizer should accept (lowercase, words separated by single spaces).
// Nahuatl is not here: its recognizer brings its own list of spellings (lexicon.json, made by
// offline_utils/train_nahuatl_asr.py from the training transcriptions).
(function (root) {
  "use strict";

  const MAX = 1000;

  const EN_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

  function en(n) {
    if (n < 20) return [EN_ONES[n]];
    if (n < 100) return [EN_TENS[Math.floor(n / 10)] + (n % 10 ? " " + EN_ONES[n % 10] : "")];
    if (n === 1000) return ["one thousand", "a thousand", "ten hundred"];
    const h = Math.floor(n / 100), rest = n % 100;
    const heads = h === 1 ? ["one hundred", "a hundred"] : [EN_ONES[h] + " hundred"];
    if (!rest) return heads;
    const tails = en(rest);
    // "one hundred five", "one hundred and five"
    return heads.flatMap((hd) => tails.flatMap((t) => [`${hd} ${t}`, `${hd} and ${t}`]));
  }

  const ES_UNITS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
    "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte",
    "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete",
    "veintiocho", "veintinueve"];
  const ES_TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const ES_HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos",
    "setecientos", "ochocientos", "novecientos"];

  function es(n) {
    if (n < 30) return [ES_UNITS[n]];
    if (n < 100) return [ES_TENS[Math.floor(n / 10)] + (n % 10 ? " y " + ES_UNITS[n % 10] : "")];
    if (n === 100) return ["cien"];
    if (n === 1000) return ["mil"];
    const h = Math.floor(n / 100), rest = n % 100;
    return rest ? es(rest).map((t) => `${ES_HUNDREDS[h]} ${t}`) : [ES_HUNDREDS[h]];
  }

  const BUILDERS = { en, es };

  function phrases(lang, n) {
    const b = BUILDERS[lang];
    return b && Number.isInteger(n) && n >= 0 && n <= MAX ? b(n) : [];
  }

  // phrase → number, for every number 0..max.
  const tables = {};
  function table(lang, max = MAX) {
    const key = lang + ":" + max;
    if (!tables[key]) {
      const m = new Map();
      for (let n = 0; n <= max; n++) for (const p of phrases(lang, n)) if (!m.has(p)) m.set(p, n);
      tables[key] = m;
    }
    return tables[key];
  }

  root.LitNumbers = { MAX, phrases, table, supported: (lang) => lang in BUILDERS };
})(typeof window !== "undefined" ? window : globalThis);
