"""
Price history + "fake discount" detection.

Every scrape appends one PriceHistory row per offer (deduped: we don't add a
new row if the latest row for that product already has the same price today).
After the scrape, `annotate_lowest_90d()` writes `lowest_90d` / `is_lowest_90d`
onto each current Offer so the app can show a "най-ниска цена за 90 дни" badge
or warn that the product was cheaper recently.

Note for Render's free tier: the SQLite file lives on an ephemeral disk, so
history only accumulates between deploys. Point DATABASE_URL at a free Postgres
(Neon, Supabase) to keep it forever - no code change needed.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Optional

from sqlmodel import Session, delete, select

from models import Offer, PriceHistory, utcnow

log = logging.getLogger("history")

WINDOW_DAYS = 90
KEEP_DAYS = 400


def record_history(session: Session, offers: list[Offer]) -> int:
    """Append today's prices. Returns the number of rows written."""
    today = utcnow().date()
    written = 0
    for o in offers:
        if o.is_mock:
            continue
        last = session.exec(
            select(PriceHistory)
            .where(PriceHistory.store == o.store, PriceHistory.name_key == o.name_key)
            .order_by(PriceHistory.seen_at.desc())
            .limit(1)
        ).first()
        if last and last.price == o.discounted_price:
            continue                      # only record price CHANGES (keeps 10k catalogue rows from piling up daily)
        session.add(
            PriceHistory(
                store=o.store,
                name_key=o.name_key,
                product_name=o.product_name,
                barcode=o.barcode,
                price=o.discounted_price,
                original_price=o.original_price,
            )
        )
        written += 1
    session.commit()
    return written


def annotate_lowest_90d(session: Session, store: Optional[str] = None) -> None:
    """Fill Offer.lowest_90d / is_lowest_90d from history (per store)."""
    since = utcnow() - timedelta(days=WINDOW_DAYS)
    stmt = select(Offer)
    if store:
        stmt = stmt.where(Offer.store == store)
    offers = session.exec(stmt).all()

    # Pull the window once per store and fold to {name_key: (min, n_days)}.
    stores = {o.store for o in offers}
    lows: dict[tuple[str, str], tuple[float, set]] = {}
    for s in stores:
        rows = session.exec(
            select(PriceHistory.name_key, PriceHistory.price, PriceHistory.seen_at)
            .where(PriceHistory.store == s, PriceHistory.seen_at >= since)
        ).all()
        for key, price, seen in rows:
            cur = lows.get((s, key))
            if cur is None:
                lows[(s, key)] = (price, {seen.date()})
            else:
                cur[1].add(seen.date())
                lows[(s, key)] = (min(cur[0], price), cur[1])

    for o in offers:
        entry = lows.get((o.store, o.name_key))
        if not entry or len(entry[1]) < 2:
            # Fewer than two distinct days of data -> we honestly don't know yet.
            o.lowest_90d = entry[0] if entry else None
            o.is_lowest_90d = None
        else:
            o.lowest_90d = entry[0]
            o.is_lowest_90d = o.discounted_price <= entry[0] + 0.005
        session.add(o)
    session.commit()


def prune_history(session: Session) -> None:
    cutoff = utcnow() - timedelta(days=KEEP_DAYS)
    session.exec(delete(PriceHistory).where(PriceHistory.seen_at < cutoff))
    session.commit()


def history_for(session: Session, offer: Offer, days: int = WINDOW_DAYS) -> list[PriceHistory]:
    since = utcnow() - timedelta(days=days)
    return session.exec(
        select(PriceHistory)
        .where(
            PriceHistory.store == offer.store,
            PriceHistory.name_key == offer.name_key,
            PriceHistory.seen_at >= since,
        )
        .order_by(PriceHistory.seen_at)
    ).all()
