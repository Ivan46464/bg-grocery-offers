"""
Product catalog search - lets the app pick a SPECIFIC product (with picture)
for the cart and the watchlist instead of a free-text word like "cheese".

Sources, merged and de-duplicated by normalised name:
  1. Current offers from all four stores (have images, barcodes, prices).
  2. METRO's full article catalogue (shop.metro.bg search without the promo
     filter) - ~tens of thousands of branded products with image + EAN, so a
     product that is NOT on promotion this week can still be chosen and
     watched. Results are cached for an hour per query.

Matching a chosen product against offers later (cart / watch) uses the EAN
when both sides have one, otherwise a strict fuzzy match on the product's
"core" words (brand + product, sizes stripped) - see `core_query()`.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Optional

import httpx
from rapidfuzz import fuzz

from models import CatalogItem, Offer, name_key
from search import query_variants, score_offer, search_offers

log = logging.getLogger("catalog")

_UNIT_RE = re.compile(r"^(\d+([.,]\d+)?|\d+[xх]\d+|г|гр|кг|мл|л|бр|бр\.|x|х|см|мм|%|ml|l|kg|g|pcs|за|от|и|или|с|със|в|на|по|различни|видове|вид|асорти|опаковка|оп\.)$", re.I)
STRICT_THRESHOLD = 85


def core_query(product_name: str, max_words: int = 4) -> str:
    """'ДИМИТЪР МАДЖАРОВ Кашкавал БДС от краве мляко 380 г' -> 'димитър маджаров кашкавал бдс'."""
    words = [w for w in re.split(r"[\s,;()/]+", product_name.lower()) if w and not _UNIT_RE.match(w)]
    return " ".join(words[:max_words]) or product_name.lower()


def _coverage(words: list[str], product_name: str) -> float:
    """Share of `words` that appear (fuzzily) as a word of `product_name`."""
    tokens = [t for t in re.split(r"[\s,;()/]+", product_name.lower()) if t]
    found = 0
    for w in words:
        if any(t == w or t.startswith(w) or w.startswith(t) and len(t) >= 4 or fuzz.ratio(w, t) >= 85 for t in tokens):
            found += 1
    return found / len(words) if words else 0.0


def match_offers(offers: list[Offer], name: str, barcode: Optional[str] = None, threshold: int = STRICT_THRESHOLD) -> list[tuple[Offer, int]]:
    """Offers that are (very likely) the same product. Cheapest first."""
    hits: list[tuple[Offer, int]] = []
    if barcode:
        hits = [(o, 100) for o in offers if o.barcode and o.barcode.lstrip("0") == barcode.lstrip("0")]
    if not hits:
        q = core_query(name)
        words = q.split()
        variants = query_variants(q)
        for o in offers:
            s = score_offer(o.product_name, variants)
            if s < threshold:
                continue
            # Most core words (brand included) must appear in the offer name:
            # "milka шоколад млечен" must not match a plain "МЛЕЧЕН Шоколад".
            if _coverage(words, o.product_name) < (1.0 if len(words) <= 2 else 0.75):
                continue
            hits.append((o, int(s)))
    hits.sort(key=lambda t: (t[0].effective_price or t[0].discounted_price, -t[1]))
    return hits


# --------------------------------------------------------------------------- #
# METRO catalogue
# --------------------------------------------------------------------------- #
METRO_SEARCH = "https://shop.metro.bg/searchdiscover/articlesearch/search"
METRO_VARIANTS = "https://shop.metro.bg/evaluate.article.v1/betty-variants"
METRO_STORE = "00010"
_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36", "Accept-Language": "bg-BG"}
_cache: dict[str, tuple[float, list[CatalogItem]]] = {}
CACHE_TTL = 3600


def metro_catalog(q: str, rows: int = 12) -> list[CatalogItem]:
    key = q.lower().strip()
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL:
        return cached[1]
    items: list[CatalogItem] = []
    try:
        with httpx.Client(headers=_HEADERS, timeout=15) as client:
            params = {"storeId": METRO_STORE, "language": "bg-BG", "country": "BG", "query": q, "rows": rows, "page": 1, "facets": "false", "categories": "false"}
            ids = client.get(METRO_SEARCH, params=params).json().get("resultIds") or []
            if ids:
                vparams = [("ids", i) for i in ids] + [("storeIds", METRO_STORE), ("country", "BG"), ("locale", "bg-BG")]
                data = client.get(METRO_VARIANTS, params=vparams).json()
                for article in (data.get("result") or {}).values():
                    for variant in (article.get("variants") or {}).values():
                        for bundle in (variant.get("bundles") or {}).values():
                            name = (bundle.get("description") or "").strip()
                            if not name:
                                continue
                            gtins = [g.get("number", "") for g in (bundle.get("gtins") or [])]
                            ean = next((g for g in gtins if g.isdigit() and len(g) in (8, 12, 13, 14)), None)
                            price = ((bundle.get("stores") or {}).get(METRO_STORE) or {}).get("sellingPriceInfo", {}).get("grossPrice")
                            items.append(CatalogItem(name=name, image_url=bundle.get("imageUrlL"), barcode=ean, source="catalog", store="Metro", price=price))
                            break  # one bundle per variant is enough
    except Exception as exc:  # noqa: BLE001
        log.info("metro catalog lookup failed for %r: %s", q, exc)
    _cache[key] = (time.time(), items)
    return items


def catalog_search(offers: list[Offer], q: str, limit: int = 20) -> list[CatalogItem]:
    """Current offers first (they have prices), then catalogue items not already covered."""
    out: list[CatalogItem] = []
    seen: set[str] = set()
    for o, s in search_offers(offers, q, sort="score"):
        k = o.barcode or name_key(o.product_name)
        if k in seen:
            continue
        seen.add(k)
        out.append(CatalogItem(name=o.product_name, image_url=o.image_url, barcode=o.barcode, source="offer", store=o.store,
                               price=o.effective_price or o.discounted_price, offer_id=o.id, score=s))
        if len(out) >= limit:
            return out
    for it in metro_catalog(q):
        k = it.barcode or name_key(it.name)
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
        if len(out) >= limit:
            break
    return out
