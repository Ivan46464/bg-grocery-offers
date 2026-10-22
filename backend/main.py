"""
BG Grocery Offers API  -  FastAPI entry point.

Run locally:   uvicorn main:app --reload
Docs:          http://127.0.0.1:8000/docs

Endpoints
  GET  /                            -> service info
  GET  /health                      -> {"status": "ok"}  (uptime pings)
  GET  /api/status                  -> scraping flag + per-store counts (app polls this on cold start)
  GET  /api/stores                  -> per-store counts
  GET  /api/tags                    -> quick-filter chips with counts
  GET  /api/search?q=сирене&tag=    -> fuzzy search, cheapest first
  GET  /api/offers?store=&tag=      -> browse
  GET  /api/offers/{id}             -> one offer
  GET  /api/offers/{id}/history     -> 90-day price points for the trend line
  GET  /api/barcode/{ean}           -> offers for a scanned barcode (exact + by name)
  POST /api/cart/optimize           -> best single store / best split trip for a list
  POST /api/cart/add                -> add an item to the list inbox (LoveChat chat bridge)
  GET  /api/cart/inbox              -> unconsumed inbox items (the app merges them into its list)
  POST /api/cart/inbox/ack          -> mark inbox items as merged
  POST /api/push/register           -> save an Expo push token
  GET/POST/DELETE /api/watch        -> price-drop watchlist
  POST /api/refresh?token=…         -> re-run all scrapers now (protected by REFRESH_TOKEN)

Scraping schedule
  * On startup, if the DB is empty, scrapers run once in the background.
  * Then every SCRAPE_INTERVAL_HOURS (default 12) while the server is up.
  * Free hosts sleep when idle, so a GitHub Actions cron (.github/workflows/keepalive.yml)
    pings /health every 10 min and POSTs /api/refresh daily.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, func, select

import barcode as barcode_mod
from cart import optimize
from catalog import catalog_search, match_offers, similar_offers
from database import engine, get_session, init_db
from history import history_for
from models import (
    BarcodeResponse,
    CartRequest,
    CartResponse,
    CatalogItem,
    Dish,
    DishCompare,
    DishRead,
    FoodStatus,
    HistoryPoint,
    Restaurant,
    RestaurantDetail,
    RestaurantGroup,
    RestaurantRead,
    InboxAck,
    InboxAdd,
    InboxRead,
    ListInbox,
    Offer,
    OfferHistory,
    OfferRead,
    PushRegister,
    PushToken,
    ServiceStatus,
    SimilarResponse,
    StoreStatus,
    TagInfo,
    Watch,
    WatchCreate,
    WatchRead,
    utcnow,
)
from push import best_match, check_watches, meets_target
from rapidfuzz import fuzz
from restaurants import run_all_restaurant_scrapers, same_dish
from scraper import STORE_NAMES, offers_count, run_all_scrapers
from search import search_offers
from tags import TAGS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")

SCRAPE_INTERVAL_HOURS = float(os.getenv("SCRAPE_INTERVAL_HOURS", "12"))
REFRESH_TOKEN = os.getenv("REFRESH_TOKEN", "")          # empty = /api/refresh is open (fine for dev)
BRIDGE_TOKEN = os.getenv("BRIDGE_TOKEN", "")            # optional: required as X-API-Key on POST /api/cart/add
SCRAPE_ON_STARTUP = os.getenv("SCRAPE_ON_STARTUP", "auto")  # auto | always | never

_scrape_lock = asyncio.Lock()
_food_lock = asyncio.Lock()
_state = {"scraping": False, "last_finished": None, "food_scraping": False}
FOOD_INTERVAL_HOURS = float(os.getenv("FOOD_INTERVAL_HOURS", "24"))


def _food_scrape_sync() -> dict:
    with Session(engine) as session:
        return run_all_restaurant_scrapers(session)


async def food_scrape_now() -> dict:
    async with _food_lock:
        _state["food_scraping"] = True
        try:
            return await asyncio.to_thread(_food_scrape_sync)
        finally:
            _state["food_scraping"] = False


async def _periodic_food_scraper(initial_delay: float) -> None:
    await asyncio.sleep(initial_delay)
    while True:
        try:
            log.info("Restaurant scrape: %s", await food_scrape_now())
        except Exception:  # noqa: BLE001
            log.exception("Restaurant scrape failed")
        await asyncio.sleep(FOOD_INTERVAL_HOURS * 3600)


# --------------------------------------------------------------------------- #
# Scraping helpers
# --------------------------------------------------------------------------- #
def _scrape_sync() -> dict:
    with Session(engine) as session:
        summary = run_all_scrapers(session)
        try:
            alerts = check_watches(session)
            if alerts:
                log.info("watchlist: %d alert(s) sent", alerts)
        except Exception:  # noqa: BLE001
            log.exception("watchlist check failed")
        return summary


async def scrape_now() -> dict:
    """Run all scrapers in a worker thread (they use blocking HTTP). Serialised by a lock."""
    async with _scrape_lock:
        _state["scraping"] = True
        log.info("Scrape started")
        try:
            summary = await asyncio.to_thread(_scrape_sync)
        finally:
            _state["scraping"] = False
            _state["last_finished"] = utcnow()
        log.info("Scrape finished: %s", summary)
        return summary


async def _periodic_scraper() -> None:
    while True:
        await asyncio.sleep(SCRAPE_INTERVAL_HOURS * 3600)
        try:
            await scrape_now()
        except Exception:  # noqa: BLE001
            log.exception("Periodic scrape failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with Session(engine) as session:
        empty = offers_count(session) == 0
    if SCRAPE_ON_STARTUP == "always" or (SCRAPE_ON_STARTUP == "auto" and empty):
        _state["scraping"] = True                # so /api/status says "loading" even before the task starts
        asyncio.create_task(scrape_now())        # don't block startup
    periodic = asyncio.create_task(_periodic_scraper())
    with Session(engine) as session:
        food_empty = session.exec(select(Restaurant.id).limit(1)).first() is None
    # restaurants: right away when empty (after the offers get a head start), then daily
    food_task = asyncio.create_task(_periodic_food_scraper(90 if food_empty else FOOD_INTERVAL_HOURS * 3600))
    yield
    periodic.cancel()
    food_task.cancel()


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #
app = FastAPI(
    title="BG Grocery Offers API",
    description="Weekly promotions from Lidl, Kaufland, Billa and Metro (Bulgaria), searchable in one place.",
    version="2.0.0",
    lifespan=lifespan,
)

# The mobile app calls us from any origin; nothing here is sensitive.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _offers_query(store: Optional[str], tag: Optional[str], promo: str = "all"):
    """promo = 'promo' (promotions only) | 'regular' (shelf prices only) | 'all'."""
    stmt = select(Offer)
    if store:
        stmt = stmt.where(func.lower(Offer.store) == store.lower())
    if tag:
        stmt = stmt.where(Offer.tags.contains(tag.lower()))
    if promo == "promo":
        stmt = stmt.where(Offer.is_promo == True)  # noqa: E712
    elif promo == "regular":
        stmt = stmt.where(Offer.is_promo == False)  # noqa: E712
    return stmt


def _store_statuses(session: Session) -> list[StoreStatus]:
    out: list[StoreStatus] = []
    for name in STORE_NAMES:
        rows = session.exec(select(Offer.is_mock, Offer.scraped_at, Offer.is_promo).where(Offer.store == name)).all()
        promo_rows = [r for r in rows if r[2]]
        out.append(
            StoreStatus(
                store=name,
                offers=len(promo_rows),
                regular=len(rows) - len(promo_rows),
                is_mock=bool(rows) and all(r[0] for r in rows),
                last_scraped=max((r[1] for r in rows), default=None),
            )
        )
    return out


# ---- meta -------------------------------------------------------------------
@app.get("/", tags=["meta"])
def root():
    return {
        "name": app.title,
        "version": app.version,
        "docs": "/docs",
        "search_example": "/api/search?q=сирене",
        "stores": STORE_NAMES,
    }


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/status", response_model=ServiceStatus, tags=["meta"])
def status(session: Session = Depends(get_session)):
    """What the app checks first: are we still loading, and how much data is there."""
    stores = _store_statuses(session)
    return ServiceStatus(
        scraping=_state["scraping"],
        total_offers=sum(s.offers for s in stores),
        last_scrape_finished=_state["last_finished"],
        stores=stores,
    )


@app.get("/api/stores", response_model=list[StoreStatus], tags=["offers"])
def stores(session: Session = Depends(get_session)):
    return _store_statuses(session)


@app.get("/api/tags", response_model=list[TagInfo], tags=["offers"])
def list_tags(store: Optional[str] = None, promo: str = Query("all", pattern="^(promo|regular|all)$"), session: Session = Depends(get_session)):
    rows = session.exec(_offers_query(store, None, promo).with_only_columns(Offer.tags)).all()
    counts: dict[str, int] = {}
    for tags in rows:
        for t in (tags or "").split(","):
            if t:
                counts[t] = counts.get(t, 0) + 1
    return [TagInfo(tag=t, label=label, count=counts.get(t, 0)) for t, label in TAGS if counts.get(t)]


# ---- offers -----------------------------------------------------------------
@app.get("/api/search", response_model=list[OfferRead], tags=["offers"])
def search(
    q: str = Query(..., min_length=1, max_length=80, description="Product to look for, e.g. 'сирене' or 'cheese'"),
    store: Optional[str] = Query(None, description="Limit to one store: Lidl | Kaufland | Billa | Metro"),
    tag: Optional[str] = Query(None, description="Limit to a quick-filter tag, e.g. 'млечни'"),
    promo: str = Query("all", pattern="^(promo|regular|all)$", description="promotions only, regular shelf prices only, or everything"),
    sort: str = Query("price", pattern="^(price|score|discount)$"),
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    """Fuzzy search across all stores. Default order: cheapest first."""
    offers = session.exec(_offers_query(store, tag, promo)).all()
    hits = search_offers(offers, q, sort=sort)
    return [OfferRead.from_offer(o, s) for o, s in hits[:limit]]


@app.get("/api/offers", response_model=list[OfferRead], tags=["offers"])
def list_offers(
    store: Optional[str] = None,
    tag: Optional[str] = None,
    promo: str = Query("promo", pattern="^(promo|regular|all)$"),
    sort: str = Query("price", pattern="^(price|discount|newest)$"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    """Browse offers without a search term (promotions by default; promo=all for the full catalogue)."""
    stmt = _offers_query(store, tag, promo)
    if sort == "discount":
        stmt = stmt.order_by(Offer.discount_percent.desc().nullslast(), Offer.effective_price)
    elif sort == "newest":
        stmt = stmt.order_by(Offer.valid_from.desc().nullslast(), Offer.effective_price)
    else:
        stmt = stmt.order_by(Offer.effective_price)
    return [OfferRead.from_offer(o) for o in session.exec(stmt.offset(offset).limit(limit)).all()]


@app.get("/api/offers/{offer_id}", response_model=OfferRead, tags=["offers"])
def get_offer(offer_id: int, session: Session = Depends(get_session)):
    offer = session.get(Offer, offer_id)
    if not offer:
        raise HTTPException(404, "Offer not found")
    return OfferRead.from_offer(offer)


@app.get("/api/offers/{offer_id}/similar", response_model=SimilarResponse, tags=["offers"])
def offer_similar(offer_id: int, session: Session = Depends(get_session)):
    """
    For one offer: the SAME product in other stores (strict match / barcode) and
    SIMILAR products anywhere (same kind of thing, e.g. other waters). Pure
    string matching - no external AI service involved.
    """
    offer = session.get(Offer, offer_id)
    if not offer:
        raise HTTPException(404, "Offer not found")
    others = [o for o in session.exec(select(Offer)).all() if o.id != offer.id]
    same = [o for o, _ in match_offers(others, offer.product_name, offer.barcode) if o.store != offer.store]
    same_ids = {o.id for o in same}
    # similar: the same KIND of product ("вода" -> other waters, "изворна" ones first), brand dropped
    loose, q = similar_offers([o for o in others if o.id not in same_ids], offer)
    return SimilarResponse(
        offer=OfferRead.from_offer(offer),
        same_elsewhere=[OfferRead.from_offer(o) for o in same[:10]],
        similar=[OfferRead.from_offer(o, s) for o, s in loose[:20]],
        query=q,
    )


@app.get("/api/offers/{offer_id}/history", response_model=OfferHistory, tags=["offers"])
def offer_history(offer_id: int, days: int = Query(90, ge=7, le=400), session: Session = Depends(get_session)):
    offer = session.get(Offer, offer_id)
    if not offer:
        raise HTTPException(404, "Offer not found")
    rows = history_for(session, offer, days)
    prices = [r.price for r in rows]
    return OfferHistory(
        offer_id=offer.id,
        store=offer.store,
        product_name=offer.product_name,
        points=[HistoryPoint(seen_at=r.seen_at, price=r.price, original_price=r.original_price) for r in rows],
        lowest_90d=min(prices) if prices else None,
        highest_90d=max(prices) if prices else None,
        is_lowest_90d=offer.is_lowest_90d,
    )


# ---- barcode ----------------------------------------------------------------
@app.get("/api/barcode/{code}", response_model=BarcodeResponse, tags=["barcode"])
def barcode_lookup(code: str, session: Session = Depends(get_session)):
    code = code.strip()
    if not barcode_mod.is_valid_code(code):
        raise HTTPException(400, "Not an EAN/UPC code")
    # EAN-13 and UPC-A/GTIN-14 variants of the same product
    variants = {code, code.lstrip("0"), code.zfill(13), code.zfill(14)}
    exact = session.exec(select(Offer).where(Offer.barcode.in_(variants)).order_by(Offer.effective_price)).all()

    name: Optional[str] = exact[0].product_name if exact else None
    source = "offers" if exact else "unknown"
    queries: list[str] = [name] if name else []
    if not name:
        product = barcode_mod.lookup_product(code)
        if product:
            name, source = product["label"], "openfoodfacts"
            queries = barcode_mod.search_queries(product)

    similar: list[OfferRead] = []
    if queries:
        exact_ids = {o.id for o in exact}
        offers = session.exec(select(Offer)).all()
        best: dict[int, tuple[Offer, int]] = {}
        for q in queries:
            for o, s in search_offers(offers, q, sort="price", threshold=70):
                if o.id not in exact_ids and (o.id not in best or s > best[o.id][1]):
                    best[o.id] = (o, s)
        ranked = sorted(best.values(), key=lambda t: (t[0].effective_price, -t[1]))
        similar = [OfferRead.from_offer(o, s) for o, s in ranked[:20]]

    return BarcodeResponse(
        barcode=code,
        product_name=name,
        source=source,
        exact=[OfferRead.from_offer(o) for o in exact],
        similar=similar,
    )


# ---- catalog ----------------------------------------------------------------
@app.get("/api/catalog/search", response_model=list[CatalogItem], tags=["catalog"])
def catalog_lookup(q: str = Query(..., min_length=2, max_length=80), limit: int = Query(20, ge=1, le=50), session: Session = Depends(get_session)):
    """Specific products to pick for the cart / watchlist: current offers + METRO's catalogue."""
    return catalog_search(session.exec(select(Offer)).all(), q, limit)


