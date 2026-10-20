/** Small helpers shared by screens. */

const UNIT_RE = /^(\d+([.,]\d+)?|г|гр|кг|мл|л|бр|бр\.|x|х|см|мм|%|ml|l|kg|g|pcs)$/i;

/**
 * Turn "DIMITAR MADJAROV Кашкавал БДС от краве мляко 380 г" into a short search
 * term like "кашкавал бдс от" - good enough for the cart / watchlist, where the
 * user can edit it anyway.
 */
export function shortQuery(productName) {
  const words = productName
    .replace(/[,;()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !UNIT_RE.test(w));
  // drop an ALL-CAPS brand prefix ("PILOS", "THE CHEFS") when there's more after it
  let i = 0;
  while (i < words.length - 1 && words[i] === words[i].toUpperCase() && /[A-ZА-Я]/.test(words[i])) i++;
  const core = words.slice(i, i + 3);
  return (core.length ? core : words.slice(0, 3)).join(" ").toLowerCase();
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
