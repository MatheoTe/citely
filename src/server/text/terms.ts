/**
 * Shared lexical helpers used by the offline embedder, the offline answerer
 * and the full-text query builder, so all three agree on what a "term" is.
 */
export const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does doing for from had has have how i if in into is it its " +
    "me my of on or our should so than that the their them then there these they this those to too up us was we were " +
    "what when where which while who whom why will with would you your about after all also any before being both " +
    "each few more most much many long other over same some such only own just very s t don now get got tell know " +
    "need needs use used using via per"
  ).split(" "),
);

/** Very small suffix stripper: enough to match "retries"/"retry" and "rotated"/"rotation". */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith("ation")) return w.slice(0, -5);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("es") && /(ss|x|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Lowercased word tokens. Keeps identifiers such as "kr-1029" or "99.95" together. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g) ?? [];
}

/** Content terms: tokens minus stopwords, stemmed. */
export function contentTerms(text: string): string[] {
  return tokenize(text)
    .filter((t) => !STOPWORDS.has(t))
    .map(stem);
}
