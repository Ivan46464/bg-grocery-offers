"""
Barcode (EAN-13 / EAN-8) lookup.

1. Exact: offers whose `barcode` equals the scanned code (Metro exposes GTINs,
   Kaufland's image URLs embed them for branded goods).
2. Otherwise resolve the code to a product name through Open Food Facts (free,
   no key) and fuzzy-search our offers by that name, so the user still gets
   "this is cheaper at X" even for stores that don't publish barcodes.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

import httpx

log = logging.getLogger("barcode")

OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
OFF_FIELDS = "product_name,product_name_bg,brands,quantity"
_EAN_RE = re.compile(r"^\d{8}$|^\d{12,14}$")


def is_valid_code(code: str) -> bool:
    return bool(_EAN_RE.match(code))


def lookup_product(code: str) -> Optional[dict]:
    """
    Resolve a barcode through Open Food Facts.
    Returns {"name": "Кока-Кола", "brand": "Coca-Cola", "quantity": "330 ml", "label": "Coca-Cola Кока-Кола 330 ml"}
    or None when unknown.
    """
    try:
        r = httpx.get(
            OFF_URL.format(code=code),
            params={"fields": OFF_FIELDS},
            timeout=8,
            headers={"User-Agent": "bg-grocery-offers/1.0 (github.com/Ivan46464/bg-grocery-offers)"},
        )
        if r.status_code != 200:
            return None
        p = r.json().get("product") or {}
        name = (p.get("product_name_bg") or p.get("product_name") or "").strip()
        if not name:
            return None
        # "COCA-COLA SERVICES SA/NV" -> "COCA-COLA": keep the first brand, drop legal suffixes
        brand = re.split(r"\s+(?:services|sa/nv|s\.?a\.?|ltd|gmbh|ead|ood|еад|оод)\b", p.get("brands", "").split(",")[0].strip(), flags=re.I)[0].strip()
        quantity = (p.get("quantity") or "").strip()
        return {
            "name": name,
            "brand": brand,
            "quantity": quantity,
            "label": " ".join(x for x in (brand, name, quantity) if x),
        }
    except Exception as exc:  # noqa: BLE001
        log.info("OFF lookup failed for %s: %s", code, exc)
        return None


def search_queries(product: dict) -> list[str]:
    """Several ways to find the same product in our offers: brand+name, name, brand."""
    name, brand = product.get("name", ""), product.get("brand", "")
    q = [f"{brand} {name}".strip(), name, brand]
    seen: set[str] = set()
    return [x for x in q if x and len(x) >= 3 and not (x.lower() in seen or seen.add(x.lower()))]


def extract_ean(text: Optional[str]) -> Optional[str]:
    """Pull a 13-digit EAN out of e.g. 'https://kaufland.media.schwarz/is/image/schwarz/5011026108033_BG_P'."""
    if not text:
        return None
    m = re.search(r"(?<!\d)(\d{13})(?!\d)", text)
    return m.group(1) if m else None
