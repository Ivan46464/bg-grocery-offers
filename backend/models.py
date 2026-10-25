"""
Database models (SQLModel = SQLAlchemy + Pydantic).

Tables
  offers         current promotions (replaced per store on every scrape)
  price_history  one row per (store, product, price) observation - never overwritten,
                 so we can tell whether a "promo" really is the lowest price in 90 days
  push_tokens    Expo push tokens of installed apps
  watches        saved searches with an optional target price -> push alert on a hit
"""
import re
from datetime import date, datetime, timezone
from typing import Optional, Union

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


_KEY_RE = re.compile(r"[^\w]+", re.UNICODE)


def name_key(product_name: str) -> str:
    """Stable key for 'the same product' across scrapes: lowercase, punctuation stripped."""
    return " ".join(t for t in _KEY_RE.split(product_name.lower()) if t)[:200]


# --------------------------------------------------------------------------- #
# Tables
# --------------------------------------------------------------------------- #
class Offer(SQLModel, table=True):
    __tablename__ = "offers"

    id: Optional[int] = Field(default=None, primary_key=True)

    store: str = Field(index=True)              # "Lidl" | "Kaufland" | "Billa" | "Metro"
    product_name: str = Field(index=True)       # e.g. "Краве сирене Родна стряха 400 г"
    name_key: str = Field(default="", index=True)

    original_price: Optional[float] = None      # price before the promotion (EUR), may be unknown
    discounted_price: float                     # promo price for everyone (EUR); = card price when card_only
    discount_percent: Optional[int] = None      # derived: round((1 - effective/old) * 100)

    card_price: Optional[float] = None          # extra-low price with the store's loyalty card
    card_name: Optional[str] = None             # "Kaufland Card" | "Lidl Plus" | "BILLA Card"
    card_only: bool = False                     # promo exists ONLY with the card
    promo_label: Optional[str] = None           # "1+1 безплатно", "-60% на всеки втори", "2+1" ...
    effective_price: float = 0.0                # min(discounted_price, card_price) - what we sort by
    is_promo: bool = Field(default=True, index=True)  # False = regular shelf price (full catalogue: Metro, Lidl)

    image_url: Optional[str] = None
    product_url: Optional[str] = None           # link back to the store page
    barcode: Optional[str] = Field(default=None, index=True)   # EAN-13 when the store exposes it

    valid_from: Optional[date] = None
    valid_to: Optional[date] = None

    tags: str = ""                              # comma-separated: "млечни,био"
    lowest_90d: Optional[float] = None          # min price seen for this product in the last 90 days
    is_lowest_90d: Optional[bool] = None        # True = this promo is the real low; None = no history yet

    is_mock: bool = False                       # True when the row came from fallback demo data
    scraped_at: datetime = Field(default_factory=utcnow)


class PriceHistory(SQLModel, table=True):
    __tablename__ = "price_history"

    id: Optional[int] = Field(default=None, primary_key=True)
    store: str = Field(index=True)
    name_key: str = Field(index=True)
    product_name: str
    barcode: Optional[str] = Field(default=None, index=True)
    price: float
    original_price: Optional[float] = None
    seen_at: datetime = Field(default_factory=utcnow, index=True)


class PushToken(SQLModel, table=True):
    __tablename__ = "push_tokens"

    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(index=True, unique=True)     # "ExponentPushToken[...]" or a device id for in-app alerts
    platform: str = "android"
    created_at: datetime = Field(default_factory=utcnow)
    last_seen: datetime = Field(default_factory=utcnow)


