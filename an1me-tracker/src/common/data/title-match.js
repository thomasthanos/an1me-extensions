// title-match.js — one normalizer and one similarity score for matching an an1me.to entry against
// an external database (AnimeFillerList, Jikan).
//
// This replaces two separate pieces of guesswork: a chain of ~15 regexes that mangled the an1me
// slug into candidate slugs and hoped one of them existed, and a Jikan lookup that demanded exact
// normalized title equality and returned nothing on a single differing word.
(function () {
  "use strict";

  // Ordinal/qualifier tails that distinguish a season but not the show. Stripped to a "base"
  // form so "Show Season 2" can match the index's "Show", which is often listed once with
  // absolute numbering.
  const SEASON_TAIL_RE =
    /\b(?:the\s+)?(?:final\s+season|last\s+season|season\s*\d+|s\d+|part\s*\d+|cour\s*\d+|2nd\s+season|3rd\s+season|4th\s+season|5th\s+season|6th\s+season|7th\s+season|ii|iii|iv|v|vi|vii|viii)\b/g;
  const YEAR_TAIL_RE = /\b(?:19|20)\d{2}\b/g;
  // Romanization variants that are not spelling mistakes but do break equality.
  const ROMAJI_VARIANTS = [
    [/shippuuden/g, "shippuden"],
    [/ou\b/g, "o"],
    [/\bwo\b/g, "o"],
    [/uu/g, "u"],
    [/oo/g, "o"],
  ];

  function stripDiacritics(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "");
  }

  // Lowercase, ASCII-folded, punctuation-free, single-spaced.
  function normalizeTitle(value) {
    let text = stripDiacritics(value).toLowerCase();
    text = text.replace(/&/g, " and ");
    text = text.replace(/[^a-z0-9]+/g, " ");
    return text.replace(/\s+/g, " ").trim();
  }

  // Normalized, with romanization variants folded but the season/part tail INTACT. Kept separate
  // from baseTitle because the two foldings mean different things to the caller: "Shippuuden" vs
  // "Shippuden" is one show spelled two ways (no episode offset), while "Show Season 2" vs "Show"
  // is a season matched against an absolute-numbered listing (offset required).
  function romajiTitle(value) {
    let text = normalizeTitle(value);
    for (const [pattern, replacement] of ROMAJI_VARIANTS) text = text.replace(pattern, replacement);
    return text.replace(/\s+/g, " ").trim();
  }

  // romajiTitle, plus season/part/year tails removed.
  function baseTitle(value) {
    return romajiTitle(value).replace(SEASON_TAIL_RE, " ").replace(YEAR_TAIL_RE, " ").replace(/\s+/g, " ").trim();
  }

  function tokenize(value) {
    return normalizeTitle(value)
      .split(" ")
      .filter((token) => token.length > 1);
  }

  function bigrams(value) {
    const text = normalizeTitle(value).replace(/\s/g, "");
    const out = new Set();
    for (let i = 0; i < text.length - 1; i++) out.add(text.slice(i, i + 2));
    return out;
  }

  function diceCoefficient(left, right) {
    const a = bigrams(left);
    const b = bigrams(right);
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const gram of a) if (b.has(gram)) shared++;
    return (2 * shared) / (a.size + b.size);
  }

  function jaccardTokens(left, right) {
    const a = new Set(tokenize(left));
    const b = new Set(tokenize(right));
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const token of a) if (b.has(token)) shared++;
    return shared / (a.size + b.size - shared);
  }

  // Confidence ladder, strongest first: 1.00 exact, 0.99 romanization variant, 0.97 season-tail
  // match, <=0.95 containment, then the blended similarity. Keeping these tiers ordered is what
  // stops a near-miss from tying with a certainty and winning on array position.
  const CONTAINMENT_CEILING = 0.95;

  // 0..1. Exact matches short-circuit to 1; otherwise character bigrams and token overlap are
  // blended, because either alone misreads a common case: bigrams rate "Naruto" against
  // "Naruto Shippuden" too highly, token overlap rates a one-word retitle too harshly.
  function similarity(left, right) {
    const a = normalizeTitle(left);
    const b = normalizeTitle(right);
    if (!a || !b) return 0;
    if (a === b) return 1;

    const romajiA = romajiTitle(left);
    if (romajiA && romajiA === romajiTitle(right)) return 0.99;

    const baseA = baseTitle(left);
    const baseB = baseTitle(right);
    if (baseA && baseA === baseB) return 0.97;

    const dice = diceCoefficient(a, b);
    const jaccard = jaccardTokens(a, b);
    const blended = dice * 0.5 + jaccard * 0.5;

    // Containment bonus: an index title that fully contains the query (or vice versa) as whole
    // tokens is usually the right show listed under a longer or shorter name.
    //
    // Capped below the exact/variant/base tiers on purpose. Containment is evidence, never
    // certainty - the extra tokens can be a sequel marker, which is a DIFFERENT show. Uncapped,
    // "Dragon Ball Z" scored a perfect 1.000 against "Dragon Ball" and beat the real
    // "Dragon Ball Z" listing outright.
    const contains = (` ${a} `).includes(` ${b} `) || (` ${b} `).includes(` ${a} `);
    return contains ? Math.min(CONTAINMENT_CEILING, blended + 0.12) : blended;
  }

  // Scores every (key, candidate) pair and returns the best above `threshold`.
  //
  // keys: the titles we know for the entry (romaji, english, native, synonyms, slug-derived).
  // candidates: [{ id, title }] from the external index.
  function bestMatch(keys, candidates, threshold = 0.82) {
    const cleanKeys = [...new Set((keys || []).map((k) => String(k || "").trim()).filter(Boolean))];
    if (cleanKeys.length === 0 || !candidates || candidates.length === 0) return null;

    let best = null;
    for (const candidate of candidates) {
      const candidateTitle = candidate?.title;
      if (!candidateTitle) continue;
      // An optional per-candidate penalty lets the caller push down listings it can tell are the
      // wrong KIND of entry (an OVA or movie listing for a query about the main series), which
      // pure string similarity cannot distinguish - a short supplement title can out-score the
      // correct long one.
      const penalty = Number(candidate.penalty) || 0;
      for (const key of cleanKeys) {
        const score = similarity(key, candidateTitle) - penalty;
        if (!best || score > best.score) {
          best = { id: candidate.id, title: candidateTitle, score, matchedKey: key, penalty };
          if (score === 1) break;
        }
      }
      if (best?.score === 1) break;
    }

    if (!best || best.score < threshold) return null;
    best.kind = matchKind(best.matchedKey, best.title);
    // A match that only succeeded once the season/part tail was stripped means the external
    // database very likely lists the whole franchise as ONE absolute-numbered show while
    // an1me.to numbers per season. The caller MUST resolve an episode offset before projecting
    // episode numbers, or it gets the right show with the wrong episodes - which looks exactly
    // like a wrong match.
    best.seasonStripped = best.kind === "base";
    return best;
  }

  // "exact"   - identical once normalized
  // "variant" - identical once romanization is folded; same show, same numbering
  // "base"     - identical only after a season/part/year tail was stripped; numbering may differ
  // "fuzzy"    - matched on similarity alone
  function matchKind(left, right) {
    if (normalizeTitle(left) === normalizeTitle(right)) return "exact";
    const romajiLeft = romajiTitle(left);
    if (romajiLeft && romajiLeft === romajiTitle(right)) return "variant";
    const baseLeft = baseTitle(left);
    if (baseLeft && baseLeft === baseTitle(right)) return "base";
    return "fuzzy";
  }

  const exports = { normalizeTitle, baseTitle, tokenize, similarity, bestMatch, matchKind, romajiTitle, diceCoefficient, jaccardTokens };
  const root = typeof globalThis !== "undefined" ? globalThis : self;
  root.AnimeTrackerTitleMatch = exports;
  if (typeof window !== "undefined") {
    const AT = (window.AnimeTracker = window.AnimeTracker || {});
    AT.TitleMatch = exports;
  }
})();