# ---- cart -------------------------------------------------------------------
@app.post("/api/cart/optimize", response_model=CartResponse, tags=["cart"])
def cart_optimize(req: CartRequest, session: Session = Depends(get_session)):
    if not req.items:
        raise HTTPException(400, "items is empty")
    if len(req.items) > 40:
        raise HTTPException(400, "max 40 items")
    stores = [s for s in STORE_NAMES if not req.stores or s.lower() in {x.lower() for x in req.stores}]
    offers = session.exec(select(Offer).where(Offer.store.in_(stores))).all()
    return optimize(req.items, offers, stores)


# ---- list inbox (chat bridge) -----------------------------------------------
def _inbox_read(row: ListInbox) -> InboxRead:
    return InboxRead(
        id=row.id, item_name=row.item_name, added_by=row.added_by, raw_message=row.raw_message,
        barcode=row.barcode, image_url=row.image_url, exact=bool(row.exact), price=row.price, store=row.store, created_at=row.created_at,
    )


@app.post("/api/cart/add", response_model=InboxRead, tags=["cart"])
def cart_add(body: InboxAdd, x_api_key: Optional[str] = Header(default=None), session: Session = Depends(get_session)):
    """Called by LoveChat when someone writes "купи домати" in the chat. Lands in the list inbox."""
    if BRIDGE_TOKEN and x_api_key != BRIDGE_TOKEN:
        raise HTTPException(status_code=401, detail="Bad API key")
    name = body.item_name.strip()
    if not name:
        raise HTTPException(400, "item_name is empty")
    dup = select(ListInbox).where(ListInbox.consumed_at.is_(None))
    dup = dup.where(ListInbox.barcode == body.barcode) if body.barcode else dup.where(func.lower(ListInbox.item_name) == name.lower())
    existing = session.exec(dup).first()
    if existing:
        return _inbox_read(existing)
    row = ListInbox(
        item_name=name[:200], added_by=(body.added_by or "chat_bridge")[:50], raw_message=(body.raw_message or "")[:1000] or None,
        barcode=body.barcode, image_url=body.image_url, exact=bool(body.exact or body.barcode), price=body.price, store=body.store,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    log.info("inbox: +%r from %s", name, row.added_by)
    return _inbox_read(row)


@app.get("/api/cart/inbox", response_model=list[InboxRead], tags=["cart"])
def cart_inbox(session: Session = Depends(get_session)):
    rows = session.exec(select(ListInbox).where(ListInbox.consumed_at.is_(None)).order_by(ListInbox.created_at)).all()
    return [_inbox_read(r) for r in rows]


@app.post("/api/cart/inbox/ack", tags=["cart"])
def cart_inbox_ack(body: InboxAck, session: Session = Depends(get_session)):
    n = 0
    for row in session.exec(select(ListInbox).where(ListInbox.id.in_(body.ids), ListInbox.consumed_at.is_(None))).all():
        row.consumed_at = utcnow()
        session.add(row)
        n += 1
    session.commit()
    return {"ok": True, "acknowledged": n}


@app.delete("/api/cart/inbox/{item_id}", tags=["cart"])
def cart_inbox_delete(item_id: int, session: Session = Depends(get_session)):
    row = session.get(ListInbox, item_id)
    if row:
        session.delete(row)
        session.commit()
    return {"ok": True}


# ---- push / watchlist -------------------------------------------------------
@app.post("/api/push/register", tags=["watch"])
def push_register(body: PushRegister, session: Session = Depends(get_session)):
    row = session.exec(select(PushToken).where(PushToken.token == body.token)).first()
    if row:
        row.last_seen = utcnow()
        row.platform = body.platform
    else:
        row = PushToken(token=body.token, platform=body.platform)
    session.add(row)
    session.commit()
    return {"ok": True, "push_capable": body.token.startswith("ExponentPushToken")}


def _watch_read(w: Watch, offers: list[Offer]) -> WatchRead:
    best = best_match(w, offers)
    return WatchRead(
        id=w.id,
        query=w.query,
        barcode=w.barcode,
        image_url=w.image_url,
        exact=w.exact,
        target_price=w.target_price,
        store=w.store,
        created_at=w.created_at,
        current_best=OfferRead.from_offer(best) if best else None,
        hit=meets_target(w, best),
        last_notified_at=w.last_notified_at,
    )


@app.get("/api/watch", response_model=list[WatchRead], tags=["watch"])
def list_watches(token: str, session: Session = Depends(get_session)):
    watches = session.exec(select(Watch).where(Watch.token == token).order_by(Watch.created_at.desc())).all()
    offers = session.exec(select(Offer)).all() if watches else []
    return [_watch_read(w, offers) for w in watches]


@app.post("/api/watch", response_model=WatchRead, tags=["watch"])
def create_watch(body: WatchCreate, session: Session = Depends(get_session)):
    q = body.query.strip()
    if not q:
        raise HTTPException(400, "query is empty")
    count = len(session.exec(select(Watch.id).where(Watch.token == body.token)).all())
    if count >= 50:
        raise HTTPException(400, "max 50 watches per device")
    w = Watch(token=body.token, query=q, barcode=body.barcode, image_url=body.image_url, exact=body.exact,
              target_price=body.target_price, store=body.store)
    session.add(w)
    session.commit()
    session.refresh(w)
    return _watch_read(w, session.exec(select(Offer)).all())


@app.delete("/api/watch/{watch_id}", tags=["watch"])
def delete_watch(watch_id: int, token: str, session: Session = Depends(get_session)):
    w = session.get(Watch, watch_id)
    if not w or w.token != token:
        raise HTTPException(404, "Watch not found")
    session.delete(w)
    session.commit()
    return {"ok": True}


# ---- restaurants (Varna delivery comparison) --------------------------------
def _dish_read(d: Dish, r: Restaurant, score: Optional[int] = None) -> DishRead:
    return DishRead(
        id=d.id, platform=d.platform, name=d.name, description=d.description, category=d.category, price=d.price,
        original_price=d.original_price, image_url=d.image_url, restaurant_id=r.id, restaurant_name=r.name,
        restaurant_url=r.url, delivery_minutes=r.delivery_minutes, delivery_fee=r.delivery_fee, score=score,
    )


def _groups(rows: list[Restaurant], counts: dict[int, int]) -> list[RestaurantGroup]:
    by_key: dict[str, list[Restaurant]] = {}
    for r in rows:
        by_key.setdefault(r.group_key, []).append(r)
    out = []
    for key, listings in by_key.items():
        listings.sort(key=lambda r: r.platform)
        with_fee = [r for r in listings if r.delivery_fee is not None]
        cheapest = min(with_fee, key=lambda r: r.delivery_fee).platform if with_fee else None
        out.append(
            RestaurantGroup(
                group_key=key, name=listings[0].name, image_url=next((r.image_url for r in listings if r.image_url), None),
                tags=[t for t in (listings[0].tags or "").split(",") if t],
                listings=[RestaurantRead.from_row(r, counts.get(r.id, 0)) for r in listings],
                cheapest_delivery_platform=cheapest,
            )
        )
    return out


@app.get("/api/food/status", response_model=FoodStatus, tags=["food"])
def food_status(session: Session = Depends(get_session)):
    rows = session.exec(select(Restaurant.platform, Restaurant.scraped_at)).all()
    platforms: dict[str, int] = {}
    for p, _ in rows:
        platforms[p] = platforms.get(p, 0) + 1
    dishes = session.exec(select(func.count(Dish.id))).one()
    return FoodStatus(city="Varna", platforms=platforms, dishes=int(dishes or 0), last_scraped=max((s for _, s in rows), default=None), scraping=_state["food_scraping"])


@app.get("/api/food/restaurants", response_model=list[RestaurantGroup], tags=["food"])
def food_restaurants(q: Optional[str] = None, tag: Optional[str] = None, limit: int = Query(60, ge=1, le=300), session: Session = Depends(get_session)):
    """Restaurants in Varna grouped across platforms; optional name/tag filter."""
    rows = session.exec(select(Restaurant)).all()
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in r.name.lower() or fuzz.partial_ratio(ql, r.name.lower()) >= 85 or ql in (r.tags or "")]
    if tag:
        rows = [r for r in rows if tag.lower() in (r.tags or "").lower()]
    counts = {rid: n for rid, n in session.exec(select(Dish.restaurant_id, func.count(Dish.id)).group_by(Dish.restaurant_id)).all()}
    groups = _groups(rows, counts)
    groups.sort(key=lambda g: (-(max((l.rating or 0) for l in g.listings)), g.name))
    return groups[:limit]


