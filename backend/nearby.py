"""
Live "does it deliver to me?" lookups for one delivery point.

The restaurant database is scraped once a day from the city centre; delivery
fees, times and availability depend on where the order goes, so the app sends
the user's chosen point (district / address) here and we ask the platforms'
public endpoints for that exact spot:

  Wolt  GET restaurant-api.wolt.com/v1/pages/restaurants?lat&lon  -> venues delivering there (fee, estimate, online)
  Bolt  POST .../deliveryClient/public/findProviders {lat,lng}    -> providers (fee, eta, "too far" overlay)
  Glovo has no public per-address endpoint, so it is left as scraped.

Results are cached 15 minutes per ~100 m cell. No account is used anywhere.
"""
from __future__ import annotations

import logging
import time
import uuid

import httpx

from restaurants import HEADERS, _text

log = logging.getLogger("nearby")

_CACHE: dict[tuple[float, float], tuple[float, dict]] = {}
TTL = 15 * 60


def _wolt(lat: float, lng: float) -> dict:
    out: dict[str, dict] = {}
    with httpx.Client(headers=HEADERS, timeout=30) as c:
        data = c.get("https://restaurant-api.wolt.com/v1/pages/restaurants", params={"lat": lat, "lon": lng}).json()
    for section in data.get("sections", []):
        for item in section.get("items", []):
            v = item.get("venue")
            if not v or not v.get("slug"):
                continue
            fee = v.get("delivery_price_int")
            out[v["slug"]] = {
                "delivers": bool(v.get("delivers", True)),
                "online": bool(v.get("online", True)),
                "fee": (fee / 100) if isinstance(fee, (int, float)) else None,
                "minutes": v.get("estimate"),
            }
    return out


def _bolt(lat: float, lng: float) -> dict:
    out: dict[str, dict] = {}
    headers = {**HEADERS, "Origin": "https://food.bolt.eu", "Referer": "https://food.bolt.eu/", "Content-Type": "application/json"}
    qs = {"version": "FD.1.00", "deviceId": str(uuid.uuid4()), "device_name": "web", "device_os_version": "web", "deviceType": "web", "language": "bg", "country": "bg"}
    with httpx.Client(headers=headers, timeout=30) as c:
        body = c.post("https://deliveryuser.live.boltsvc.net/deliveryClient/public/findProviders", params=qs, json={"lat": lat, "lng": lng, "filters": []}).json()
    for p in (body.get("data") or {}).get("providers") or []:
        pid = p.get("provider_id")
        if not pid:
            continue
        overlay = _text(p.get("provider_overlay_text"))
        fee = (p.get("delivery_price") or {}).get("value")
        eta = p.get("max_delivery_eta") or p.get("min_delivery_eta")
        out[str(pid)] = {
            "delivers": overlay != "Прекалено далеч",                      # distance only; closed-now is "online"
            "online": bool(p.get("is_available_for_delivery")),
            "note": overlay or None,
            "fee": float(fee) if isinstance(fee, (int, float)) else None,
            "minutes": int(eta / 60) if isinstance(eta, (int, float)) and eta else None,
        }
    return out


def lookup(lat: float, lng: float) -> dict:
    key = (round(lat, 3), round(lng, 3))
    hit = _CACHE.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    result = {"lat": key[0], "lng": key[1], "Wolt": {}, "Bolt": {}, "errors": []}
    for name, fn in (("Wolt", _wolt), ("Bolt", _bolt)):
        try:
            result[name] = fn(lat, lng)
        except Exception as exc:  # noqa: BLE001
            log.warning("nearby %s failed: %s", name, exc)
            result["errors"].append(name)
    _CACHE[key] = (time.time(), result)
    if len(_CACHE) > 200:
        oldest = min(_CACHE, key=lambda k: _CACHE[k][0])
        _CACHE.pop(oldest, None)
    return result
