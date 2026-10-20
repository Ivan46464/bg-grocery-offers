/**
 * Small persistence layer on AsyncStorage: cart items, device token, recent searches.
 * Every call is wrapped so a storage failure never crashes the UI.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  cart: "cart.items.v1",
  recent: "search.recent.v1",
  device: "device.token.v1",
  pushToken: "push.token.v1",
  trips: "trips.v1",
};

async function read(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function write(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/**
 * Shopping-list items: { id, name, barcode?, image_url?, exact, qty, price, done }.
 * Older installs stored plain strings or objects without qty/price - migrate.
 */
export const loadCart = async () => {
  const items = await read(KEYS.cart, []);
  return items.map((it) => {
    const o = typeof it === "string" ? { id: it, name: it, exact: false } : it;
    return { qty: 1, price: null, done: false, ...o };
  });
};
const cartListeners = new Set();
/** Subscribe to cart changes (tab badge, "added" state on cards). Returns unsubscribe. */
export const onCartChange = (fn) => {
  cartListeners.add(fn);
  return () => cartListeners.delete(fn);
};
export const saveCart = async (items) => {
  await write(KEYS.cart, items);
  cartListeners.forEach((fn) => fn(items));
};
export const cartItemId = (p) => p.barcode || p.name.toLowerCase().trim();

/** Add an offer (or picked product) to the list if not there yet. Returns true when added. */
export async function addOfferToCart(offer) {
  const p = { name: offer.product_name || offer.name, barcode: offer.barcode || null, image_url: offer.image_url || null, exact: true };
  const id = cartItemId(p);
  const items = await loadCart();
  if (items.some((x) => x.id === id)) return false;
  await saveCart([...items, { ...p, id, qty: 1, price: null, done: false }]);
  return true;
}

export const loadFlag = (key) => read("flag." + key, false);
export const saveFlag = (key, v) => write("flag." + key, v);

/** Shopping trips (expense log): { id, date, store, note, items: [{name, qty, price}], total }. Newest first. */
export const loadTrips = () => read(KEYS.trips, []);
export const saveTrips = (trips) => write(KEYS.trips, trips);
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const loadRecent = () => read(KEYS.recent, []);
export const pushRecent = async (q) => {
  const cur = await loadRecent();
  const next = [q, ...cur.filter((x) => x !== q)].slice(0, 8);
  await write(KEYS.recent, next);
  return next;
};

/** Stable per-install id used as the watchlist owner when push isn't available. */
export async function getDeviceToken() {
  let id = await read(KEYS.device, null);
  if (!id) {
    id = "device:" + Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
    await write(KEYS.device, id);
  }
  return id;
}

export const loadPushToken = () => read(KEYS.pushToken, null);
export const savePushToken = (t) => write(KEYS.pushToken, t);
