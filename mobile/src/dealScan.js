/**
 * Generic deal detector for delivery-platform API payloads (Wolt / Glovo / Bolt).
 * Walks any JSON, finds restaurant-like and dish-like objects and keeps those
 * that carry a promo / discount / campaign field or a crossed-out old price.
 * The same logic runs inside the platform page (AccountConnect's injected
 * script, ES5 copy) and here in the app when we replay the calls ourselves.
 */
const DEAL = /promo|discount|campaign|offer|deal|saving|cashback|voucher|coupon|otstap|намален|отстъп/i;
const PRICE_OLD = /original|old|before|strike|regular|full|was|list_price|base/i;
const SKIP = /telemetry|track|analytics|_id$|id$|key$|url|image|icon|color|type|style|enabled|disabled|consent|legal|terms/i;

export function txt(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(txt).filter(Boolean).join(" · ");
  if (typeof v === "object") {
    for (const k of ["value", "text", "title", "label", "name", "description", "short", "message"]) if (typeof v[k] === "string" && v[k]) return v[k];
    return Object.keys(v).slice(0, 6).map((k) => txt(v[k])).filter(Boolean).join(" ");
  }
  return String(v);
}
const nonEmpty = (v) => !(v == null || v === false || v === 0 || v === "") && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
const dealKeys = (o) => Object.keys(o || {}).filter((k) => DEAL.test(k) && !SKIP.test(k) && nonEmpty(o[k]));
function num(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    if (typeof v.value === "number") return v.value;
    if (typeof v.amount === "number") return v.amount > 500 ? v.amount / 100 : v.amount;
  }
  if (typeof v === "string") {
    const m = /([0-9]+[.,][0-9]{1,2})/.exec(v);
    if (m) return parseFloat(m[1].replace(",", "."));
  }
  return null;
}
const cents = (platform, n) => (n != null && n > 500 && platform === "Wolt" ? n / 100 : n);
function priceOf(o, platform) {
  const p = o.price != null ? o.price : o.base_price != null ? o.base_price : o.unit_price != null ? o.unit_price : o.amount;
  return cents(platform, num(p));
}
function oldPriceOf(o, platform) {
  for (const k of Object.keys(o)) {
    if (PRICE_OLD.test(k) && /price|value|amount/i.test(k)) {
      const n = num(o[k]);
      if (n != null) return cents(platform, n);
    }
  }
  if (o.price && typeof o.price === "object") for (const k of Object.keys(o.price)) if (PRICE_OLD.test(k)) {
    const n = num(o.price[k]);
    if (n != null) return n;
  }
  return null;
}
export function img(o) {
  try {
    const v = o.image || o.image_url || o.imageUrl || o.img || o.picture || o.images || o.media;
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      if (typeof v.url === "string") return v.url;
      if (typeof v.cover_image === "string") return v.cover_image;
      for (const k of Object.keys(v)) {
        const s = v[k];
        if (typeof s === "string" && /^https?:/.test(s)) return s;
        if (s && s.aspect_ratio_map) {
          const o2 = s.aspect_ratio_map.original;
          return o2["1x"] || o2["2x"] || o2["3x"];
        }
        if (s && typeof s.url === "string") return s.url;
      }
    }
  } catch {}
  return null;
}
const NOISE = /^(ново|new|нов|популяр|popular|top|топ)!?$/i;
function label(o, keys) {
  const parts = [];
  for (const k of keys) {
    const v = o[k];
    const t = typeof v === "number" ? `-${v}%` : txt(v);
    if (t && t !== "true" && !NOISE.test(t.trim())) parts.push(t);
  }
  if (o.badges) {
    const b = txt(o.badges);
    if (/%|-\d|промо|безплат|free|отстъп|discount/i.test(b) && !NOISE.test(b.trim())) parts.push(b);
  }
  return parts.filter(Boolean).join(" · ").slice(0, 140);
}
const isProvider = (o) =>
  !!(o && typeof o === "object" && !Array.isArray(o) && (o.name || o.title) && (o.slug || o.provider_id || o.id || o.storeId || o.store_id) &&
    (o.delivery || o.rating || o.address || o.distance || o.tags || o.delivery_price_int !== undefined || o.estimate || o.delivery_price || o.deliveryFee !== undefined || o.cuisine || o.categories || o.location));
