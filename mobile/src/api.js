/**
 * Thin wrapper around the FastAPI backend.
 * Every function returns parsed JSON or throws an Error with a readable message.
 *
 * Cold starts: the free Render instance can take 30-60 s to wake up. We allow
 * 70 s per request and expose `isColdStartError` so screens can show a
 * "сървърът се събужда" state instead of a scary error.
 */
import { API_URL } from "./config";

export const REQUEST_TIMEOUT_MS = 70000;

export class ApiError extends Error {
  constructor(message, { status, coldStart = false } = {}) {
    super(message);
    this.status = status;
    this.coldStart = coldStart;
  }
}

async function request(path, { method = "GET", body, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).detail || "";
      } catch {}
      throw new ApiError(detail || `Сървърът върна ${res.status}`, { status: res.status, coldStart: res.status >= 502 });
    }
    return await res.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.name === "AbortError") {
      if (signal?.aborted) throw err; // caller cancelled on purpose
      throw new ApiError("Сървърът се събужда (безплатен хостинг) - опитай пак след малко.", { coldStart: true });
    }
    throw new ApiError(`Няма връзка със сървъра. Провери интернет връзката.`, { coldStart: true });
  } finally {
    clearTimeout(timer);
  }
}

const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v != null && v !== "" && p.set(k, String(v)));
  const s = p.toString();
  return s ? `?${s}` : "";
};

// ---- offers --------------------------------------------------------------
export const getStatus = (opts) => request("/api/status", opts);
export const getTags = (opts) => request("/api/tags", opts);
export const searchOffers = (q, { store, tag, sort = "price", limit = 100, signal } = {}) =>
  request(`/api/search${qs({ q, store, tag, sort, limit })}`, { signal });
export const listOffers = ({ store, tag, sort = "price", limit = 60, signal } = {}) =>
  request(`/api/offers${qs({ store, tag, sort, limit })}`, { signal });
export const getOfferHistory = (id, opts) => request(`/api/offers/${id}/history`, opts);

// ---- barcode -------------------------------------------------------------
export const lookupBarcode = (code, opts) => request(`/api/barcode/${encodeURIComponent(code)}`, opts);

// ---- cart ----------------------------------------------------------------
export const optimizeCart = (items, opts) => request("/api/cart/optimize", { method: "POST", body: { items }, ...opts });

// ---- watchlist -----------------------------------------------------------
export const registerPush = (token, platform = "android") =>
  request("/api/push/register", { method: "POST", body: { token, platform } });
export const listWatches = (token, opts) => request(`/api/watch${qs({ token })}`, opts);
export const createWatch = (token, query, target_price, store) =>
  request("/api/watch", { method: "POST", body: { token, query, target_price, store } });
export const deleteWatch = (id, token) => request(`/api/watch/${id}${qs({ token })}`, { method: "DELETE" });

/**
 * Wait until the backend has data: polls /api/status while it is scraping
 * (right after a cold start the DB is empty for ~40 s). Resolves with the
 * status object; calls onTick(status) on every poll so the UI can show progress.
 */
export async function waitForData({ onTick, signal, maxMs = 120000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const st = await getStatus({ signal });
    onTick?.(st);
    if (st.total_offers > 0 && !st.scraping) return st;
    if (st.total_offers > 0) return st; // partial data is fine, keep going
    await new Promise((r) => setTimeout(r, 3000));
    if (signal?.aborted) throw new ApiError("cancelled");
  }
  return getStatus({ signal });
}
