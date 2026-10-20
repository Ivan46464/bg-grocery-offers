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

/** Cart items are { id, name, barcode?, image_url?, exact }. Old installs stored plain strings - migrate. */
export const loadCart = async () => {
  const items = await read(KEYS.cart, []);
  return items.map((it) => (typeof it === "string" ? { id: it, name: it, exact: false } : it));
};
export const saveCart = (items) => write(KEYS.cart, items);
export const cartItemId = (p) => p.barcode || p.name.toLowerCase().trim();

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
