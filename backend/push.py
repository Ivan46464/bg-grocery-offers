"""
Watchlist evaluation + Expo push notifications.

Flow
  app  -> POST /api/push/register {token}         (token = ExponentPushToken[...] or "device:<uuid>")
  app  -> POST /api/watch {token, query, target_price}
  scraper finishes -> check_watches(): for each watch find the cheapest matching
  offer; if it meets the target and we haven't alerted for that offer+price yet,
  send a push through Expo's API. Tokens starting with "device:" can't receive
  pushes - the app polls GET /api/watch for those and shows the hit in-app.

Android push delivery needs FCM credentials on the EAS project
(https://docs.expo.dev/push-notifications/fcm-credentials/). Until that is set
up, Expo returns DeviceNotRegistered / InvalidCredentials and we just log it.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from sqlmodel import Session, select

from models import Offer, Watch, utcnow
from search import price_of, search_offers

log = logging.getLogger("push")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def best_match(watch: Watch, offers: list[Offer]) -> Optional[Offer]:
    pool = [o for o in offers if not watch.store or o.store.lower() == watch.store.lower()]
    hits = search_offers(pool, watch.query, sort="price")
    return hits[0][0] if hits else None


def meets_target(watch: Watch, offer: Optional[Offer]) -> bool:
    if offer is None:
        return False
    return watch.target_price is None or price_of(offer) <= watch.target_price


def send_push(messages: list[dict]) -> None:
    """Fire-and-forget batch send to Expo (max 100 per request)."""
    for i in range(0, len(messages), 100):
        batch = messages[i:i + 100]
        try:
            r = httpx.post(EXPO_PUSH_URL, json=batch, timeout=20, headers={"Accept": "application/json"})
            r.raise_for_status()
            for ticket, msg in zip(r.json().get("data", []), batch):
                if ticket.get("status") != "ok":
                    log.warning("push to %s failed: %s", msg["to"][:30], ticket.get("details") or ticket.get("message"))
        except Exception as exc:  # noqa: BLE001
            log.warning("push batch failed: %s", exc)


def check_watches(session: Session) -> int:
    """Evaluate every watch against current offers; send pushes for new hits. Returns #alerts."""
    offers = session.exec(select(Offer)).all()
    watches = session.exec(select(Watch)).all()
    messages: list[dict] = []
    alerts = 0
    for w in watches:
        offer = best_match(w, offers)
        if not meets_target(w, offer):
            continue
        already = w.last_hit_offer_id == offer.id and w.last_hit_price == price_of(offer)
        if already:
            continue
        w.last_hit_offer_id = offer.id
        w.last_hit_price = price_of(offer)
        w.last_hit_name = offer.product_name
        w.last_hit_store = offer.store
        w.last_notified_at = utcnow()
        session.add(w)
        alerts += 1
        if w.token.startswith("ExponentPushToken"):
            messages.append(
                {
                    "to": w.token,
                    "title": f"{offer.store}: {offer.product_name[:60]}",
                    "body": f"{price_of(offer):.2f} € " + (f"с {offer.card_name} " if offer.card_price else "") + (f"(преди {offer.original_price:.2f} €)" if offer.original_price else "") + f" · търсене „{w.query}“",
                    "data": {"offer_id": offer.id, "watch_id": w.id},
                    "sound": "default",
                }
            )
    session.commit()
    if messages:
        send_push(messages)
    return alerts
