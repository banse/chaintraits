// Titles start each main word upper case; articles, short conjunctions and prepositions stay lower case unless first.
const MINOR = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "as", "at", "by", "in", "of", "on", "per", "to", "via", "vs", "with"]);
export function titleCase(text) {
  return String(text).replace(/[A-Za-z][A-Za-z0-9’']*/g, (word, offset) =>
    offset > 0 && MINOR.has(word.toLowerCase()) ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1),
  );
}
