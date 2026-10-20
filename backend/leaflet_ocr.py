"""
Kaufland leaflet OCR -> data/kaufland_leaflet.json

Why: kaufland.bg's offer page lists ~850 products, but the printed leaflet has
more (Halloween sweets, deli brands, weekend deals...). The leaflet viewer
(leaflets.kaufland.com) exposes page images through a JSON API but no product
list, so we OCR the pages ourselves with RapidOCR (Cyrillic PP-OCRv5 model).

Run:   python leaflet_ocr.py [--out ../data/kaufland_leaflet.json] [--flyer BG_bg_KDZ_1400_BG43-LFT]
       (CPU only, ~7 s per page; a full leaflet of ~60 pages takes ~7 min)

This runs in GitHub Actions twice a week (.github/workflows/leaflet-ocr.yml)
and commits the JSON; the API fetches the raw file and merges leaflet-only
products into the Kaufland offers (see scraper.KauflandScraper._merge_leaflet).

Layout heuristics (see page images): every product cell has a price box
  [-38%] (badge, tall)  /  2.59 (old, small)  /  1.59 (new, big, red)
and the product text (BRAND / description lines / size) sits LEFT of the box,
starting at the badge's row. We find each big price, grab the old price and
badge above it, then collect text boxes to the left within the cell's rows.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import logging
import re
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

log = logging.getLogger("leaflet_ocr")

API = "https://endpoints.leaflets.schwarz/v4"
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json", "Origin": "https://leaflets.kaufland.com", "Referer": "https://leaflets.kaufland.com/"}
DOMAIN = "https://leaflets.kaufland.com"
REGION = "1400"              # Kaufland region code (all regions had identical pages when checked)

PRICE_RE = re.compile(r"^\d{1,3}[.,]\d{2}$")
BADGE_RE = re.compile(r"^-\s?\d{1,2}\s?%$")
SIZE_FIX_RE = re.compile(r"(\d+)\s*[рrp]\b")      # OCR reads "г" as "р"/"r"/"p": "150р" -> "150 г"
NOISE_RE = re.compile(r"^(от понеделник|от четвъртък|валидно|само с|kaufland card|xtra|топ цена|нова|ново|\d{1,2}\.\d{1,2}\.?)$", re.I)


# --------------------------------------------------------------------------- #
# Flyer discovery
# --------------------------------------------------------------------------- #
def get_flyer(identifier: str) -> Optional[dict]:
    r = httpx.get(f"{API}/flyer", params={"flyer_identifier": identifier, "domain_url": DOMAIN}, headers=HEADERS, timeout=60)
    if r.status_code != 200:
        return None
    d = r.json()
    return d.get("flyer") if d.get("success") else None


def discover_flyers(explicit: Optional[str] = None) -> list[dict]:
    """
    Current + next ISO week main leaflets (identifier encodes the week: BG43 = week 43),
    plus every flyer the viewer lists as related (XTRA, weekend, campaigns).
    """
    today = dt.date.today()
    ids: list[str] = [explicit] if explicit else []
    for delta in (0, 7):
        week = (today + dt.timedelta(days=delta)).isocalendar()[1]
        ids.append(f"BG_bg_KDZ_{REGION}_BG{week:02d}-LFT")
    flyers: dict[str, dict] = {}
    queue = list(dict.fromkeys(ids))
    while queue:
        ident = queue.pop(0)
        if ident in flyers:
            continue
        f = get_flyer(ident)
        if not f:
            continue
        flyers[ident] = f
        for rel in f.get("relatedFlyers") or []:
            # url like https://leaflets.kaufland.com/bg-BG/BG_bg_KDZ_1400_BG43-XTRA/...
            m = re.search(r"/bg-BG/([A-Za-z0-9_-]+)", rel.get("url") or "")
            if m and m.group(1) not in flyers:
                queue.append(m.group(1))
    # keep only flyers whose offer window touches today..+10 days; regional copies
    # (BG_bg_KDZ_1400_... vs BG_bg_KDZ_1000_...) have identical pages -> keep one
    out = []
    seen_variants: set[tuple] = set()
    for ident, f in flyers.items():
        start = dt.date.fromisoformat(f.get("offerStartDate") or f["startDate"])
        end = dt.date.fromisoformat(f.get("offerEndDate") or f["endDate"])
        if not (end >= today and start <= today + dt.timedelta(days=10)):
            continue
        variant = (re.sub(r"_\d{4}_", "_", ident), f["title"], len(f.get("pages") or []))
        if variant in seen_variants:
            continue
        seen_variants.add(variant)
        f["_identifier"] = ident
        out.append(f)
    return out


# --------------------------------------------------------------------------- #
# OCR
# --------------------------------------------------------------------------- #
_engine = None


def engine():
    global _engine
    if _engine is None:
        from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR

        _engine = RapidOCR(params={"Rec.lang_type": LangRec.CYRILLIC, "Rec.ocr_version": OCRVersion.PPOCRV5, "Rec.model_type": ModelType.MOBILE})
    return _engine


def ocr_boxes(image_bytes: bytes) -> list[dict]:
    import numpy as np
    from PIL import Image

    img = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    res = engine()(img)
    boxes = []
    if res.boxes is None:
        return boxes
    for b, tx, sc in zip(res.boxes, res.txts, res.scores):
        xs = [p[0] for p in b]
        ys = [p[1] for p in b]
        boxes.append({"x0": float(min(xs)), "x1": float(max(xs)), "y0": float(min(ys)), "y1": float(max(ys)), "h": float(max(ys) - min(ys)), "t": tx.strip(), "s": float(sc)})
    return boxes


def parse_num(t: str) -> float:
    return float(t.replace(",", "."))


_JUNK_RE = re.compile(
    r"\b\d{1,3}[.,]\d{2}\*?|\*|-\s?\d{1,2}\s?%|\S*BG-KW\S*|топ\s?цена|от свежата витрина|от нашата пекарна|kaufland card|xtra|само с карта|"
    r"\bот\s+\d{1,2}\.\d{1,2}\.?|\bпон\w*|\bвтор\w*|\bсряд\w*|\bчетв\w*|\bпет\w*к\b|\bсъбот\w*|\bнедел\w*|\bHOBO\b",
    re.I,
)
_MIXED_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*[А-Яа-я])\S+$")   # "ВИТРИNА" - Latin+Cyrillic in one token = misread


def clean_name(raw: str) -> str:
    """Drop stray prices/badges/marketing words the OCR picks up around a product, fix unit misreads."""
    name = _JUNK_RE.sub(" ", raw)
    name = " ".join(w for w in name.split() if not (_MIXED_RE.match(w) and len(w) > 2))
    name = SIZE_FIX_RE.sub(r"\1 г", name)
    name = re.sub(r"\b[kк]r\b", "кг", name, flags=re.I)
    name = re.sub(r"\bcm\b", "см", name, flags=re.I)
    name = re.sub(r"\s+", " ", name).strip(" -·,/+:")
    return name


def extract_products(boxes: list[dict]) -> list[dict]:
    """Pair every big price with its old price / badge and the text block to its left."""
    prices = [b for b in boxes if PRICE_RE.match(b["t"].replace(" ", ""))]
    if not prices:
        return []
    big_h = sorted(b["h"] for b in prices)[len(prices) // 2]      # median height
    new_prices = [b for b in prices if b["h"] >= big_h * 0.9 and b["h"] >= 24]
    used: set[int] = set()
    items = []
    for np_ in sorted(new_prices, key=lambda b: (b["y0"], b["x0"])):
        cx = (np_["x0"] + np_["x1"]) / 2
        # old price: smaller price box directly above (same column), within 45 px
        # boxes of stacked prices overlap by a few px, hence the negative lower bound
        old = None
        for b in prices:
            if b is np_ or b["h"] >= np_["h"] * 0.95:
                continue
            if abs((b["x0"] + b["x1"]) / 2 - cx) < 60 and -15 < np_["y0"] - b["y1"] < 45 and b["y0"] < np_["y0"]:
                old = b
                break
        badge = None
        top = (old or np_)["y0"]
        for b in boxes:
            if BADGE_RE.match(b["t"].replace(" ", "")) and abs((b["x0"] + b["x1"]) / 2 - cx) < 80 and -15 <= top - b["y1"] < 60 and b["y0"] < top:
                badge = b
                break
        cell_top = (badge or old or np_)["y0"] - 8
        cell_bottom = np_["y1"] + 45
        left_edge = (badge or np_)["x0"]
        # name block: text left of the price box, inside the cell's rows
        words = []
        for b in boxes:
            if id(b) in used or b is np_ or b is old or b is badge:
                continue
            if PRICE_RE.match(b["t"].replace(" ", "")) or BADGE_RE.match(b["t"].replace(" ", "")):
                continue
            if b["x1"] <= left_edge + 6 and b["x0"] >= left_edge - 270 and cell_top <= b["y0"] <= cell_bottom:
                words.append(b)
        if not words:
            # fallback: text block directly above the price box
            for b in boxes:
                if id(b) in used or PRICE_RE.match(b["t"].replace(" ", "")) or BADGE_RE.match(b["t"].replace(" ", "")):
                    continue
                if abs((b["x0"] + b["x1"]) / 2 - cx) < 120 and 0 < cell_top - b["y1"] < 130:
                    words.append(b)
        words.sort(key=lambda b: (round(b["y0"] / 12), b["x0"]))
        parts = [w["t"] for w in words if w["s"] >= 0.5 and not NOISE_RE.match(w["t"].strip())]
        name = clean_name(" ".join(parts))
        if len(name) < 8 or not re.search(r"[A-Za-zА-Яа-я]{4}", name):
            continue
        for w in words:
            used.add(id(w))
        price = parse_num(np_["t"].replace(" ", ""))
        old_price = parse_num(old["t"].replace(" ", "")) if old else None
        if old_price is not None and old_price <= price:
            old_price = None                                   # misread; don't claim a fake discount
        items.append({
            "name": name[:120],
            "price": price,
            "old_price": old_price,
            "discount": int(re.sub(r"\D", "", badge["t"])) if badge else None,
            "y": int(np_["y0"]), "x": int(np_["x0"]),
        })
    return items


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def run(out: Path, explicit: Optional[str], max_pages: Optional[int]) -> dict:
    flyers = discover_flyers(explicit)
    log.info("flyers: %s", [(f["_identifier"], f["title"]) for f in flyers])
    offers = []
    meta = []
    for f in flyers:
        start = f.get("offerStartDate") or f["startDate"]
        end = f.get("offerEndDate") or f["endDate"]
        pages = f.get("pages") or []
        meta.append({"identifier": f["_identifier"], "title": f["title"], "valid_from": start, "valid_to": end, "pages": len(pages)})
        for p in pages[: max_pages or None]:
            url = p.get("image")
            if not url:
                continue
            try:
                img = httpx.get(url, headers={"User-Agent": "Mozilla/5.0", "Referer": DOMAIN}, timeout=60).content
                t = time.time()
                items = extract_products(ocr_boxes(img))
                log.info("%s page %d: %d products (%.1fs)", f["_identifier"], p["number"], len(items), time.time() - t)
            except Exception as exc:  # noqa: BLE001
                log.warning("%s page %s failed: %s", f["_identifier"], p.get("number"), exc)
                continue
            page_url = f"{DOMAIN}/bg-BG/{f['_identifier']}/view/flyer/page/{p['number']}"
            for it in items:
                offers.append({**it, "flyer": f["_identifier"], "page": p["number"], "page_url": page_url, "page_image": p.get("thumbnail") or url, "valid_from": start, "valid_to": end})
    data = {"generated": dt.datetime.now(dt.timezone.utc).isoformat(), "store": "Kaufland", "flyers": meta, "offers": offers}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info("wrote %d offers from %d flyers -> %s", len(offers), len(meta), out)
    return data


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data" / "kaufland_leaflet.json"))
    ap.add_argument("--flyer", default=None, help="explicit flyer identifier, e.g. BG_bg_KDZ_1400_BG43-LFT")
    ap.add_argument("--max-pages", type=int, default=None, help="for quick tests")
    a = ap.parse_args()
    run(Path(a.out), a.flyer, a.max_pages)