class Watch(SQLModel, table=True):
    __tablename__ = "watches"

    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(index=True)                  # owner (push token / device id)
    query: str                                      # product name (specific) or a free word
    barcode: Optional[str] = None                   # when set, matching is exact by EAN
    image_url: Optional[str] = None
    exact: bool = False                             # True = a specific product was picked (strict matching)
    target_price: Optional[float] = None            # alert when price <= target; None = any promo
    store: Optional[str] = None                     # optional store restriction
    created_at: datetime = Field(default_factory=utcnow)
    last_hit_offer_id: Optional[int] = None         # offer we last alerted about (avoid repeats)
    last_hit_price: Optional[float] = None
    last_hit_name: Optional[str] = None
    last_hit_store: Optional[str] = None
    last_notified_at: Optional[datetime] = None


class ListInbox(SQLModel, table=True):
    """
    Shopping-list items sent from outside the app (e.g. the LoveChat chat bridge).
    The mobile app pulls unconsumed rows on the Количка tab, merges them into the
    on-device list and acknowledges them.
    """

    __tablename__ = "list_inbox"

    id: Optional[int] = Field(default=None, primary_key=True)
    item_name: str = Field(index=True)
    added_by: str = "chat_bridge"
    raw_message: Optional[str] = None
    barcode: Optional[str] = None                   # set when a specific catalogue product was picked
    image_url: Optional[str] = None
    exact: bool = False
    price: Optional[float] = None
    store: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow, index=True)
    consumed_at: Optional[datetime] = Field(default=None, index=True)


class Restaurant(SQLModel, table=True):
    """A restaurant as listed on one delivery platform (Wolt / Glovo / Bolt Food) in Varna."""

    __tablename__ = "restaurants"

    id: Optional[int] = Field(default=None, primary_key=True)
    platform: str = Field(index=True)               # "Wolt" | "Glovo" | "Bolt"
    external_id: str = Field(index=True)            # platform's slug / id
    name: str = Field(index=True)
    group_key: str = Field(default="", index=True)  # normalised name shared by the same restaurant on other platforms
    url: str                                        # deep link to order
    image_url: Optional[str] = None
    address: Optional[str] = None
    tags: str = ""                                  # "burger,pizza"
    cuisines: str = Field(default="", index=True)   # canonical keys, e.g. "pizza,italian" (restaurants.CUISINES)
    rating: Optional[float] = None                  # platform score (Wolt 0-10)
    rating_count: Optional[int] = None
    delivery_minutes: Optional[int] = None
    delivery_fee: Optional[float] = None            # EUR, when the platform exposes it
    price_range: Optional[int] = None               # 1-4
    online: bool = True
    city: str = "Varna"
    scraped_at: datetime = Field(default_factory=utcnow)


class Dish(SQLModel, table=True):
    __tablename__ = "dishes"

    id: Optional[int] = Field(default=None, primary_key=True)
    restaurant_id: int = Field(foreign_key="restaurants.id", index=True)
    platform: str = Field(index=True)
    external_id: Optional[str] = None
    name: str = Field(index=True)
    name_key: str = Field(default="", index=True)
    description: Optional[str] = None
    category: Optional[str] = None
    price: float                                    # EUR
    original_price: Optional[float] = None          # when the platform shows a discount
    image_url: Optional[str] = None
    kind: str = Field(default="main", index=True)     # main | side | extra | drink | dessert (see restaurants.dish_kind)
    scraped_at: datetime = Field(default_factory=utcnow)


# --------------------------------------------------------------------------- #
# API shapes
# --------------------------------------------------------------------------- #
class OfferRead(SQLModel):
    """Shape returned by the API (adds the fuzzy-match score for search results)."""

    id: int
    store: str
    product_name: str
    original_price: Optional[float]
    discounted_price: float
    discount_percent: Optional[int]
    card_price: Optional[float] = None
    card_name: Optional[str] = None
    card_only: bool = False
    promo_label: Optional[str] = None
    effective_price: float = 0.0
    is_promo: bool = True
    image_url: Optional[str]
    product_url: Optional[str]
    barcode: Optional[str]
    valid_from: Optional[date]
    valid_to: Optional[date]
    tags: list[str] = []
    lowest_90d: Optional[float] = None
    is_lowest_90d: Optional[bool] = None
    is_mock: bool
    score: Optional[int] = None

    upcoming: bool = False                          # valid_from is in the future (next leaflet) - not on the shelf yet

    @classmethod
    def from_offer(cls, o: Offer, score: Optional[int] = None) -> "OfferRead":
        data = o.model_dump()
        data["tags"] = [t for t in (o.tags or "").split(",") if t]
        data["upcoming"] = bool(o.valid_from and o.valid_from > date.today())
        return cls(**data, score=score)


