/**
 * Connected delivery accounts: once the user has signed in to a platform
 * inside the app (AccountConnect), we keep the *session* the page used -
 * the headers of its authenticated API call (Authorization etc.), the
 * restaurant-list request and the menu request pattern - and from then on
 * the app replays those calls itself, on a schedule, without opening the
 * page again. Everything stays on the phone.
 *
 * A replay that answers 401/403 (or a platform error code) means the
 * session expired: the account is marked "reconnect" and the user signs in
 * again once.
 */
import { scan } from "./dealScan";
import { loadAccountSessions, saveAccountDeals, saveAccountSession } from "./storage";

export const REFRESH_AFTER_MS = 30 * 60 * 1000;
const MENU_LIMIT = 40;

const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : ""));

async function call(req, headers, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(req.url, { method: req.method || "GET", headers: { ...headers, Accept: "application/json" }, body: req.body || undefined, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    const platformErr = json && typeof json.code === "number" && json.code !== 0 && /auth|token|unauthor|login|session/i.test(String(json.message || ""));
    return { status: res.status, json, expired: res.status === 401 || res.status === 403 || !!platformErr };
  } finally {
    clearTimeout(timer);
  }
}

/** Replay the stored session for one platform. Returns the stored deals record (also persisted). */
export async function refreshAccount(platform, session, location) {
  if (!session?.headers || !session?.listReq) throw new Error("no session");
  const loc = location || { lat: 43.2141, lng: 27.9147 };
  const listReq = { ...session.listReq };
  if (listReq.method === "POST" && listReq.body) {
    try {
      const b = JSON.parse(listReq.body);
      if (b.lat != null) listReq.body = JSON.stringify({ ...b, lat: loc.lat, lng: loc.lng });
    } catch {}
  } else if (/lat=/.test(listReq.url)) {
    listReq.url = listReq.url.replace(/([?&])lat=[^&]*/, `$1lat=${loc.lat}`).replace(/([?&])(lon|lng)=[^&]*/, `$1$2=${loc.lng}`);
  }
  const r = await call(listReq, session.headers);
  if (r.expired) {
    await saveAccountSession(platform, { ...session, expired: true, checkedAt: new Date().toISOString() });
    const err = new Error("expired");
    err.expired = true;
    throw err;
  }
  const found = scan(r.json || {}, platform);
  const providers = {};
  for (const p of found.provs) providers[p.id] = p;
  const dishes = {};
  for (const d of found.dishes) dishes[d.id] = d;
  // menus of the promo restaurants (and, when none are flagged, a sample of the first ones: dish-level promos only show in menus)
  const targets = (found.provs.length ? found.provs : found.all.slice(0, 15)).slice(0, MENU_LIMIT);
  if (session.menuTpl) {
    for (const p of targets) {
      try {
        const url = fill(session.menuTpl, { id: p.id, slug: p.slug, qs: session.qs || "", lat: loc.lat, lng: loc.lng });
        const m = await call({ url, method: "GET" }, session.headers, 20000);
        if (m.expired) continue;
        const s = scan(m.json || {}, platform, p.id, p.name);
        for (const d of s.dishes) dishes[d.id] = d;
      } catch {}
    }
  }
  const rec = { platform, capturedAt: new Date().toISOString(), authed: true, total: found.nProv, providers: Object.values(providers), dishes: Object.values(dishes) };
  await saveAccountDeals(platform, rec);
  await saveAccountSession(platform, { ...session, expired: false, checkedAt: rec.capturedAt });
  return rec;
}

/** Which connected platforms are due for a refresh. */
export async function dueAccounts(accounts, force = false) {
  const sessions = await loadAccountSessions();
  return Object.keys(sessions).filter((p) => {
    const s = sessions[p];
    if (!s?.headers || !s?.listReq || s.expired) return false;
    const last = accounts?.[p]?.capturedAt ? new Date(accounts[p].capturedAt).getTime() : 0;
    return force || Date.now() - last > REFRESH_AFTER_MS;
  });
}
