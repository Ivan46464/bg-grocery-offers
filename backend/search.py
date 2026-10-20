"""
Fuzzy product search.

Why not plain SQL LIKE?
  * Users type "сирене" and expect "Краве сирене Родна стряха" (word inside name)
  * ... or "кашкавл" (typo), or "cheese" (English), or "sirene" (Latin letters).

Strategy per query:
  1. Build query variants: the raw text, a Cyrillic transliteration if it was
     typed in Latin letters, and Bulgarian synonyms for common English words.
  2. Score every offer name with RapidFuzz (partial_ratio + token_set_ratio).
  3. Keep offers above a threshold, then sort by lowest price (API default).

Offers are loaded into memory on each request - with a few thousand rows this
is well under a millisecond and keeps the code trivial.
"""
from __future__ import annotations

import re
from typing import Iterable

from rapidfuzz import fuzz

from models import Offer

# English -> Bulgarian search terms. Extend freely.
SYNONYMS: dict[str, list[str]] = {
    "cheese": ["сирене", "кашкавал"],
    "white cheese": ["сирене"],
    "yellow cheese": ["кашкавал"],
    "milk": ["мляко"],
    "yogurt": ["кисело мляко", "йогурт"],
    "yoghurt": ["кисело мляко", "йогурт"],
    "butter": ["масло"],
    "eggs": ["яйца"],
    "egg": ["яйца"],
    "bread": ["хляб"],
    "chicken": ["пиле", "пилешк"],
    "pork": ["свинск"],
    "beef": ["телешк", "говежд"],
    "fish": ["риба", "сьомга"],
    "salmon": ["сьомга"],
    "ham": ["шунка"],
    "salami": ["салам"],
    "coffee": ["кафе"],
    "beer": ["бира"],
    "wine": ["вино"],
    "water": ["вода"],
    "oil": ["олио"],
    "sugar": ["захар"],
    "rice": ["ориз"],
    "chocolate": ["шоколад"],
    "apples": ["ябълки"],
    "apple": ["ябълк"],
    "bananas": ["банани"],
    "banana": ["банан"],
    "tomatoes": ["домати"],
    "tomato": ["домат"],
    "cucumbers": ["краставици"],
    "cucumber": ["краставиц"],
    "potatoes": ["картофи"],
    "potato": ["картоф"],
    "mozzarella": ["моцарела"],
}

# Minimal Latin -> Cyrillic transliteration (longest sequences first).
_TRANSLIT = [
    ("sht", "щ"), ("zh", "ж"), ("ch", "ч"), ("sh", "ш"), ("yu", "ю"), ("ya", "я"), ("ts", "ц"),
    ("a", "а"), ("b", "б"), ("v", "в"), ("g", "г"), ("d", "д"), ("e", "е"), ("z", "з"),
    ("i", "и"), ("y", "й"), ("k", "к"), ("l", "л"), ("m", "м"), ("n", "н"), ("o", "о"),
    ("p", "п"), ("r", "р"), ("s", "с"), ("t", "т"), ("u", "у"), ("f", "ф"), ("h", "х"),
    ("c", "ц"), ("w", "в"), ("x", "кс"), ("q", "к"), ("j", "й"),
]

MATCH_THRESHOLD = 75  # 0-100; lower = more results, more noise


def _has_cyrillic(text: str) -> bool:
    return any("Ѐ" <= ch <= "ӿ" for ch in text)


def transliterate(text: str) -> str:
    out = text.lower()
    for lat, cyr in _TRANSLIT:
        out = out.replace(lat, cyr)
    return out


def query_variants(q: str) -> list[str]:
    """All the strings we will try to match against a product name."""
    # "Coca-Cola" / "кисело-мляко" -> "coca cola": punctuation becomes a word break
    q = " ".join(_TOKEN_RE.split(q.strip().lower())).strip()
    variants = [q]
    if q in SYNONYMS:
        variants += SYNONYMS[q]
    else:
        # multi-word English query: translate each known word
        for word in q.split():
            variants += SYNONYMS.get(word, [])
    if not _has_cyrillic(q):
        variants.append(transliterate(q))
    # de-dup, keep order
    seen: set[str] = set()
    return [v for v in variants if v and not (v in seen or seen.add(v))]


_TOKEN_RE = re.compile(r"[^\w]+", re.UNICODE)


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.split(text.lower()) if t]


def score_offer(name: str, variants: Iterable[str]) -> int:
    """
    Best 0-100 similarity between any query variant and the product name.

    Single-word query  -> compared word-by-word against the name:
        exact / prefix / substring hit = 100  ("сирене" in "Краве сирене" ; "домат" in "доматен")
        otherwise fuzz.ratio for typo tolerance ("кашкавл" ~ "кашкавал" = 93)
      Comparing whole words (not partial_ratio on the full string) is what keeps
      "кафе" from matching "канела" and "шунка" from matching "тунквана".
    Multi-word query   -> token_set_ratio, so word order doesn't matter.
    """
    tokens = _tokens(name)
    name_norm = " ".join(tokens)
    best = 0
    for v in variants:
        if " " in v:
            s = fuzz.token_set_ratio(v, name_norm)
        else:
            s = 0
            for t in tokens:
                if t == v or (len(v) >= 3 and t.startswith(v)) or (len(v) >= 4 and v in t):
                    s = 100
                    break
                if len(v) >= 5:
                    s = max(s, fuzz.ratio(v, t))
        best = max(best, int(s))
    return best


def sort_hits(hits: list[tuple[Offer, int]], sort: str) -> list[tuple[Offer, int]]:
    if sort == "score":
        hits.sort(key=lambda t: (-t[1], t[0].discounted_price))
    elif sort == "discount":
        hits.sort(key=lambda t: (-(t[0].discount_percent or 0), t[0].discounted_price))
    else:  # price
        hits.sort(key=lambda t: (t[0].discounted_price, -t[1]))
    return hits


def search_offers(
    offers: list[Offer],
    q: str,
    *,
    sort: str = "price",
    threshold: int = MATCH_THRESHOLD,
) -> list[tuple[Offer, int]]:
    """
    Return [(offer, score), ...] for offers matching `q`.
    sort = "price" (default, cheapest first) | "score" | "discount"
    """
    variants = query_variants(q)
    scored = [(o, score_offer(o.product_name, variants)) for o in offers]
    return sort_hits([(o, s) for o, s in scored if s >= threshold], sort)
