"""
Restaurant delivery comparison for Varna: Wolt, Glovo and Bolt Food. Each platform scraper returns Restaurant + Dish rows;
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


# --------------------------------------------------------------------------- #
# Cuisines - the category shortcuts the delivery apps show (🍕 Пица, 🥙 Дюнер,
# 🍣 Суши ...). Derived from the restaurant's name, the platform's tags and
# what the menu is mostly made of, so all three platforms get the same keys.
# --------------------------------------------------------------------------- #
CUISINES: list[tuple[str, str, str]] = [            # (key, label, emoji) in display order
    ("pizza", "Пица", "🍕"), ("burger", "Бургери", "🍔"), ("doner", "Дюнер", "🥙"), ("sushi", "Суши", "🍣"),
    ("asian", "Азиатска", "🥢"), ("italian", "Италианска", "🍝"), ("grill", "Скара", "🍖"), ("chicken", "Пиле", "🍗"),
    ("healthy", "Салати", "🥗"), ("breakfast", "Закуска", "🥞"), ("dessert", "Десерти", "🍰"), ("coffee", "Кафе", "☕"),
    ("bulgarian", "Българска", "🇧🇬"), ("mexican", "Мексиканска", "🌮"), ("seafood", "Риба", "🐟"), ("sandwich", "Сандвичи", "🥪"),
    ("turkish", "Турска", "🇹🇷"), ("soup", "Супи", "🍲"),
]
_CUISINE_RX = {
    "pizza": re.compile(r"пица|пици|pizza|пицар|pitsa", re.I),
    "burger": re.compile(r"бургер|burger|смаш|smash|burgeri", re.I),
    "doner": re.compile(r"дюнер|дунер|döner|doner|dyuner|кебап|kebab|kebap|гирос|gyros|шаурма|shawarma", re.I),
    "sushi": re.compile(r"суши|sushi|сашими|sashimi|нигири|\bрол\w*\b|poke|поке", re.I),
    "asian": re.compile(r"китайск|chinese|kitayska|азиатск|aziatska|asian|тайланд|thai|виетнам|vietnam|рамен|ramen|нудли|noodle|\bwok\b|уок|японск|japanese|корейск|korean|индийск|indian|къри|curry", re.I),
    "italian": re.compile(r"италианск|italianska|italian|паста|pasta|ризото|risotto|лазаня|lasagn|спагети|spaghetti|пене\b|фокача|focaccia", re.I),
    "grill": re.compile(r"скара|skara|na skara|grill|барбекю|barbekyu|bbq|кюфте|кебапче|стек|steak|ребра|ribs|шишче|skewer", re.I),
    "chicken": re.compile(r"пиле|пилешк|pile\b|chicken|крилца|wings|крила\b|нъгетс|nugget|тендър", re.I),
    "healthy": re.compile(r"салат|salat|salad|здравослов|zdravoslovn|healthy|\bfit\b|фит\b|веган|vegan|вегетар|vegetar|боул|bowl|смути|smoothie|протеин|protein", re.I),
    "breakfast": re.compile(r"закуск|zakusk|breakfast|палачинк|palachink|pancake|crepe|креп|омлет|omelet|бранч|brunch|гофрет|waffle|яйца", re.I),
    "dessert": re.compile(r"десерт|desert|dessert|торт|cake|сладк|сладолед|ice ?cream|бисквит|cookie|донът|donut|пекарн|bakery|кроасан|croissant|баклав|еклер|мъфин|muffin|брауни|чийзкейк|cheesecake", re.I),
    "coffee": re.compile(r"кафе|kafe|coffee|кафене|cafe|chay i kafe|caffe|еспресо|espresso|капучино|cappuccino|лате|latte|\bчай\b|\btea\b|фрапе|frappe", re.I),
    "bulgarian": re.compile(r"българск|balgarsk|bulgarian|mestna hrana|домашн|homemade|традицион|balkan|балканск|механа|mehana|готвен|баница|шкембе|мусака|таратор|лютениц", re.I),
    "mexican": re.compile(r"мексик|meksik|mexic|тако|taco|бурито|burrito|кесадия|quesadilla|начос|nachos|тортия|tortilla", re.I),
    "seafood": re.compile(r"\bриба|fish|seafood|морск|morska|скарид|shrimp|миди|mussel|октопод|octopus|калмар|calamar|сьомга|salmon|цаца", re.I),
    "sandwich": re.compile(r"сандвич|sandvich|sandwich|панини|panini|тост\b|toast|хот ?дог|hot ?dog|\bwrap|рап\b|багет|baguette|сабуей|subway", re.I),
    "turkish": re.compile(r"турск|tursk|turkish|лахмаджун|lahmacun|пиде|pide|искендер|iskender|адана|adana|баклав", re.I),
    "soup": re.compile(r"\bсупа|\bсупи|supi|soup|шкембе|чорба|бульон|broth|рамен", re.I),
}


def cuisines_for(name: str, tags: list[str], dishes: list) -> list[str]:
    """Canonical cuisine keys for one listing: name / platform tags count a lot, menu composition a bit."""
    head = f"{name} {' '.join(tags or [])}"
    score: dict[str, float] = {}
    for key, rx in _CUISINE_RX.items():
        if rx.search(head):
            score[key] = score.get(key, 0) + 3
    n = max(len(dishes), 1)
    generic = {"chicken", "healthy", "seafood", "dessert", "sandwich", "grill", "soup", "breakfast", "coffee", "bulgarian", "italian"}
    for key, rx in _CUISINE_RX.items():
        hits = sum(1 for d in dishes if rx.search(f"{d.name} {d.category or ''}"))
        share = hits / n
        strong = (hits >= 5 and share >= 0.25) if key in generic else (hits >= 3 and share >= 0.12) or hits >= 8
        if strong:
            score[key] = score.get(key, 0) + min(3, 1 + share * 6)
    ranked = sorted(score.items(), key=lambda kv: (-kv[1], [k for k, _, _ in CUISINES].index(kv[0])))
    return [k for k, _ in ranked[:4]]


# --------------------------------------------------------------------------- #
# Dish kinds - so a search for "дюнер" ranks the dish above "Дюнер месо" (an
# add-on) and the app can show Основни / Гарнитури / Напитки / Десерти / Добавки.
# --------------------------------------------------------------------------- #
_KIND_BY_CATEGORY = [
    ("drink", re.compile(r"напитк|drink|безалкохол|алкохол|бира|beer|вин[ао]\b|wine|кафе|coffee|чай\b|\btea|коктейл|cocktail|сок|juice|вод[аи]\b|water|фреш|смути|smoothie|лимонад|шейк|shake|ракия|уиски|whisk|джин\b|водка|\bром\b|бар\b", re.I)),
    ("dessert", re.compile(r"десерт|dessert|сладк|sweet|торт|cake|палачинк|pancake|сладолед|ice ?cream|баклав|тирамису|чийзкейк|cheesecake|брауни|мъфин|вафл|waffle|кроасан|еклер|бисквит|cookie|шоколад|гофрет", re.I)),
    ("extra", re.compile(r"добавк|допълн|екстр|extra|топинг|topping|сосове|\bсос\b|sauce|дресинг|dressing|прибори|салфетк|опаковк|add-?on|заливк", re.I)),
    ("side", re.compile(r"гарнитур|\bside|картоф|fries|хляб|bread|питк|пърленк|\bориз\b|\brice\b", re.I)),
]
_KIND_BY_NAME = [
    ("extra", re.compile(r"^(добавка|доп\.|допълнително|допълнителна|екстра|extra|сос|сосче|дресинг|топинг|заливка|прибори|салфетки|опаковка)\b|\b(сос|сосче|дресинг|топинг|добавка)$", re.I)),
    ("drink", re.compile(r"\b(кока.?кола|кола|cola|coke|фанта|fanta|спрайт|sprite|пепси|pepsi|айрян|айран|ayran|вода|water|бира|beer|сок|juice|кафе|coffee|еспресо|espresso|капучино|cappuccino|лате|latte|чай|tea|фреш|лимонада|lemonade|смути|smoothie|шейк|shake|коктейл|cocktail|вино|wine|ракия|уиски|whisky|джин|gin|водка|vodka|тоник|tonic|ред бул|red ?bull|schweppes|швепс|минерална|газирана|напитка|drink|фрапе|frappe|мохито|mojito)\b", re.I)),
    ("dessert", re.compile(r"\b(торта|торт[аи]|cake|палачинк\w*|pancake|сладолед|ice ?cream|баклава|тирамису|чийзкейк|cheesecake|брауни|brownie|мъфин|muffin|вафл\w*|waffle|кроасан|croissant|еклер|крем ?карамел|десерт|dessert|бисквит\w*|cookie|гофрет\w*|суфле|пай\b|крем\b|кекс|донът|donut|понички?|мекиц\w*)\b", re.I)),
    ("side", re.compile(r"^(гарнитура|пържени картоф\w*|картофки|картофи|картоф\w*|хляб|питка|пърленка|бял ориз|ориз|french fries|fries|sweet potato)\b", re.I)),
]
_MEAT_ADDON = re.compile(r"^(дюнер|пилешко|телешко|свинско|агнешко|кебап|кюфте|гирос|gyros|doner|döner)\s+месо$", re.I)


def dish_kind(name: str, category: Optional[str] = None, price: Optional[float] = None) -> str:
    """'Шопска салата' -> main; 'Дюнер месо' / 'Сос чесън' -> extra; 'Кока-Кола 500мл' -> drink."""
    n = (name or "").strip()
    c = (category or "").strip()
    if re.search(r"комбо|combo|меню|menu", n, re.I):              # "Комбо бургер + Coca-Cola" is a meal
        return "main"
    if re.search(r"без гарнитура", n + " " + c, re.I):
        return "main"
    for kind, rx in _KIND_BY_CATEGORY:
        if c and rx.search(c):
            if kind == "drink" and _KIND_BY_NAME[3][1].search(n):     # "Пържени картофки" in a bar's menu is still a side
                return "side"
            return kind
    if _MEAT_ADDON.match(n):
        return "extra"
    for kind, rx in _KIND_BY_NAME:
        if rx.search(n):
            if kind == "extra" and price is not None and price > 4:   # "Сос болонезе паста" style mains are pricier than add-ons
                continue
            return kind
    if price is not None and price < 1.2 and len(n.split()) <= 2:    # a 0.60 € two-word item is an add-on, not a meal
        return "extra"
    return "main"


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
        self._type_tags: dict[str, list[str]] = {}
        for m in re.findall(r"/bg/bg/varna/stores/([a-z0-9-]+)", html):
            slugs.setdefault(m)
        for t in types:
            try:
                page = client.get(self.BASE + self.CATEGORY, params={"type": t}).text
                label = t.rsplit("_", 1)[0].replace("-", " ")        # pitsa_34701 -> "pitsa"
                for m in re.findall(r"/bg/bg/varna/stores/([a-z0-9-]+)", page):
                    slugs.setdefault(m)
                    self._type_tags.setdefault(m, []).append(label)
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
            tags=list(dict.fromkeys(getattr(self, "_type_tags", {}).get(slug, [])))[:6],
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


# --------------------------------------------------------------------------- #
# Bolt Food - food.bolt.eu is an Expo web app talking to a JSON API that has a
# "public" (guest, no account) variant of every read endpoint:
#   POST /deliveryClient/public/findProviders        {lat,lng,filters:[]}  -> restaurants
#   GET  /deliveryClient/public/getMenuCategories    ?provider_id&delivery_lat&delivery_lng
#        -> the whole menu tree (menu > category > dish > options), prices in EUR
# We never create a guest user / account - the public routes need none.
# --------------------------------------------------------------------------- #
class BoltScraper:
    platform = "Bolt"
    API = "https://deliveryuser.live.boltsvc.net/deliveryClient/public"
    STORE_URL = "https://food.bolt.eu/bg-BG/2098-varna/p/{pid}-{slug}"
    MAX_PROVIDERS = 400
    HEADERS = {**HEADERS, "Origin": "https://food.bolt.eu", "Referer": "https://food.bolt.eu/", "Content-Type": "application/json"}

    def __init__(self) -> None:
        import uuid

        self._qs = {
            "version": "FD.1.00", "deviceId": str(uuid.uuid4()), "device_name": "web", "device_os_version": "web",
            "deviceType": "web", "language": "bg", "country": "bg",
        }
        self._loc = {"delivery_lat": VARNA["lat"], "delivery_lng": VARNA["lon"]}

    def fetch(self) -> list[ScrapedRestaurant]:
        out: list[ScrapedRestaurant] = []
        try:
            with httpx.Client(headers=self.HEADERS, timeout=40) as client:
                providers = self._providers(client)
                log.info("Bolt: %d restaurants listed in Varna", len(providers))
                for i, p in enumerate(providers[: self.MAX_PROVIDERS]):
                    try:
                        r = self._restaurant(p)
                        r.dishes = self._dishes(client, p["provider_id"])
                        if r.dishes:
                            out.append(r)
                    except Exception as exc:  # noqa: BLE001
                        log.info("Bolt: %s skipped (%s)", p.get("provider_id"), exc)
                    if i % 50 == 49:
                        log.info("Bolt: %d/%d providers done", i + 1, len(providers))
        except Exception as exc:  # noqa: BLE001
            log.warning("Bolt: listing failed (%s)", exc)
        return out

    def _get(self, client: httpx.Client, method: str, path: str, **kw) -> dict:
        """Bolt answers HTTP 200 with code!=0 on errors and 429 on bursts -> retry with backoff."""
        last = None
        for attempt in range(5):
            r = client.request(method, f"{self.API}/{path}", **kw)
            if r.status_code == 200:
                body = r.json()
                if body.get("code") == 0:
                    return body.get("data") or {}
                last = body.get("message")
                if body.get("code") != 1005:                   # 1005 = TOO_MANY_REQUESTS
                    raise RuntimeError(last)
            else:
                last = f"HTTP {r.status_code}"
            time.sleep(3 * (attempt + 1))
        raise RuntimeError(f"gave up ({last})")

    def _providers(self, client: httpx.Client) -> list[dict]:
        data = self._get(client, "POST", "findProviders", params=self._qs, json={"lat": VARNA["lat"], "lng": VARNA["lon"], "filters": []})
        seen: dict[int, dict] = {}
        for p in data.get("providers") or []:
            if p.get("provider_id") and _text(p.get("name")):
                seen.setdefault(p["provider_id"], p)
        return list(seen.values())

    def _restaurant(self, p: dict) -> ScrapedRestaurant:
        rating = p.get("rating") or p.get("rating_info") or {}
        if not isinstance(rating, dict):
            rating = {}
        fee = (p.get("delivery_price") or {}).get("value")
        eta = p.get("max_delivery_eta") or p.get("min_delivery_eta")
        level = {"one": 1, "two": 2, "three": 3, "four": 4}.get(p.get("price_level_str") or "")
        pid = p["provider_id"]
        return ScrapedRestaurant(
            platform=self.platform,
            external_id=str(pid),
            name=_text(p.get("name")).strip(),
            url=self.STORE_URL.format(pid=pid, slug=(p.get("slug") or str(pid)).split("-", 1)[-1]),
            image_url=_bolt_image(p.get("images"), "1x"),
            address=p.get("address"),
            tags=[_text(t) for t in (p.get("tags") or []) if _text(t)][:6],
            rating=_x2(rating.get("value") or rating.get("rating")),          # Bolt rates 0-5; Wolt/Glovo use 0-10
            rating_count=rating.get("count"),
            delivery_minutes=int(eta / 60) if isinstance(eta, (int, float)) and eta else None,
            delivery_fee=float(fee) if isinstance(fee, (int, float)) else None,
            price_range=level,
            online=bool(p.get("is_available_for_delivery", True)),
        )

    def _dishes(self, client: httpx.Client, pid: int) -> list[ScrapedDish]:
        data = self._get(client, "GET", "getMenuCategories", params={**self._qs, "provider_id": pid, **self._loc})
        time.sleep(0.4)                                # be polite between restaurants
        items = data.get("items") or {}
        dishes: list[ScrapedDish] = []
        for it in items.values():
            if it.get("type") != "dish":
                continue
            name = _text(it.get("name")).strip()
            price = (it.get("price") or {}).get("value")
            if not name or not isinstance(price, (int, float)) or price <= 0:
                continue
            orig = it.get("original_price")
            orig = orig.get("value") if isinstance(orig, dict) else None
            parent = items.get(str(it.get("parent_id"))) or {}
            dishes.append(
                ScrapedDish(
                    external_id=str(it.get("id")),
                    name=name,
                    price=round(float(price), 2),
                    original_price=round(float(orig), 2) if isinstance(orig, (int, float)) and orig > price else None,
                    description=_text(it.get("description")).strip()[:300] or None,
                    category=_text(parent.get("name")).strip() or None,
                    image_url=_bolt_image(it.get("images"), "3x"),
                )
            )
        return dishes


def _x2(v) -> Optional[float]:
    return round(float(v) * 2, 1) if isinstance(v, (int, float)) else None


def _text(v) -> str:
    """Bolt wraps localised strings as {"locale": "bg-BG", "value": "..."}."""
    if isinstance(v, dict):
        return str(v.get("value") or "")
    return str(v or "")


def _bolt_image(images, prefer: str) -> Optional[str]:
    """images = {"provider_list_v1": {"aspect_ratio_map": {"original": {"1x": url, ...}}}} (some sizes empty)."""
    for v in (images or {}).values():
        sizes = ((v or {}).get("aspect_ratio_map") or {}).get("original") or {}
        url = sizes.get(prefer) or sizes.get("1x") or sizes.get("2x") or sizes.get("3x")
        if url:
            return url
    return None


PLATFORM_SCRAPERS = [WoltScraper(), GlovoScraper(), BoltScraper()]


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
            cuisines=",".join(cuisines_for(r.name, r.tags, r.dishes)),
        )
        session.add(row)
        session.flush()
        session.add_all(
            Dish(
                restaurant_id=row.id, platform=r.platform, external_id=d.external_id, name=d.name, name_key=name_key(d.name),
                description=d.description, category=d.category, price=d.price, original_price=d.original_price, image_url=d.image_url,
                kind=dish_kind(d.name, d.category, d.price),
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
