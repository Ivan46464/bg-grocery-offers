"""
"Smart cart" optimiser.

Items are either free words ("яйца") or SPECIFIC products picked from the
catalog ({name, barcode, exact: true}). For specific products we match by
EAN when possible, else strictly on the product's core words, so "Маджаров
кашкавал" never turns into a croissant with cheese.

  1. per (item, store): the cheapest matching offer - using the loyalty-card
     price when the store has one, since that's what the shopper actually pays;
  2. Best single store  = the store covering the most items, cheapest total as tiebreak;
  3. Best split trip    = per item, the cheapest store overall (then grouped by store);
  4. savings            = single-store total - split total, compared over the
                          items the single store actually has, so it's fair.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Union

from catalog import match_offers
from models import CartItem, CartItemMatch, CartResponse, CartSplitStop, CartStorePlan, Offer, OfferRead
from search import MATCH_THRESHOLD, price_of, query_variants, score_offer

CART_THRESHOLD = max(MATCH_THRESHOLD, 80)   # free words: a bit stricter than search, a wrong match costs money


def normalise_items(items: list[Union[str, CartItem]]) -> list[CartItem]:
    out: list[CartItem] = []
    for it in items:
        if isinstance(it, str):
            if it.strip():
                out.append(CartItem(name=it.strip()))
        elif it.name and it.name.strip():
            out.append(CartItem(name=it.name.strip(), barcode=it.barcode, image_url=it.image_url, exact=it.exact))
    return out


def _best_per_store(item: CartItem, offers: list[Offer]) -> dict[str, tuple[Offer, int]]:
    best: dict[str, tuple[Offer, int]] = {}
    if item.exact or item.barcode:
        candidates = match_offers(offers, item.name, item.barcode)
    else:
        variants = query_variants(item.name)
        candidates = [(o, s) for o in offers if (s := score_offer(o.product_name, variants)) >= CART_THRESHOLD]
    for o, s in candidates:
        cur = best.get(o.store)
        # cheaper (with the store card) wins; on a tie the better match wins
        if cur is None or (price_of(o), -s) < (price_of(cur[0]), -cur[1]):
            best[o.store] = (o, s)
    return best


def optimize(raw_items: list[Union[str, CartItem]], offers: list[Offer], stores: list[str]) -> CartResponse:
    items = normalise_items(raw_items)
    matches = {i: _best_per_store(it, offers) for i, it in enumerate(items)}

    def row(i: int, hit) -> CartItemMatch:
        return CartItemMatch(item=items[i].name, image_url=items[i].image_url, offer=OfferRead.from_offer(hit[0], hit[1]) if hit else None)

    # --- per-store plans ---------------------------------------------------
    plans: list[CartStorePlan] = []
    for store in stores:
        rows, total, missing = [], 0.0, []
        for i, it in enumerate(items):
            hit = matches[i].get(store)
            rows.append(row(i, hit))
            if hit:
                total += price_of(hit[0])
            else:
                missing.append(it.name)
        plans.append(CartStorePlan(store=store, total=round(total, 2), found=len(items) - len(missing), missing=missing, items=rows))
    plans.sort(key=lambda p: (-p.found, p.total))
    best_single = plans[0] if plans and plans[0].found > 0 else None

    # --- split trip --------------------------------------------------------
    by_store: dict[str, list[CartItemMatch]] = defaultdict(list)
    split_total, split_missing = 0.0, []
    for i, it in enumerate(items):
        options = matches[i]
        if not options:
            split_missing.append(it.name)
            continue
        store, hit = min(options.items(), key=lambda kv: (price_of(kv[1][0]), -kv[1][1]))
        by_store[store].append(row(i, hit))
        split_total += price_of(hit[0])
    split = [CartSplitStop(store=s, items=rows, subtotal=round(sum(r.offer.effective_price for r in rows), 2)) for s, rows in by_store.items()]
    split.sort(key=lambda s: -s.subtotal)

    # --- fair savings: only over items the best single store also has -------
    savings = 0.0
    if best_single:
        covered = {r.item for r in best_single.items if r.offer}
        split_cost_covered = sum(r.offer.effective_price for stop in split for r in stop.items if r.item in covered)
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
