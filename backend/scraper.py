"""
Store scrapers for Lidl, Kaufland, Billa and Metro (Bulgaria).

How this file is organised
--------------------------
* `ScrapedOffer`   - plain dataclass a scraper produces (no DB knowledge).
* `BaseScraper`    - shared HTTP client, price parsing, error handling.
                     `fetch()` NEVER raises; on failure it logs and returns [].
* One subclass per store. Each has an UPPER_CASE config block at the top of the
  class (URL + CSS selectors / JSON keys). When a store redesigns its site,
  open the page in Chrome DevTools, find the new selectors and edit ONLY that
  block.
* `MOCK_OFFERS`    - realistic demo data per store. `run_all_scrapers()` falls
                     back to it whenever a real scraper returns nothing, and
                     flags those rows with `is_mock=True` so the app can show a
                     "demo data" hint.

Prices are in EUR (Bulgaria switched from BGN to EUR on 1 Jan 2026).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from sqlmodel import Session, delete, select

from barcode import extract_ean
from history import annotate_lowest_90d, prune_history, record_history
from models import Offer, name_key
from tags import derive_tags, tags_to_str

log = logging.getLogger("scraper")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    ),
    "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8",
    "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
}
TIMEOUT_SECONDS = 25


# --------------------------------------------------------------------------- #
# Data shape produced by every scraper
# --------------------------------------------------------------------------- #
@dataclass
class ScrapedOffer:
    store: str
    product_name: str
    discounted_price: float
    original_price: Optional[float] = None
    image_url: Optional[str] = None
    product_url: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    barcode: Optional[str] = None       # EAN-13 when the store exposes it


_PRICE_RE = re.compile(r"(\d+(?:[.,]\d{1,2})?)")


def parse_price(text: Optional[str]) -> Optional[float]:
    """
    Turn '12,99 €', '€12.99', '12.99 лв.' or '  12,99 ' into 12.99.
    Returns None when no number is found.
    """
    if not text:
        return None
    text = str(text).replace("\xa0", " ").strip()
    # Some sites render "1299" with the decimals in a <sup>; handle "12 99" too.
    m = re.search(r"(\d+)\s+(\d{2})\b", text)
    if m and "," not in text and "." not in text:
        return float(f"{m.group(1)}.{m.group(2)}")
    m = _PRICE_RE.search(text)
    if not m:
        return None
    try:
        return round(float(m.group(1).replace(",", ".")), 2)
    except ValueError:
        return None


def _clean(text: Optional[str]) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


_DATE_RANGE_RE = re.compile(
    r"(\d{1,2})\.(\d{1,2})\.?(?:\s*(\d{4}))?\s*(?:до|-|–)\s*(\d{1,2})\.(\d{1,2})\.?(?:\s*(\d{4}))?"
)


def parse_date_range(text: Optional[str]) -> tuple[Optional[date], Optional[date]]:
    """'Валидно от 19.10. до 25.10.' / 'от 15.10 до 21.10.2026' -> (date, date). Year defaults to this year."""
    m = _DATE_RANGE_RE.search(text or "")
    if not m:
        return None, None
    year = date.today().year
    try:
        d2 = date(int(m.group(6) or year), int(m.group(5)), int(m.group(4)))
        d1 = date(int(m.group(3) or d2.year), int(m.group(2)), int(m.group(1)))
        if d2 < d1:  # range crossing New Year
            d2 = d2.replace(year=d2.year + 1)
        return d1, d2
    except ValueError:
        return None, None


def _iso_date(value: Optional[str]) -> Optional[date]:
    """'2026-10-07T21:00:00Z' -> date(2026, 10, 7); None when missing/unparseable."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# Base class
