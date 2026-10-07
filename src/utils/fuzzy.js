// Trigram helpers used for typo-tolerant restaurant search (done inside MongoDB aggregation).
const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const wordGrams = (word) => {
  const padded = `  ${word} `;
  const grams = [];
  for (let i = 0; i <= padded.length - 3; i++) grams.push(padded.slice(i, i + 3));
  return grams;
};

const buildSearchGrams = (texts) => {
  const set = new Set();
  normalize(texts.filter(Boolean).join(" "))
    .split(" ")
    .filter(Boolean)
    .forEach((w) => wordGrams(w).forEach((g) => set.add(g)));
  return [...set];
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = { normalize, buildSearchGrams, escapeRegex };
