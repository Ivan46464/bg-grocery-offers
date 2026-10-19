"""
BG Grocery Offers API  -  FastAPI entry point.

Run locally:   uvicorn main:app --reload
Docs:          http://127.0.0.1:8000/docs

Endpoints
  GET  /                      -> service info
  GET  /health                -> {"status": "ok"}  (used by Render health checks)
  GET  /api/search?q=сирене   -> fuzzy search, cheapest first
  GET  /api/offers            -> browse all offers (optional ?store=Lidl)
  GET  /api/stores            -> per-store offer counts + mock flag
  POST /api/refresh?token=…   -> re-run all scrapers now (protected by REFRESH_TOKEN)

Scraping schedule
  * On startup, if the DB is empty, scrapers run once in the background.
  * Then every SCRAPE_INTERVAL_HOURS (default 12) while the server is up.
  * Free hosts sleep when idle, so also point an external cron (cron-job.org)
    at POST /api/refresh once a day - see README.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, func, select

from database import engine, get_session, init_db
from models import Offer, OfferRead, StoreStatus
from scraper import STORE_NAMES, offers_count, run_all_scrapers
from search import search_offers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")

SCRAPE_INTERVAL_HOURS = float(os.getenv("SCRAPE_INTERVAL_HOURS", "12"))
REFRESH_TOKEN = os.getenv("REFRESH_TOKEN", "")          # empty = /api/refresh is open (fine for dev)
SCRAPE_ON_STARTUP = os.getenv("SCRAPE_ON_STARTUP", "auto")  # auto | always | never

_scrape_lock = asyncio.Lock()


# --------------------------------------------------------------------------- #
# Scraping helpers
# --------------------------------------------------------------------------- #
def _scrape_sync() -> dict:
    with Session(engine) as session:
        return run_all_scrapers(session)


async def scrape_now() -> dict:
    """Run all scrapers in a worker thread (they use blocking HTTP). Serialised by a lock."""
    async with _scrape_lock:
        log.info("Scrape started")
        summary = await asyncio.to_thread(_scrape_sync)
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
        asyncio.create_task(scrape_now())        # don't block startup
    periodic = asyncio.create_task(_periodic_scraper())
    yield
    periodic.cancel()


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #
app = FastAPI(
    title="BG Grocery Offers API",
    description="Weekly promotions from Lidl, Kaufland, Billa and Metro (Bulgaria), searchable in one place.",
    version="1.0.0",
    lifespan=lifespan,
)

# The mobile app calls us from any origin; nothing here is sensitive.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _to_read(offer: Offer, score: Optional[int] = None) -> OfferRead:
    return OfferRead(**offer.model_dump(), score=score)


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
    return {"status": "ok", "time": datetime.utcnow().isoformat() + "Z"}


@app.get("/api/search", response_model=list[OfferRead], tags=["offers"])
def search(
    q: str = Query(..., min_length=1, max_length=80, description="Product to look for, e.g. 'сирене' or 'cheese'"),
    store: Optional[str] = Query(None, description="Limit to one store: Lidl | Kaufland | Billa | Metro"),
    sort: str = Query("price", pattern="^(price|score|discount)$"),
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    """Fuzzy search across all stores. Default order: cheapest first."""
    stmt = select(Offer)
    if store:
        stmt = stmt.where(func.lower(Offer.store) == store.lower())
    offers = session.exec(stmt).all()
    hits = search_offers(offers, q, sort=sort)
    return [_to_read(o, s) for o, s in hits[:limit]]


@app.get("/api/offers", response_model=list[OfferRead], tags=["offers"])
def list_offers(
    store: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    """Browse offers without a search term (cheapest first)."""
    stmt = select(Offer)
    if store:
        stmt = stmt.where(func.lower(Offer.store) == store.lower())
    stmt = stmt.order_by(Offer.discounted_price).offset(offset).limit(limit)
    return [_to_read(o) for o in session.exec(stmt).all()]


@app.get("/api/stores", response_model=list[StoreStatus], tags=["offers"])
def stores(session: Session = Depends(get_session)):
    """How many offers each store has and whether they're real or demo data."""
    out: list[StoreStatus] = []
    for name in STORE_NAMES:
        rows = session.exec(select(Offer).where(Offer.store == name)).all()
        out.append(
            StoreStatus(
                store=name,
                offers=len(rows),
                is_mock=bool(rows) and all(r.is_mock for r in rows),
                last_scraped=max((r.scraped_at for r in rows), default=None),
            )
        )
    return out


@app.post("/api/refresh", tags=["admin"])
async def refresh(token: str = Query("", description="Must equal the REFRESH_TOKEN env var")):
    """Re-scrape every store right now. Call this from a daily cron."""
    if REFRESH_TOKEN and token != REFRESH_TOKEN:
        raise HTTPException(status_code=401, detail="Bad token")
    summary = await scrape_now()
    return {"ok": True, "stores": summary}