# --------------------------------------------------------------------------- #
class BaseScraper:
    store: str = "Base"

    def fetch(self) -> list[ScrapedOffer]:
        """Public entry point. Swallows every error so one store can't break the run."""
        try:
            offers = [o for o in self._scrape() if o.product_name and o.discounted_price]
            log.info("%s: scraped %d offers", self.store, len(offers))
            return offers
        except Exception as exc:  # noqa: BLE001 - we really do want to catch everything
            log.warning("%s: scrape failed (%s: %s)", self.store, type(exc).__name__, exc)
            return []

    def _scrape(self) -> list[ScrapedOffer]:  # pragma: no cover - overridden
        raise NotImplementedError

    @staticmethod
    def _get(url: str) -> httpx.Response:
        with httpx.Client(headers=HEADERS, timeout=TIMEOUT_SECONDS, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            return resp

    @staticmethod
    def _soup(html: str) -> BeautifulSoup:
        return BeautifulSoup(html, "html.parser")

    @staticmethod
    def _text(node, selector: str) -> str:
        el = node.select_one(selector) if selector else None
        return _clean(el.get_text(" ")) if el else ""

    @staticmethod
    def _attr(node, selector: str, *attrs: str) -> Optional[str]:
        el = node.select_one(selector) if selector else None
        if not el:
            return None
        for a in attrs:
            if el.get(a):
                return el.get(a)
        return None


# --------------------------------------------------------------------------- #
# Lidl - every product tile on lidl.bg carries a `data-grid-data` attribute
# with the full product JSON (title, price, oldPrice, image, validity dates).
# We fetch a handful of category/campaign pages and merge the tiles.
# To add more, open https://www.lidl.bg, hover a menu entry and copy its /c/... path.
# --------------------------------------------------------------------------- #
class LidlScraper(BaseScraper):
    store = "Lidl"

    # --- CONFIG ------------------------------------------------------------
    BASE_URL = "https://www.lidl.bg"
    PAGES = [
        "/c/khrani-i-napitki/s10068374",       # Храни и напитки
        "/c/plodove-i-zelenchutsi/a10074998",  # Плодове и зеленчуци
        "/c/svalyame-tsenite/a10048470",       # Сваляме цените
        "/c/aktsiya/a10104729",                # Акция
        "/c/sedmitsa-xxl/a10104730",           # Седмица XXL
        "/c/lidl-plus-promotsii/a10039565",    # Lidl Plus промоции
    ]
    TILE_ATTR = "data-grid-data"
    KEYS = {
        "id": "productId",
        "title": "fullTitle",          # fallback: "title"
        "price_obj": "price",
        "price": "price",
        "old_price": "oldPrice",
        "image": "image",
        "url": "canonicalUrl",
    }
    # ----------------------------------------------------------------------

    def _scrape(self) -> list[ScrapedOffer]:
        offers: dict[str, ScrapedOffer] = {}   # productId -> offer (dedupe across pages)
        k = self.KEYS
        for path in self.PAGES:
            try:
                html = self._get(self.BASE_URL + path).text
            except httpx.HTTPError as exc:
                log.warning("Lidl: %s skipped (%s)", path, exc)
                continue
            soup = self._soup(html)
            for el in soup.select(f"[{self.TILE_ATTR}]"):
                try:
                    item = json.loads(el[self.TILE_ATTR])
                except (json.JSONDecodeError, KeyError):
                    continue
                price_obj = item.get(k["price_obj"]) or {}
                new_price = price_obj.get(k["price"])
                if not new_price:
                    continue
                old_price = price_obj.get(k["old_price"]) or None
                pid = str(item.get(k["id"]) or item.get(k["url"]) or item.get(k["title"]))
                valid_from, valid_to = self._validity(item)
                offers[pid] = ScrapedOffer(
                    store=self.store,
                    product_name=_clean(item.get(k["title"]) or item.get("title")),
                    discounted_price=float(new_price),
                    original_price=float(old_price) if old_price else None,
                    image_url=item.get(k["image"]),
                    product_url=self.BASE_URL + item[k["url"]] if item.get(k["url"]) else None,
                    valid_from=valid_from,
                    valid_to=valid_to,
                )
        return list(offers.values())

    @staticmethod
    def _validity(item: dict) -> tuple[Optional[date], Optional[date]]:
        """Lidl stores validity as unix timestamps under stockAvailability.badgeInfoV2[0]."""
        try:
            info = item["stockAvailability"]["badgeInfoV2"][0]
            return (
                datetime.fromtimestamp(info["validFrom"]).date(),
                datetime.fromtimestamp(info["validUntil"]).date(),
            )
        except (KeyError, IndexError, TypeError, ValueError):
            start, end = item.get("storeStartDate"), item.get("storeEndDate")
            if start and end:
                return datetime.fromtimestamp(start).date(), datetime.fromtimestamp(end).date()
            return None, None


# --------------------------------------------------------------------------- #
# Kaufland - one big server-rendered page with ~1000+ offer tiles grouped in
# sections; each section's subheadline says "Валидно от 19.10. до 25.10.".
# --------------------------------------------------------------------------- #
class KauflandScraper(BaseScraper):
    store = "Kaufland"

    # --- CONFIG ------------------------------------------------------------
    URLS = [
        "https://www.kaufland.bg/aktualni-predlozheniya/oferti.html?kloffer-week=current",
        # "https://www.kaufland.bg/aktualni-predlozheniya/oferti.html?kloffer-week=next",
    ]
    BASE_URL = "https://www.kaufland.bg"
    SEL = {
        "section": ".k-product-section",
        "section_dates": ".k-product-section__subheadline",
        "tile": ".k-product-tile",
        "title": ".k-product-tile__title",
        "subtitle": ".k-product-tile__subtitle",
        "unit": ".k-product-tile__unit-price",
        "price": ".k-price-tag__price",
        "old_price": ".k-price-tag__old-price",
        "image": "img.k-product-tile__main-image",
    }
    # ----------------------------------------------------------------------

    def _scrape(self) -> list[ScrapedOffer]:
        offers: list[ScrapedOffer] = []
        seen: set[tuple[str, float]] = set()
        for url in self.URLS:
            soup = self._soup(self._get(url).text)
            sections = soup.select(self.SEL["section"]) or [soup]
            for section in sections:
                valid_from, valid_to = parse_date_range(self._text(section, self.SEL["section_dates"]))
                for tile in section.select(self.SEL["tile"]):
                    title = self._text(tile, self.SEL["title"])
                    subtitle = self._text(tile, self.SEL["subtitle"])
                    unit = self._text(tile, self.SEL["unit"])
                    price = parse_price(self._text(tile, self.SEL["price"]))
                    if not title or price is None:
                        continue
                    name = _clean(" ".join(p for p in (title, subtitle, unit) if p))
                    if (name, price) in seen:          # the same tile is repeated in several sections
                        continue
                    seen.add((name, price))
                    href = tile.get("href") if tile.name == "a" else self._attr(tile, "a", "href")
                    image = self._attr(tile, self.SEL["image"], "src", "data-src")
                    offers.append(
                        ScrapedOffer(
                            store=self.store,
                            product_name=name,
                            discounted_price=price,
                            original_price=parse_price(self._text(tile, self.SEL["old_price"])),
                            image_url=image,
                            product_url=(self.BASE_URL + href) if href and href.startswith("/") else (href if href and href != "#" else url),
                            valid_from=valid_from,
                            valid_to=valid_to,
                            barcode=extract_ean(image),   # branded goods: ".../5011026108033_BG_P"
                        )
                    )
        return offers


# --------------------------------------------------------------------------- #
# Billa - billa.bg has no product listing at all: /promocii is a Nuxt page that
# embeds the weekly leaflet as a Publitas flipbook (view.publitas.com/billa-bulgaria/...)
# whose hotspots are plain links and whose PDF is image-only (no text layer),
# so neither the site nor the PDF yields product names/prices without OCR.
#
# Choice: scrape https://broshuri.net, a Bulgarian leaflet aggregator that
# transcribes the current Billa leaflet into HTML product cards (name, unit,
# new price, old price, leaflet page) and prints the leaflet validity
# ("BILLA брошура от 15.10 до 21.10.2026"). It covers ~40 highlighted
# products per week, not the whole leaflet, but every row is a real offer.
# Alternative with a similar table (no old prices): moiatabroshura.bg/billa-katalozi.
# --------------------------------------------------------------------------- #
class BillaScraper(BaseScraper):
    store = "Billa"

    # --- CONFIG ------------------------------------------------------------
    BASE_URL = "https://broshuri.net"
    URL = "https://broshuri.net/billa"                                # leaflet page: dates + first 40 cards
    LIST_URL = "https://broshuri.net/oferti?store=billa&page={page}"  # paginated "all offers" list
    MAX_PAGES = 10
    SEL = {
        "tile": "article.p-card",
        "title": ".p-card__name",
        "unit": ".p-card__unit",                # "за 1 кг <strong>Кинг оферти</strong>" - <strong> is dropped
        "price": ".price .sr-only",             # "12,79 €"
        "old_price": ".p-card__old",
        "image": "img.p-card__img",
        "link": ".p-card__name a",
        "dates": "h1, h2, h3, .sh__title, p",   # any element whose text has "от 15.10 до 21.10.2026"
    }
    # ----------------------------------------------------------------------

    def _scrape(self) -> list[ScrapedOffer]:
        soup = self._soup(self._get(self.URL).text)
        valid_from, valid_to = self._leaflet_dates(soup)
        offers: dict[tuple[str, float], ScrapedOffer] = {}
        self._collect(soup, offers, valid_from, valid_to)
        for page in range(1, self.MAX_PAGES + 1):
            try:
                html = self._get(self.LIST_URL.format(page=page)).text
            except httpx.HTTPError as exc:
                log.warning("Billa: list page %d skipped (%s)", page, exc)
                break
            if self._collect(self._soup(html), offers, valid_from, valid_to) == 0:
                break
        return list(offers.values())

    def _collect(self, soup, offers: dict, valid_from, valid_to) -> int:
        """Add every product card in `soup` to `offers` (deduped by name+price); return the number of cards seen."""
        tiles = soup.select(self.SEL["tile"])
        for tile in tiles:
            title = self._text(tile, self.SEL["title"])
            price = parse_price(self._text(tile, self.SEL["price"]))
            if not title or price is None:
                continue
            unit_el = tile.select_one(self.SEL["unit"])
            if unit_el is not None:
                for label in unit_el.select("strong"):
                    label.decompose()
            unit = _clean(unit_el.get_text(" ")) if unit_el is not None else ""
            name = _clean(f"{title} {unit}") if unit else title
            key = (name, price)
            if key in offers:
                continue
            offers[key] = ScrapedOffer(
                store=self.store,
                product_name=name,
                discounted_price=price,
                original_price=parse_price(self._text(tile, self.SEL["old_price"])),
                image_url=self._absolute(self._attr(tile, self.SEL["image"], "data-src", "src")),
                product_url=self._absolute(self._attr(tile, self.SEL["link"], "href")) or self.URL,
                valid_from=valid_from,
                valid_to=valid_to,
            )
        return len(tiles)

    def _absolute(self, url: Optional[str]) -> Optional[str]:
        if not url:
            return None
        return self.BASE_URL + url if url.startswith("/") else url

    def _leaflet_dates(self, soup) -> tuple[Optional[date], Optional[date]]:
        for el in soup.select(self.SEL["dates"]):
            d1, d2 = parse_date_range(el.get_text(" "))
            if d1 and d2:
                return d1, d2
        return None, None


# --------------------------------------------------------------------------- #
# Metro - www.metro.bg/oferti/* are CMS pages with a handful of TV offers, but
# the real catalogue lives in the METRO marketplace (shop.metro.bg), a React
# app backed by two public JSON endpoints (found via DevTools > Network):
#   1. searchdiscover/articlesearch/search  - paginated article ids; the facet
#      `storeHasPromotion:MCRM` restricts it to articles on promotion.
#   2. evaluate.article.v1/betty-variants   - details + prices for a batch of ids:
#      result[article].variants[v].bundles[b].stores[STORE_ID].sellingPriceInfo
#      carries grossPrice (incl. VAT), grossStrikeThrough (old price) and
#      appliedPromotionInfo.startTime/endTime (validity).
# STORE_ID 00010 = МЕТРО София 1; promo prices are the same chain-wide.
# --------------------------------------------------------------------------- #
class MetroScraper(BaseScraper):
    store = "Metro"

    # --- CONFIG ------------------------------------------------------------
    API_URL = "https://shop.metro.bg/searchdiscover/articlesearch/search"
    VARIANTS_URL = "https://shop.metro.bg/evaluate.article.v1/betty-variants"
    PRODUCT_URL = "https://shop.metro.bg/shop/pv/{article}/{variant}/{bundle}"
    STORE_ID = "00010"
    COUNTRY, LOCALE = "BG", "bg-BG"
    PROMO_FILTER = "storeHasPromotion:MCRM"
    ROWS = 100            # ids per search page
    BATCH = 40            # ids per betty-variants request (keeps the URL short)
    MAX_PAGES = 20
    KEYS = {
        "items": "resultIds",
        "total_pages": "totalPages",
        "result": "result",
        "variants": "variants",
        "bundles": "bundles",
        "title": "description",
        "stores": "stores",
        "price_obj": "sellingPriceInfo",
        "price": "grossPrice",
        "old_price": "grossStrikeThrough",
        "promo": "appliedPromotionInfo",     # {"name", "price", "startTime", "endTime"}
        "image": "imageUrlL",
        "bundle_id": "bettyBundleId",        # {"articleNumber", "variantNumber", "bundleNumber"}
        "gtins": "gtins",                    # [{"number": "3800849224943"}] - real EANs are all digits
    }
    # ----------------------------------------------------------------------

    def _scrape(self) -> list[ScrapedOffer]:
        ids = self._promo_ids()
        offers: list[ScrapedOffer] = []
        for i in range(0, len(ids), self.BATCH):
            try:
                data = self._get(self._variants_url(ids[i:i + self.BATCH])).json()
            except (httpx.HTTPError, ValueError) as exc:
                log.warning("Metro: variants batch %d skipped (%s)", i // self.BATCH, exc)
                continue
            offers.extend(self._parse_variants(data))
        return offers

    def _promo_ids(self) -> list[str]:
        k = self.KEYS
        ids: list[str] = []
        page, total_pages = 1, 1
        while page <= total_pages and page <= self.MAX_PAGES:
            data = self._get(self._search_url(page)).json()
            ids.extend(data.get(k["items"]) or [])
            total_pages = int(data.get(k["total_pages"]) or 1)
            page += 1
        return list(dict.fromkeys(ids))

    def _search_url(self, page: int) -> str:
        params = {
            "storeId": self.STORE_ID, "language": self.LOCALE, "country": self.COUNTRY,
            "query": "*", "rows": self.ROWS, "page": page, "filter": self.PROMO_FILTER,
            "facets": "false", "categories": "false",
        }
        return str(httpx.URL(self.API_URL, params=params))

    def _variants_url(self, ids: list[str]) -> str:
        params = [("ids", i) for i in ids] + [
            ("storeIds", self.STORE_ID), ("country", self.COUNTRY), ("locale", self.LOCALE),
        ]
        return str(httpx.URL(self.VARIANTS_URL, params=params))

    def _parse_variants(self, data: dict) -> list[ScrapedOffer]:
        k = self.KEYS
        offers: list[ScrapedOffer] = []
        for article in (data.get(k["result"]) or {}).values():
            for variant in (article.get(k["variants"]) or {}).values():
                for bundle in (variant.get(k["bundles"]) or {}).values():
                    store = (bundle.get(k["stores"]) or {}).get(self.STORE_ID) or {}
                    price_obj = store.get(k["price_obj"]) or bundle.get(k["price_obj"]) or {}
                    price = price_obj.get(k["price"])
                    old_price = price_obj.get(k["old_price"])
                    promo = price_obj.get(k["promo"]) or {}
                    if not price or not (old_price or promo.get("name")):
                        continue    # under the promo facet but no promo price applied (e.g. voucher only)
                    bid = bundle.get(k["bundle_id"]) or {}
                    gtins = [g.get("number", "") for g in (bundle.get(k["gtins"]) or [])]
                    ean = next((g for g in gtins if g.isdigit() and len(g) in (8, 12, 13, 14)), None)
                    offers.append(
                        ScrapedOffer(
                            store=self.store,
                            product_name=_clean(bundle.get(k["title"])),
                            discounted_price=round(float(price), 2),
                            original_price=round(float(old_price), 2) if old_price else None,
                            image_url=bundle.get(k["image"]),
                            product_url=self.PRODUCT_URL.format(
                                article=bid.get("articleNumber", ""),
                                variant=bid.get("variantNumber", ""),
                                bundle=bid.get("bundleNumber", ""),
                            ) if bid.get("articleNumber") else None,
                            valid_from=_iso_date(promo.get("startTime")),
                            valid_to=_iso_date(promo.get("endTime")),
                            barcode=ean,
                        )
                    )
        return offers


SCRAPERS: list[BaseScraper] = [LidlScraper(), KauflandScraper(), BillaScraper(), MetroScraper()]
STORE_NAMES = [s.store for s in SCRAPERS]


# --------------------------------------------------------------------------- #
# Mock / demo data - used when a real scraper returns nothing.
# (name, new_price, old_price)
# --------------------------------------------------------------------------- #
_MOCK: dict[str, list[tuple[str, float, Optional[float]]]] = {
    "Lidl": [
        ("Краве сирене Pilos 400 г", 3.29, 4.19),
        ("Кашкавал от краве мляко Pilos 350 г", 4.49, 5.59),
        ("Прясно мляко Pilos 3% 1 л", 1.09, 1.39),
        ("Пилешко филе Pikok 1 кг", 5.99, 7.49),
        ("Банани 1 кг", 0.99, 1.29),
        ("Кафе на зърна Bellarom 1 кг", 8.99, 11.99),
        ("Хляб Селски 650 г", 0.89, 1.15),
        ("Яйца размер M 10 бр.", 1.79, 2.19),
        ("Бира Perlenbacher 0.5 л", 0.59, 0.79),
        ("Домати розови 1 кг", 1.49, 2.29),
    ],
    "Kaufland": [
        ("Краве сирене Родна стряха 700 г", 5.49, 7.29),
        ("Кашкавал Витоша 400 г", 4.99, 6.49),
        ("Кисело мляко Верея 3.6% 400 г", 0.69, 0.89),
        ("Свинска плешка без кост 1 кг", 3.99, 5.29),
        ("Телешко шол 1 кг", 9.99, 12.99),
        ("Олио Калиакра 1 л", 1.69, 2.19),
        ("Шунка Леки 350 г", 2.79, 3.59),
        ("Ябълки Златна превъзходна 1 кг", 0.99, 1.49),
        ("Минерална вода Девин 1.5 л", 0.39, 0.55),
        ("Шоколад Milka 100 г", 0.99, 1.39),
    ],
    "Billa": [
        ("Сирене Маджаров 400 г", 3.99, 4.99),
        ("Кашкавал Балкан 300 г", 3.49, 4.39),
        ("Масло Clever 125 г", 1.19, 1.59),
        ("Пилешки бутчета 1 кг", 2.49, 3.29),
        ("Ориз Крина 1 кг", 1.29, 1.79),
        ("Захар Clever 1 кг", 0.79, 1.09),
        ("Краставици 1 кг", 1.19, 1.89),
        ("Салам Шпек Орехите 1 кг", 7.99, 10.49),
        ("Вино Търговище Совиньон блан 750 мл", 3.49, 4.99),
        ("Картофи 2 кг", 1.29, 1.99),
    ],
    "Metro": [
        ("Краве сирене Fine Life 1 кг", 6.99, 8.99),
        ("Кашкавал Aro от краве мляко 1 кг", 8.49, 10.99),
        ("Прясно мляко Aro 3% 1 л x 12", 10.99, 13.99),
        ("Пилешко филе замразено 2 кг", 10.49, 13.49),
        ("Кафе Lavazza Qualità Oro 1 кг", 13.99, 17.99),
        ("Риба Сьомга филе 1 кг", 14.99, 19.99),
        ("Яйца размер L 30 бр.", 4.49, 5.49),
        ("Бира Загорка 0.5 л x 24", 13.99, 17.49),
        ("Домати чери 500 г", 1.49, 2.19),
        ("Моцарела Fine Life 125 г x 6", 4.99, 6.49),
    ],
}


def mock_offers(store: str) -> list[ScrapedOffer]:
    """Demo offers for one store, valid for the current Mon-Sun week."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    offers = []
    for name, new, old in _MOCK.get(store, []):
        label = name.split(" ")[0]
        offers.append(
            ScrapedOffer(
                store=store,
                product_name=name,
                discounted_price=new,
                original_price=old,
                image_url=f"https://placehold.co/300x300/f1f5f9/334155.png?text={label}",
                product_url=None,
                valid_from=monday,
                valid_to=sunday,
            )
        )
    return offers


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def _discount_percent(new: float, old: Optional[float]) -> Optional[int]:
    if old and old > new > 0:
        return round((1 - new / old) * 100)
    return None


def store_offers(session: Session, store: str, offers: list[ScrapedOffer], is_mock: bool) -> list[Offer]:
    """Replace one store's rows, derive tags/keys, append price history, flag 90-day lows."""
    session.exec(delete(Offer).where(Offer.store == store))
    rows: list[Offer] = []
    for o in offers:
        rows.append(
            Offer(
                **asdict(o),
                name_key=name_key(o.product_name),
                tags=tags_to_str(derive_tags(o.product_name)),
                discount_percent=_discount_percent(o.discounted_price, o.original_price),
                is_mock=is_mock,
            )
        )
    session.add_all(rows)
    session.commit()
    if not is_mock:
        record_history(session, rows)
        annotate_lowest_90d(session, store)
    return rows


def run_all_scrapers(session: Session) -> dict[str, dict]:
    """
    Run every scraper, replace each store's rows in the DB, return a summary:
        {"Lidl": {"count": 143, "mock": False}, "Metro": {"count": 10, "mock": True}, ...}
    """
    summary: dict[str, dict] = {}
    for scraper in SCRAPERS:
        offers = scraper.fetch()
        is_mock = False
        if not offers:
            offers = mock_offers(scraper.store)
            is_mock = True
        store_offers(session, scraper.store, offers, is_mock)
        summary[scraper.store] = {"count": len(offers), "mock": is_mock}
        log.info("%s: stored %d offers%s", scraper.store, len(offers), " (MOCK)" if is_mock else "")
    prune_history(session)
    return summary


def offers_count(session: Session) -> int:
    return len(session.exec(select(Offer.id)).all())


if __name__ == "__main__":
    # Quick manual test: python scraper.py
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    for s in SCRAPERS:
        found = s.fetch()
        print(f"{s.store:9s} -> {len(found)} real offers")
        for o in found[:3]:
            print("   ", o.product_name, o.discounted_price, "€")