class HistoryPoint(SQLModel):
    seen_at: datetime
    price: float
    original_price: Optional[float] = None


class OfferHistory(SQLModel):
    offer_id: int
    store: str
    product_name: str
    points: list[HistoryPoint]
    lowest_90d: Optional[float]
    highest_90d: Optional[float]
    is_lowest_90d: Optional[bool]


class SimilarResponse(SQLModel):
    offer: OfferRead
    same_elsewhere: list[OfferRead]                 # the same product in other stores
    similar: list[OfferRead]                        # similar products (same kind), cheapest first
    query: str                                      # the core words we matched on (for the UI label)
    upcoming: list[OfferRead] = []                  # the same product in the store's NEXT leaflet (valid_from in the future)


class StoreStatus(SQLModel):
    store: str
    leaflet_url: Optional[str] = None               # the store's own leaflet page
    upcoming: int = 0                               # items already known from the next leaflet
    offers: int                                     # promotions
    regular: int = 0                                # regular-price catalogue items (Metro, Lidl)
    is_mock: bool
    last_scraped: Optional[datetime]


class ServiceStatus(SQLModel):
    scraping: bool
    total_offers: int
    last_scrape_finished: Optional[datetime]
    stores: list[StoreStatus]


class TagInfo(SQLModel):
    tag: str
    label: str
    count: int


# ---- catalog ----------------------------------------------------------------
class CatalogItem(SQLModel):
    name: str
    image_url: Optional[str] = None
    barcode: Optional[str] = None
    source: str = "offer"                           # "offer" (on promo now) | "catalog" (known product, no promo)
    store: Optional[str] = None
    price: Optional[float] = None
    offer_id: Optional[int] = None
    score: Optional[int] = None


# ---- cart -------------------------------------------------------------------
class CartItem(SQLModel):
    name: str                                       # specific product name, or a free word ("яйца")
    barcode: Optional[str] = None
    image_url: Optional[str] = None
    exact: bool = False                             # picked from the catalog -> strict matching


class CartRequest(SQLModel):
    items: list[Union[str, CartItem]]               # strings are treated as free words
    stores: Optional[list[str]] = None              # restrict to these stores (default: all)


class CartItemMatch(SQLModel):
    item: str
    image_url: Optional[str] = None
    offer: Optional[OfferRead] = None               # best offer for this item at this store (None = not on promo)


class CartStorePlan(SQLModel):
    store: str
    total: float
    found: int
    missing: list[str]
    items: list[CartItemMatch]


class CartSplitStop(SQLModel):
    store: str
    items: list[CartItemMatch]
    subtotal: float


class CartResponse(SQLModel):
    items: list[CartItem]
    best_single_store: Optional[CartStorePlan]
    stores: list[CartStorePlan]                     # every store, cheapest first
    best_split: list[CartSplitStop]
    split_total: float
    split_missing: list[str]
    savings_vs_single: float                        # best_single.total - split_total (only over items both cover)


# ---- barcode ----------------------------------------------------------------
class BarcodeResponse(SQLModel):
    barcode: str
    product_name: Optional[str]                     # resolved name (from our data or Open Food Facts)
    source: str                                     # "offers" | "openfoodfacts" | "unknown"
    exact: list[OfferRead]                          # offers carrying this exact barcode
    similar: list[OfferRead]                        # fuzzy matches by name, cheapest first


# ---- watch / push -----------------------------------------------------------
class PushRegister(SQLModel):
    token: str
    platform: str = "android"


