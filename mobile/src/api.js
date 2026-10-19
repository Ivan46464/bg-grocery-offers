/**
 * Thin wrapper around the FastAPI backend.
 * Every function returns parsed JSON or throws an Error with a readable message.
 */
import { API_URL } from "./config";

const REQUEST_TIMEOUT_MS = 20000; // Render's free tier can take ~30-50 s to wake up; we retry once.

async function request(path, { signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Abort our request if the caller aborts (e.g. user typed a new query).
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const res = await fetch(`${API_URL}${path}`, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Server returned ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      if (signal?.aborted) throw err; // caller cancelled - not an error worth showing
      throw new Error("The server is taking too long. If it was asleep, try again in a few seconds.");
    }
    if (err.message === "Network request failed") {
      throw new Error(`Could not reach ${API_URL}. Check the URL in src/config.js and your connection.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Fuzzy search. sort = "price" | "score" | "discount". */
export function searchOffers(query, { store, sort = "price", limit = 100, signal } = {}) {
  const params = new URLSearchParams({ q: query, sort, limit: String(limit) });
  if (store) params.set("store", store);
  return request(`/api/search?${params.toString()}`, { signal });
}

/** Browse cheapest offers (used for the empty-search state). */
export function listOffers({ store, limit = 30, signal } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (store) params.set("store", store);
  return request(`/api/offers?${params.toString()}`, { signal });
}

/** Per-store counts + whether data is real or demo. */
export function getStores({ signal } = {}) {
  return request("/api/stores", { signal });
}