@app.get("/api/food/restaurants/{group_key}", response_model=RestaurantDetail, tags=["food"])
def food_restaurant(group_key: str, session: Session = Depends(get_session)):
    """One restaurant with every dish and, per dish, the price on each platform."""
    rows = session.exec(select(Restaurant).where(Restaurant.group_key == group_key)).all()
    if not rows:
        raise HTTPException(404, "Restaurant not found")
    by_id = {r.id: r for r in rows}
    dishes = session.exec(select(Dish).where(Dish.restaurant_id.in_(list(by_id)))).all()
    counts: dict[int, int] = {}
    for d in dishes:
        counts[d.restaurant_id] = counts.get(d.restaurant_id, 0) + 1
    group = _groups(rows, counts)[0]
    # merge the same dish across platforms
    merged: list[list[Dish]] = []
    for d in sorted(dishes, key=lambda x: (x.category or "", x.name)):
        for bucket in merged:
            if same_dish(bucket[0].name, d.name):
                bucket.append(d)
                break
        else:
            merged.append([d])
    compares = []
    for bucket in merged:
        reads = sorted((_dish_read(d, by_id[d.restaurant_id]) for d in bucket), key=lambda x: x.price)
        # several branches of a chain on the same platform -> keep the cheapest per platform
        per_platform: dict[str, DishRead] = {}
        for r in reads:
            per_platform.setdefault(r.platform, r)
        reads = list(per_platform.values())
        compares.append(DishCompare(name=bucket[0].name, offers=reads, cheapest_platform=reads[0].platform, savings=round(reads[-1].price - reads[0].price, 2)))
    cats = sorted({d.category for d in dishes if d.category})
    return RestaurantDetail(group=group, categories=cats, dishes=compares)


