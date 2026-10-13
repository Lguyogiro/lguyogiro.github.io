// Nahuatl reading corpus.
//
// Add texts here by hand, or put them in corpus/nah.txt and run:
//   python3 tools/txt_to_corpus.py nah corpus/nah.txt
// which regenerates this file.
//
// Format: { id, title, level, text }
//   level: 1 (2–3 short sentences), 2 (4–5 sentences), 3 (6+ sentences).
//          Optional: if left out, it is estimated from the text length.
//   id:    use "nah-001" etc.; sharing the number with en-001 / es-001 marks
//          it as a translation of that text (optional).
//
// Example (replace with real texts):
//   { id: "nah-001", level: 1, title: "…", text: "… … …" },
window.CORPUS = window.CORPUS || {};
window.CORPUS.nah = [
];