const isDish = (o) => !!(o && typeof o === "object" && !Array.isArray(o) && (o.name || o.title) && (o.price != null || o.base_price != null || o.unit_price != null) && !o.delivery && !o.address);
const provId = (o) => String(o.provider_id || o.storeId || o.store_id || o.id || o.slug);
const provOut = (o, keys) => ({
  id: provId(o),
  slug: o.slug || "",
  name: txt(o.name || o.title),
  label: label(o, keys),
  image_url: img(o),
  fee: num(o.delivery_price) != null ? num(o.delivery_price) : typeof o.delivery_price_int === "number" ? o.delivery_price_int / 100 : num(o.deliveryFee),
  minutes: o.estimate || (o.max_delivery_eta ? Math.round(o.max_delivery_eta / 60) : null),
});

/** scan(json, platform, providerId?, providerName?) -> { provs, dishes, nProv, all } */
export function scan(root, platform, pid = "", pname = "") {
  const provs = [];
  const dishes = [];
  const all = [];
  let nProv = 0;
  const walk = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 9) return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, depth + 1);
      return;
    }
    if (isProvider(o)) {
      nProv++;
      const keys = dealKeys(o);
      const badge = o.badges ? txt(o.badges) : "";
      all.push({ id: provId(o), slug: o.slug || "", name: txt(o.name || o.title) });
      if (keys.length || /%|промо|free|безплат/i.test(badge)) {
        const out = provOut(o, keys);
        if (out.label) provs.push(out); // a "Ново!" badge alone is not a deal
      }
    } else if (isDish(o)) {
      const ks = dealKeys(o);
      const oldp = oldPriceOf(o, platform);
      const pr = priceOf(o, platform);
      if ((ks.length || (oldp != null && pr != null && oldp > pr)) && pr != null)
        dishes.push({
          id: String(o.id || o.item_id || o.product_id || `${pid}:${txt(o.name)}`),
          provider_id: String(pid || o.venue_id || o.store_id || o.storeId || ""),
          restaurant: pname || "",
          name: txt(o.name || o.title),
          price: pr,
          original: oldp != null && oldp > pr ? oldp : null,
          promo: ks.length ? label(o, ks) : "",
          image_url: img(o),
        });
      return;
    }
    for (const k of Object.keys(o)) if (!/telemetry|track/i.test(k)) walk(o[k], depth + 1);
  };
  walk(root, 0);
  return { provs, dishes, nProv, all };
}

// ---- Glovo renders everything server-side (no JSON to watch): read the HTML the way the site shows it ----
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const PRICE = /(\d+)[,.](\d{2})\s*€/g;
/** Store cards on a Glovo listing page -> providers with a promotion tag. */
export function glovoStoresFromHtml(html) {
  const provs = [];
  const seen = new Set();
  const re = /<a [^>]*href="(\/bg\/bg\/varna\/stores\/([a-z0-9-]+))"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[2];
    if (seen.has(slug)) continue;
    const block = m[3];
    const promo = [...block.matchAll(/data-style="promotion"[^>]*>([^<]+)</g)].map((x) => strip(x[1])).filter((t) => t && !NOISE.test(t));
    if (!promo.length) continue;
    seen.add(slug);
    const name = strip((/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block) || [])[1]) || slug;
    const img = (/<img[^>]*src="([^"]+)"/.exec(block) || [])[1] || null;
    provs.push({ id: slug, slug, name, label: promo.join(" · ").slice(0, 140), image_url: img, fee: null, minutes: null });
  }
  return provs;
}
/** Item rows on a Glovo store page -> dishes with two prices (old > new) or a promotion tag. */
export function glovoDishesFromHtml(html, slug, name) {
  const dishes = [];
  const parts = html.split(/class="[^"]*ItemRow_itemRow[^"]*"/);
  for (let i = 1; i < parts.length; i++) {
    const row = parts[i].slice(0, 6000);
    const title = strip((/ItemRow_titleContainer[^>]*>([\s\S]*?)<\/div>/.exec(row) || [])[1]);
    const priceHtml = (/ItemRow_priceContainer[^>]*>([\s\S]*?)<\/div>/.exec(row) || [])[1] || "";
    const prices = [...priceHtml.matchAll(PRICE)].map((x) => parseInt(x[1], 10) + parseInt(x[2], 10) / 100);
    const promo = [...row.matchAll(/data-style="promotion"[^>]*>([^<]+)</g)].map((x) => strip(x[1])).filter((t) => t && !NOISE.test(t));
    if (!title || !prices.length) continue;
    const price = Math.min(...prices);
    const original = prices.length > 1 && Math.max(...prices) > price ? Math.max(...prices) : null;
    if (!original && !promo.length) continue;
    const img = (/<img[^>]*src="([^"]+)"/.exec(row) || [])[1] || null;
    dishes.push({ id: `${slug}:${title}`, provider_id: slug, slug, restaurant: name || slug, name: title, price, original, promo: promo.join(" · ").slice(0, 120), image_url: img });
  }
  return dishes;
}
