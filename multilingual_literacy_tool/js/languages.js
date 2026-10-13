// Per-language settings used by the exercise generators.
//
//   vowels       letters treated as vowels (easy levels of "Missing Letters" blank only these)
//   digraphs     letter groups shown and blanked as a single tile (e.g. Nahuatl "tl")
//   stopwords    very common words never chosen as answers in "Missing Words"
//   minWordLen   shortest word that can be an answer in "Missing Words" / "Spot the Mistakes"
//   apostropheIsLetter  keep word-final ' / ʼ as part of the word (saltillo spellings)
//   firstLetterSkip  word beginnings whose first letter isn't its first sound ("ch", silent "h");
//                pictures whose word starts like this are not used for "Which letter does it start with?"
//   letterConfusions  groups of letters that sound alike; never offered as each other's wrong choices
//   homophones / soundKey  words that sound the same are never choices together in "Listen & Find":
//                list them in groups, or give a function that maps a word to how it sounds
//   tts          how "Listen" reads texts aloud (see js/tts.js and docs/TECHNICAL.md), or null for no button
//   asr          speech recognition for spoken math answers (see js/asr.js); the option only
//                appears in the app when the model files exist (download/train them with offline_utils/)
window.LANGS = {
  en: {
    code: "en",
    name: "English",
    tts: { engine: "browser", lang: "en-US" },
    asr: { engine: "vosk", model: "models/vosk/en.tar.gz" },
    vowels: ["a", "e", "i", "o", "u"],
    digraphs: [],
    minWordLen: 3,
    apostropheIsLetter: false,
    firstLetterSkip: ["ch", "sh", "th", "wh", "kn", "ph", "eye"],
    letterConfusions: [["c", "k", "s", "q"], ["g", "j"]],
    homophones: [
      ["to", "too", "two"], ["there", "their"], ["see", "sea"], ["for", "four"], ["one", "won"], ["eight", "ate"],
      ["no", "know"], ["right", "write"], ["hear", "here"], ["sun", "son"], ["by", "buy", "bye"], ["blue", "blew"],
      ["flower", "flour"], ["red", "read"], ["new", "knew"], ["night", "knight"], ["tail", "tale"], ["wood", "would"],
      ["hole", "whole"], ["pair", "pear"], ["meet", "meat"], ["week", "weak"], ["road", "rode"], ["made", "maid"],
      ["be", "bee"], ["dear", "deer"], ["hour", "our"], ["not", "knot"], ["so", "sew"], ["wait", "weight"],
    ],
    stopwords: [
      "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "to", "of", "in",
      "on", "at", "it", "its", "he", "she", "they", "we", "i", "you", "him", "his", "her", "my",
      "our", "their", "them", "for", "with", "as", "by", "that", "this", "from", "so", "then",
      "not", "do", "did", "can", "has", "have", "had", "too", "up", "all", "me", "us", "who",
      "there", "if", "when", "out",
    ],
  },
  es: {
    code: "es",
    name: "Español",
    tts: { engine: "browser", lang: "es-MX" },
    asr: { engine: "vosk", model: "models/vosk/es.tar.gz" },
    vowels: ["a", "e", "i", "o", "u", "á", "é", "í", "ó", "ú", "ü"],
    digraphs: [],
    minWordLen: 3,
    apostropheIsLetter: false,
    firstLetterSkip: ["ch", "ll", "h", "qu"],
    letterConfusions: [["b", "v"], ["c", "s", "z", "k", "q"], ["g", "j"], ["y", "i", "l"]],
    // Mexican Spanish: silent h, b = v, s = z = soft c, y = ll, hard c = qu = k.
    soundKey: (w) => w.replace(/h/g, "").replace(/v/g, "b").replace(/c([ei])/g, "s$1").replace(/z/g, "s")
      .replace(/ll/g, "y").replace(/qu/g, "k").replace(/c/g, "k").replace(/g([ei])/g, "j$1"),
    stopwords: [
      "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "e", "o", "u", "pero", "de", "del",
      "al", "a", "en", "con", "por", "para", "que", "se", "su", "sus", "mi", "mis", "lo", "le",
      "les", "es", "son", "muy", "me", "te", "nos", "ya", "no", "sí", "si", "yo", "tú", "él",
      "ella", "ellos", "como", "cuando", "también", "hay", "más", "sin", "sobre", "entre",
    ],
  },
  nah: {
    code: "nah",
    name: "Náhuatl",
    // No device has a built-in Nahuatl voice. To add one, e.g.:
    //   tts: [
    //     { engine: "files", path: "audio/{lang}/{id}.mp3" },        // human recordings first
    //     { engine: "http", url: "http://192.168.1.20:5002/tts" },  // then your own TTS model
    //   ],
    tts: null,
    // Created by offline_utils/train_nahuatl_asr.py (train, then export --dest models/nah).
    asr: { engine: "onnx-ctc", model: "models/nah/" },
    vowels: ["a", "e", "i", "o", "u", "ā", "ē", "ī", "ō", "ū"],
    // Letter pairs like "tl" and "ch" are treated as two separate letters.
    digraphs: [],
    minWordLen: 4,
    apostropheIsLetter: true,
    // Letter groups that are one sound in every common spelling. Adjust to your orthography.
    firstLetterSkip: ["tl", "tz", "ch", "hu", "uh", "cu", "qu", "kw"],
    letterConfusions: [["c", "k", "q"], ["s", "z", "c"], ["o", "u"], ["w", "h", "u"], ["i", "y"]],
    // Add very common particles here (e.g. ihuan/iwan, in, ca/ka …) so they are not chosen as answers.
    stopwords: [],
  },
};