@app.get("/api/food/search", response_model=list[DishRead], tags=["food"])
def food_search(q: str = Query(..., min_length=2, max_length=60), limit: int = Query(60, ge=1, le=200), session: Session = Depends(get_session)):
    """Dishes across all Varna restaurants and platforms, cheapest first ('пица маргарита', 'бургер')."""
    rows = session.exec(select(Dish)).all()
    rests = {r.id: r for r in session.exec(select(Restaurant)).all()}
    ql = q.lower().strip()
    extras = ("сос", "соус", "добавка", "допълнител", "екстра", "топинг", "кетчуп", "майонеза", "салфетк", "прибори")
    asked_extra = any(w in ql for w in extras)
    best: dict[tuple, tuple[int, Dish]] = {}
    for d in rows:
        r = rests.get(d.restaurant_id)
        if not r:
            continue
        nl = d.name.lower()
        s = 100 if ql in nl else int(max(fuzz.partial_ratio(ql, nl), fuzz.token_set_ratio(ql, nl)))
        if s < 80:
            continue
        if not asked_extra and any(w in nl for w in extras):
            s -= 25                                     # "Бургер сос" is not a burger
        if s < 70:
            continue
        # one row per (restaurant chain, platform, dish): branches of a chain repeat the same menu
        key = (r.group_key, d.platform, d.name_key)
        cur = best.get(key)
        if cur is None or d.price < cur[1].price:
            best[key] = (s, d)
    hits = sorted(best.values(), key=lambda t: (-(t[0] >= 95), t[1].price, -t[0]))   # exact matches first, then cheapest
    return [_dish_read(d, rests[d.restaurant_id], s) for s, d in hits[:limit]]


# ---- admin ------------------------------------------------------------------
@app.post("/api/refresh", tags=["admin"])
async def refresh(token: str = Query("", description="Must equal the REFRESH_TOKEN env var"), what: str = Query("stores", pattern="^(stores|food)$")):
    """Re-scrape every store (or the restaurants) right now."""
    if REFRESH_TOKEN and token != REFRESH_TOKEN:
        raise HTTPException(status_code=401, detail="Bad token")
    summary = await (food_scrape_now() if what == "food" else scrape_now())
    return {"ok": True, what: summary}