class WatchCreate(SQLModel):
    token: str
    query: str
    barcode: Optional[str] = None
    image_url: Optional[str] = None
    exact: bool = False
    target_price: Optional[float] = None
    store: Optional[str] = None


class WatchRead(SQLModel):
    id: int
    query: str
    barcode: Optional[str] = None
    image_url: Optional[str] = None
    exact: bool = False
    target_price: Optional[float]
    store: Optional[str]
    created_at: datetime
    current_best: Optional[OfferRead] = None        # cheapest matching offer right now
    hit: bool = False                               # current_best meets the target
    last_notified_at: Optional[datetime]


# ---- restaurants (delivery comparison) --------------------------------------
class RestaurantRead(SQLModel):
    id: int
    platform: str
    external_id: str = ""                           # Wolt slug / Bolt provider id (key into /api/food/nearby)
    name: str
    group_key: str
    url: str
    image_url: Optional[str]
    address: Optional[str]
    tags: list[str] = []
    rating: Optional[float]
    rating_count: Optional[int]
    delivery_minutes: Optional[int]
    delivery_fee: Optional[float]
    price_range: Optional[int]
    online: bool
    dish_count: int = 0

    @classmethod
    def from_row(cls, r: "Restaurant", dish_count: int = 0) -> "RestaurantRead":
        data = r.model_dump()
        data["tags"] = [t for t in (r.tags or "").split(",") if t]
        return cls(**data, dish_count=dish_count)


class RestaurantGroup(SQLModel):
    """One real-world restaurant with its listings on every platform we know."""
    group_key: str
    name: str
    image_url: Optional[str]
    tags: list[str] = []
    cuisines: list[str] = []                        # canonical cuisine keys (union of the listings)
    listings: list[RestaurantRead]                  # one per platform
    cheapest_delivery_platform: Optional[str] = None


class DishRead(SQLModel):
    id: int
    platform: str
    name: str
    description: Optional[str]
    category: Optional[str]
    price: float
    original_price: Optional[float]
    image_url: Optional[str]
    kind: str = "main"
    discount_pct: Optional[int] = None              # when original_price > price
    restaurant_id: int
    restaurant_name: str
    restaurant_url: str
    restaurant_group: Optional[str] = None
    restaurant_external_id: Optional[str] = None    # Wolt slug / Bolt provider id, key into /api/food/nearby
    delivery_minutes: Optional[int] = None
    delivery_fee: Optional[float] = None
    score: Optional[int] = None


class DishCompare(SQLModel):
    """The same dish across platforms (matched by name inside one restaurant group)."""
    name: str
    offers: list[DishRead]                          # cheapest first
    cheapest_platform: str
    savings: float                                  # most expensive - cheapest


class RestaurantDetail(SQLModel):
    group: RestaurantGroup
    categories: list[str]
    dishes: list[DishCompare]                       # every dish, with per-platform prices


class FoodStatus(SQLModel):
    city: str
    platforms: dict[str, int]                       # restaurants per platform
    dishes: int
    deals: int = 0                                  # dishes currently discounted on some platform
    cuisines: dict[str, int] = {}                   # cuisine key -> restaurants (groups)
    last_scraped: Optional[datetime]
    scraping: bool


# ---- list inbox (chat bridge) -----------------------------------------------
class InboxAdd(SQLModel):
    item_name: str
    added_by: str = "chat_bridge"
    raw_message: Optional[str] = None
    barcode: Optional[str] = None
    image_url: Optional[str] = None
    exact: bool = False
    price: Optional[float] = None
    store: Optional[str] = None


class InboxRead(SQLModel):
    id: int
    item_name: str
    added_by: str
    raw_message: Optional[str] = None
    barcode: Optional[str] = None
    image_url: Optional[str] = None
    exact: bool = False
    price: Optional[float] = None
    store: Optional[str] = None
    created_at: datetime


class InboxAck(SQLModel):
    ids: list[int]
