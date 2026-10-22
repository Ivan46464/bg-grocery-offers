"""
Restaurant delivery comparison for Varna: Wolt (+ Glovo / Bolt Food when their
scrapers are wired in). Each platform scraper returns Restaurant + Dish rows;
restaurants are grouped across platforms by a normalised name so the same dish
can be compared ("Пица Маргарита: 9.90 на Wolt, 10.50 на Glovo").

Wolt (public, no auth):
  GET https://restaurant-api.wolt.com/v1/pages/restaurants?lat&lon        -> venues
  GET https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/
      venues/slug/{slug}/assortment?language=bg                           -> items (prices in cents)
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
from rapidfuzz import fuzz
from sqlmodel import Session, delete, select

from models import Dish, Restaurant, name_key

log = logging.getLogger("restaurants")

VARNA = {"lat": 43.2141, "lon": 27.9147}
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept-Language": "bg",
    "Accept": "application/json",
}

_LOC_SUFFIX_RE = re.compile(r"\s*[|\-–(]\s*[^|\-–()]{0,40}$")      # "McDonald's | Делфини" -> "McDonald's"
_NOISE_RE = re.compile(r"[^\w\s]+", re.UNICODE)


def group_key(name: str) -> str:
    """Normalised restaurant name used to join the same place across platforms."""
    base = _LOC_SUFFIX_RE.sub("", name) if ("|" in name or " - " in name or "(" in name) else name
    base = _NOISE_RE.sub(" ", base.lower())
    base = re.sub(r"\b(restaurant|ресторант|пицария|pizzeria|bar|бар|кафе|cafe|варна|varna|бистро|bistro)\b", " ", base)
    return " ".join(base.split())[:80] or name.lower()


@dataclass
class ScrapedDish:
    external_id: Optional[str]
    name: str
    price: float
    original_price: Optional[float] = None
    description: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None


@dataclass
class ScrapedRestaurant:
    platform: str
    external_id: str
    name: str
    url: str
    image_url: Optional[str] = None
    address: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    rating: Optional[float] = None
    rating_count: Optional[int] = None
    delivery_minutes: Optional[int] = None
    delivery_fee: Optional[float] = None
    price_range: Optional[int] = None
    online: bool = True
    dishes: list[ScrapedDish] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Wolt
# --------------------------------------------------------------------------- #
class WoltScraper:
    platform = "Wolt"
    LIST_URL = "https://restaurant-api.wolt.com/v1/pages/restaurants"
    MENU_URL = "https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/{slug}/assortment"
    VENUE_URL = "https://wolt.com/bg/bgr/varna/venue/{slug}"
    MAX_VENUES = 400

    def fetch(self) -> list[ScrapedRestaurant]:
        out: list[ScrapedRestaurant] = []
        try:
            with httpx.Client(headers=HEADERS, timeout=40) as client:
                venues = self._venues(client)
                log.info("Wolt: %d restaurants listed in Varna", len(venues))
                for i, v in enumerate(venues[: self.MAX_VENUES]):
                    try:
                        r = self._restaurant(v)
                        r.dishes = self._dishes(client, v["slug"])
                        out.append(r)
                    except Exception as exc:  # noqa: BLE001
                        log.info("Wolt: %s skipped (%s)", v.get("slug"), exc)
                    if i % 50 == 49:
                        log.info("Wolt: %d/%d venues done", i + 1, len(venues))
        except Exception as exc:  # noqa: BLE001
            log.warning("Wolt: listing failed (%s)", exc)
        return out

    def _venues(self, client: httpx.Client) -> list[dict]:
        data = client.get(self.LIST_URL, params=VARNA).json()
        seen: dict[str, dict] = {}
        for section in data.get("sections", []):
            for item in section.get("items", []):
                v = item.get("venue")
                if v and v.get("slug") and v.get("product_line") == "restaurant":
                    seen.setdefault(v["slug"], v)
        return list(seen.values())

    def _restaurant(self, v: dict) -> ScrapedRestaurant:
        rating = v.get("rating") or {}
        fee = v.get("delivery_price_int")
        img = v.get("brand_image") or v.get("image")
        if isinstance(img, dict):
            img = img.get("url")
        return ScrapedRestaurant(
            platform=self.platform,
            external_id=v["slug"],
            name=v.get("name", "").strip(),
            url=self.VENUE_URL.format(slug=v["slug"]),
            image_url=img if isinstance(img, str) else None,
            address=v.get("address"),
            tags=[t for t in (v.get("tags") or []) if t][:6],
            rating=rating.get("score"),
            rating_count=rating.get("volume"),
            delivery_minutes=v.get("estimate"),
            delivery_fee=(fee / 100) if isinstance(fee, (int, float)) else None,
            price_range=v.get("price_range"),
            online=bool(v.get("online", True)),
        )

    def _dishes(self, client: httpx.Client, slug: str) -> list[ScrapedDish]:
        data = None
        for attempt in range(4):
            r = client.get(self.MENU_URL.format(slug=slug), params={"language": "bg"})
            if r.status_code == 200:
                try:
                    data = r.json()
                    break
                except ValueError:
                    pass
            if r.status_code == 404:
                return []
            time.sleep(1.5 * (attempt + 1))          # 429 / empty body: Wolt throttles bursts
        if data is None:
            raise RuntimeError(f"menu unavailable (HTTP {r.status_code})")
        time.sleep(0.25)                              # be polite between venues
        cat_of: dict[str, str] = {}
        for c in data.get("categories") or []:
            for iid in c.get("item_ids") or []:
                cat_of[iid] = (c.get("name") or "").strip()
        dishes: list[ScrapedDish] = []
        for it in data.get("items") or []:
            price = it.get("price")
            if price is None:
                price = it.get("net_price")
            if not price or not it.get("name"):
                continue
            orig = it.get("original_price") or it.get("original_net_price")
            images = it.get("images") or []
            dishes.append(
                ScrapedDish(
                    external_id=it.get("id"),
                    name=it["name"].strip(),
                    price=round(price / 100, 2),
                    original_price=round(orig / 100, 2) if orig and orig > price else None,
                    description=(it.get("description") or "").strip()[:300] or None,
                    category=cat_of.get(it.get("id")),
                    image_url=(images[0].get("url") if images and isinstance(images[0], dict) else None),
                )
            )
        return dishes


# --------------------------------------------------------------------------- #
# Glovo - glovoapp.com renders store pages server-side (Next.js), so plain HTML
# parsing works: menu rows carry hashed class names with stable prefixes
# (ItemRow_titleContainer__*, ItemRow_priceContainer__*), sections are <h3>.
# The city listing shows at most 50 stores per page, so we union the stores
# of every cuisine filter (?type=pitsa_34701, ?type=burgeri_34789, ...).
# --------------------------------------------------------------------------- #
class GlovoScraper:
    platform = "Glovo"
    BASE = "https://glovoapp.com"
    CITY = "/bg/bg/varna"
    CATEGORY = "/bg/bg/varna/categories/hrana_1"
    STORE_URL = "https://glovoapp.com/bg/bg/varna/stores/{slug}"
    MAX_STORES = 400
    SEL = {
        "row": '[class*="ItemRow_itemRow__"]',
        "title": '[class*="ItemRow_titleContainer"]',
        "price": '[class*="ItemRow_priceContainer"]',
        "desc": '[class*="ItemRow_description"]',
        "name": "h2",
        "section": "h3",
    }
    _PRICE_RE = re.compile(r"(\d+)[,.](\d{2})\s*€")
    _PCT_RE = re.compile(r"(\d{2,3})\s*%")

    def fetch(self) -> list[ScrapedRestaurant]:
        from bs4 import BeautifulSoup

        out: list[ScrapedRestaurant] = []
        headers = {**HEADERS, "Accept": "text/html"}
        try:
            with httpx.Client(headers=headers, timeout=40, follow_redirects=True) as client:
                slugs = self._slugs(client)
                log.info("Glovo: %d restaurants listed in Varna", len(slugs))
                empty = 0
                for i, slug in enumerate(slugs[: self.MAX_STORES]):
                    try:
                        r = None
                        for attempt in range(3):
                            html = client.get(self.STORE_URL.format(slug=slug)).text
                            r = self._parse_store(BeautifulSoup(html, "html.parser"), slug)
                            if r and r.dishes:
                                break
                            # closed stores legitimately have no menu (short page); a long page with
                            # no rows or a very short one is a throttled/blocked response -> wait and retry
                            time.sleep(3 * (attempt + 1))
                        if r and r.dishes:
                            out.append(r)
                        else:
                            empty += 1
                        time.sleep(0.5)
                    except Exception as exc:  # noqa: BLE001
                        log.info("Glovo: %s skipped (%s)", slug, exc)
                    if i % 50 == 49:
                        log.info("Glovo: %d/%d stores done (%d without menu)", i + 1, len(slugs), empty)
                log.info("Glovo: %d stores with menus, %d without", len(out), empty)
        except Exception as exc:  # noqa: BLE001
            log.warning("Glovo: listing failed (%s)", exc)
        return out

    def _slugs(self, client: httpx.Client) -> list[str]:
        html = client.get(self.BASE + self.CATEGORY).text
        types = sorted(set(re.findall(r"\?type=([a-z0-9-]+_\d+)", html)))
        slugs: dict[str, None] = {}
        for m in re.findall(r"/bg/bg/varna/stores/([a-z0-9-]+)", html):
            slugs.setdefault(m)
        for t in types:
            try:
                page = client.get(self.BASE + self.CATEGORY, params={"type": t}).text
                for m in re.findall(r"/bg/bg/varna/stores/([a-z0-9-]+)", page):
                    slugs.setdefault(m)
            except httpx.HTTPError:
                continue
        return list(slugs)

    def _parse_store(self, soup, slug: str) -> Optional[ScrapedRestaurant]:
        name_el = soup.select_one(self.SEL["name"])
        if not name_el:
            return None
        name = name_el.get_text(" ", strip=True)
        head = soup.get_text(" ", strip=True)[:2500]
        pct = self._PCT_RE.search(head)
        fee = self._PRICE_RE.search(head)
        rest = ScrapedRestaurant(
            platform=self.platform,
            external_id=slug,
            name=name,
            url=self.STORE_URL.format(slug=slug),
            image_url=None,                                           # og:image is just the Glovo logo
            rating=(int(pct.group(1)) / 10) if pct else None,      # "95%" -> 9.5, comparable with Wolt's 0-10
            delivery_fee=(int(fee.group(1)) + int(fee.group(2)) / 100) if fee else None,
        )
        for row in soup.select(self.SEL["row"]):
            title = row.select_one(self.SEL["title"])
            price_el = row.select_one(self.SEL["price"])
            if not title or not price_el:
                continue
            prices = [int(a) + int(b) / 100 for a, b in self._PRICE_RE.findall(price_el.get_text(" ", strip=True))]
            if not prices:
                continue
            price = min(prices)
            original = max(prices) if len(prices) > 1 and max(prices) > price else None
            desc = row.select_one(self.SEL["desc"])
            img = row.select_one("img")
            section = None
            anc = row
            for _ in range(8):
                anc = anc.parent
                if anc is None:
                    break
                h = anc.find(self.SEL["section"], recursive=False)
                if h:
                    section = h.get_text(" ", strip=True)
                    break
            rest.dishes.append(
                ScrapedDish(
                    external_id=None,
                    name=title.get_text(" ", strip=True),
                    price=round(price, 2),
                    original_price=round(original, 2) if original else None,
                    description=(desc.get_text(" ", strip=True)[:300] if desc else None),
                    category=section,
                    image_url=(img.get("src") or img.get("data-src")) if img else None,
                )
            )
        return rest


PLATFORM_SCRAPERS = [WoltScraper(), GlovoScraper()]


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #
def store_restaurants(session: Session, platform: str, restaurants: list[ScrapedRestaurant]) -> int:
    """Replace one platform's restaurants + dishes."""
    old_ids = [r for r in session.exec(select(Restaurant.id).where(Restaurant.platform == platform)).all()]
    if old_ids:
        session.exec(delete(Dish).where(Dish.restaurant_id.in_(old_ids)))
        session.exec(delete(Restaurant).where(Restaurant.platform == platform))
    n = 0
    for r in restaurants:
        row = Restaurant(
            platform=r.platform, external_id=r.external_id, name=r.name, group_key=group_key(r.name), url=r.url,
            image_url=r.image_url, address=r.address, tags=",".join(r.tags), rating=r.rating, rating_count=r.rating_count,
            delivery_minutes=r.delivery_minutes, delivery_fee=r.delivery_fee, price_range=r.price_range, online=r.online,
        )
        session.add(row)
        session.flush()
        session.add_all(
            Dish(
                restaurant_id=row.id, platform=r.platform, external_id=d.external_id, name=d.name, name_key=name_key(d.name),
                description=d.description, category=d.category, price=d.price, original_price=d.original_price, image_url=d.image_url,
            )
            for d in r.dishes
        )
        n += len(r.dishes)
    session.commit()
    return n


def run_all_restaurant_scrapers(session: Session) -> dict[str, dict]:
    summary = {}
    for s in PLATFORM_SCRAPERS:
        t = time.time()
        rests = s.fetch()
        dishes = store_restaurants(session, s.platform, rests) if rests else 0
        summary[s.platform] = {"restaurants": len(rests), "dishes": dishes, "seconds": round(time.time() - t)}
        log.info("%s: %d restaurants, %d dishes (%.0fs)", s.platform, len(rests), dishes, time.time() - t)
    return summary


# --------------------------------------------------------------------------- #
# Matching helpers
# --------------------------------------------------------------------------- #
def same_dish(a: str, b: str) -> bool:
    """'Пица Маргарита 30см' vs 'Маргарита (30 см)' -> True."""
    ka, kb = name_key(a), name_key(b)
    if ka == kb:
        return True
    return fuzz.token_set_ratio(ka, kb) >= 88
