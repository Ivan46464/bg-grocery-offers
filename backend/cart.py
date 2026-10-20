"""
"Smart cart" optimiser.

Given a list of free-text items ("яйца", "мляко", "кафе") we:
  1. fuzzy-match each item against the current offers of every store and keep
     the cheapest match per (item, store);
  2. Best single store  = the store covering the most items, cheapest total as tiebreak;
  3. Best split trip    = per item, the cheapest store overall (then grouped by store);
  4. savings            = single-store total - split total, compared over the
                          items the single store actually has, so it's fair.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from models import CartItemMatch, CartResponse, CartSplitStop, CartStorePlan, Offer, OfferRead
from search import MATCH_THRESHOLD, query_variants, score_offer

CART_THRESHOLD = max(MATCH_THRESHOLD, 80)   # be a bit stricter than search: a wrong match costs money


def _best_per_store(item: str, offers: list[Offer]) -> dict[str, tuple[Offer, int]]:
    variants = query_variants(item)
    best: dict[str, tuple[Offer, int]] = {}
    for o in offers:
        s = score_offer(o.product_name, variants)
        if s < CART_THRESHOLD:
            continue
        cur = best.get(o.store)
        # cheaper wins; on a tie the better match wins
        if cur is None or (o.discounted_price, -s) < (cur[0].discounted_price, -cur[1]):
            best[o.store] = (o, s)
    return best


def optimize(items: list[str], offers: list[Offer], stores: list[str]) -> CartResponse:
    items = [i.strip() for i in items if i and i.strip()]
    matches = {item: _best_per_store(item, offers) for item in items}

    # --- per-store plans ---------------------------------------------------
    plans: list[CartStorePlan] = []
    for store in stores:
        rows: list[CartItemMatch] = []
        total, missing = 0.0, []
        for item in items:
            hit = matches[item].get(store)
            if hit:
                rows.append(CartItemMatch(item=item, offer=OfferRead.from_offer(hit[0], hit[1])))
                total += hit[0].discounted_price
            else:
                rows.append(CartItemMatch(item=item))
                missing.append(item)
        plans.append(CartStorePlan(store=store, total=round(total, 2), found=len(items) - len(missing), missing=missing, items=rows))
    plans.sort(key=lambda p: (-p.found, p.total))
    best_single = plans[0] if plans and plans[0].found > 0 else None

    # --- split trip --------------------------------------------------------
    by_store: dict[str, list[CartItemMatch]] = defaultdict(list)
    split_total, split_missing = 0.0, []
    for item in items:
        options = matches[item]
        if not options:
            split_missing.append(item)
            continue
        store, (offer, score) = min(options.items(), key=lambda kv: (kv[1][0].discounted_price, -kv[1][1]))
        by_store[store].append(CartItemMatch(item=item, offer=OfferRead.from_offer(offer, score)))
        split_total += offer.discounted_price
    split = [
        CartSplitStop(store=s, items=rows, subtotal=round(sum(r.offer.discounted_price for r in rows), 2))
        for s, rows in by_store.items()
    ]
    split.sort(key=lambda s: -s.subtotal)

    # --- fair savings: only over items the best single store also has -------
    savings = 0.0
    if best_single:
        covered = {r.item for r in best_single.items if r.offer}
        split_cost_covered = sum(
            r.offer.discounted_price for stop in split for r in stop.items if r.item in covered
        )
        savings = round(best_single.total - split_cost_covered, 2)

    return CartResponse(
        items=items,
        best_single_store=best_single,
        stores=plans,
        best_split=split,
        split_total=round(split_total, 2),
        split_missing=split_missing,
        savings_vs_single=max(savings, 0.0),
    )
