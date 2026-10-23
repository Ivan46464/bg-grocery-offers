/**
 * Account connector for Wolt / Glovo / Bolt Food.
 *
 * The platforms show their best deals (Wolt+ / Glovo Prime / Bolt Plus menu
 * discounts, personal campaigns) only to signed-in users, and none of them
 * has a public source for those. So the user signs in to the platform's own
 * web app THEMSELVES inside a WebView - with their own phone / password -
 * we never see or store credentials.
 *
 * A script injected into that page watches every API response the page
 * receives (fetch + XHR) and keeps only what matters: restaurants carrying a
 * promo / discount field and dishes with a promo or crossed-out price. Once
 * it has seen the page's own Authorization header it also fetches the
 * restaurant list and the promo restaurants' menus by itself, so the user
 * does not have to browse page by page. Everything stays on the phone.
 *
 * The same component renders invisibly (`hidden`) to refresh a platform the
 * user connected earlier: the WebView keeps its cookies, so the page loads
 * signed in and the script collects again without any tapping.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius } from "../theme";
import { saveAccountDeals, saveAccountSession } from "../storage";

export const ACCOUNTS = {
  Wolt: {
    home: "https://wolt.com/bg/bgr/varna/restaurants",
    hosts: ["restaurant-api.wolt.com", "consumer-api.wolt.com", "wolt.com/api"],
    list: "pages/restaurants|venue-list|pages/front|discovery",
    menu: "assortment|menu",
    menuTpl: "https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/{slug}/assortment?language=bg",
    listTpl: "https://restaurant-api.wolt.com/v1/pages/restaurants?lat={lat}&lon={lng}",
    order: "https://wolt.com/bg/bgr/varna/venue/{slug}",
    bg: "#009DE0",
    fg: "#FFFFFF",
    hint: "Влез с имейл или телефон както в Wolt.",
  },
  Glovo: {
    home: "https://glovoapp.com/bg/bg/varna/",
    hosts: ["api.glovoapp.com", "glovoapp.com/api"],
    list: "feeds|stores|search|home|categor",
    menu: "stores/\\d+|store/|menu|content",
    menuTpl: null,
    listTpl: null,
    order: "https://glovoapp.com/bg/bg/varna/stores/{slug}",
    bg: "#FFC244",
    fg: "#1B1B1B",
    hint: "Влез както в Glovo. Разгледай началото - промоциите идват от него.",
  },
  Bolt: {
    home: "https://food.bolt.eu/bg-BG/2098-varna",
    hosts: ["deliveryuser.live.boltsvc.net"],
    list: "findProviders|getScreenContent|cityWideSearch|deliverySearch",
    menu: "getMenuCategories|getMenuDishes",
    menuTpl: "https://deliveryuser.live.boltsvc.net/deliveryClient/getMenuCategories?{qs}&provider_id={id}&delivery_lat={lat}&delivery_lng={lng}",
    listTpl: "POST https://deliveryuser.live.boltsvc.net/deliveryClient/findProviders?{qs}",
    order: "https://food.bolt.eu/bg-BG/2098-varna/p/{id}-{slug}",
    bg: "#34D186",
    fg: "#0B1220",
    hint: "Влез с телефона си както в Bolt.",
  },
};
export const ACCOUNT_ORDER = ["Wolt", "Glovo", "Bolt"];

// Runs inside the platform's page before its own code. ES5, defensive, platform config injected as JSON.
const inject = (platform, cfg, loc) => `
(function(){
  if (window.__bgInjected) return; window.__bgInjected = true;
  var P = ${JSON.stringify(platform)}, CFG = ${JSON.stringify(cfg)}, LOC = ${JSON.stringify(loc || { lat: 43.2141, lng: 27.9147 })};
  var LIST = new RegExp(CFG.list), MENU = new RegExp(CFG.menu);
  var auth = null, qs = null, fetched = {}, listDone = false, seenProv = {}, sessHeaders = null, listReq = null, menuTplSeen = null, sessPosted = 0;
  window.__bgEarly = true;
  function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){} }
  function isApi(url){ for (var i = 0; i < CFG.hosts.length; i++) if (url.indexOf(CFG.hosts[i]) >= 0) return true; return false; }
  function txt(v){
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map(txt).filter(Boolean).join(' · ');
    if (typeof v === 'object') { var ks = ['value','text','title','label','name','description','short','message']; for (var i = 0; i < ks.length; i++) if (typeof v[ks[i]] === 'string' && v[ks[i]]) return v[ks[i]]; return Object.keys(v).slice(0, 6).map(function(k){ return txt(v[k]); }).filter(Boolean).join(' '); }
    return String(v);
  }
  var DEAL = /promo|discount|campaign|offer|deal|saving|cashback|voucher|coupon|otstap|намален|отстъп/i;
  var PRICE_OLD = /original|old|before|strike|regular|full|was|list_price|base/i;
  var SKIP = /telemetry|track|analytics|_id$|id$|key$|url|image|icon|color|type|style|enabled|disabled|consent|legal|terms/i;
  function nonEmpty(v){ if (v == null || v === false || v === 0 || v === '') return false; if (Array.isArray(v)) return v.length > 0; if (typeof v === 'object') return Object.keys(v).length > 0; return true; }
  function dealKeys(o){ var out = []; Object.keys(o || {}).forEach(function(k){ if (DEAL.test(k) && !SKIP.test(k) && nonEmpty(o[k])) out.push(k); }); return out; }
  function num(v){ if (typeof v === 'number') return v; if (v && typeof v === 'object') { if (typeof v.value === 'number') return v.value; if (typeof v.amount === 'number') return v.amount > 500 ? v.amount / 100 : v.amount; } if (typeof v === 'string') { var m = /([0-9]+[.,][0-9]{1,2})/.exec(v); if (m) return parseFloat(m[1].replace(',', '.')); } return null; }
  function priceOf(o){ var p = o.price != null ? o.price : (o.base_price != null ? o.base_price : (o.unit_price != null ? o.unit_price : o.amount)); var n = num(p); if (n != null && n > 500 && P === 'Wolt') n = n / 100; return n; }
  function oldPriceOf(o){ var ks = Object.keys(o); for (var i = 0; i < ks.length; i++) if (PRICE_OLD.test(ks[i]) && /price|value|amount/i.test(ks[i])) { var n = num(o[ks[i]]); if (n != null) return (n > 500 && P === 'Wolt') ? n / 100 : n; }
    if (o.price && typeof o.price === 'object') { var pk = Object.keys(o.price); for (var j = 0; j < pk.length; j++) if (PRICE_OLD.test(pk[j])) { var m = num(o.price[pk[j]]); if (m != null) return m; } } return null; }
  function img(o){ try { var v = o.image || o.image_url || o.imageUrl || o.img || o.picture || o.images || o.media; if (typeof v === 'string') return v; if (v && typeof v === 'object') { if (typeof v.url === 'string') return v.url; if (typeof v.cover_image === 'string') return v.cover_image; var ks = Object.keys(v); for (var i = 0; i < ks.length; i++) { var s = v[ks[i]]; if (typeof s === 'string' && /^https?:/.test(s)) return s; if (s && s.aspect_ratio_map) { var o2 = s.aspect_ratio_map.original; return o2['1x'] || o2['2x'] || o2['3x']; } if (s && typeof s.url === 'string') return s.url; } } } catch(e){} return null; }
  function label(o, keys){ var parts = []; keys.forEach(function(k){ var v = o[k]; var t = (typeof v === 'number') ? ('-' + v + '%') : txt(v); if (t && t !== 'true') parts.push(t); }); if (o.badges) { var b = txt(o.badges); if (/%|-|промо|безплат|free/i.test(b)) parts.push(b); } return parts.filter(Boolean).join(' · ').slice(0, 140) || 'промоция'; }
  function isProvider(o){ return !!(o && typeof o === 'object' && !Array.isArray(o) && (o.name || o.title) && (o.slug || o.provider_id || o.id || o.storeId || o.store_id) && (o.delivery || o.rating || o.address || o.distance || o.tags || o.delivery_price_int !== undefined || o.estimate || o.delivery_price || o.deliveryFee !== undefined || o.cuisine || o.categories || o.location)); }
  function isDish(o){ return !!(o && typeof o === 'object' && !Array.isArray(o) && (o.name || o.title) && (o.price != null || o.base_price != null || o.unit_price != null) && !o.delivery && !o.address); }
  function provId(o){ return String(o.provider_id || o.storeId || o.store_id || o.id || o.slug); }
  function provOut(o, keys){ return { id: provId(o), slug: o.slug || '', name: txt(o.name || o.title), label: label(o, keys), image_url: img(o), fee: num(o.delivery_price) != null ? num(o.delivery_price) : (typeof o.delivery_price_int === 'number' ? o.delivery_price_int / 100 : num(o.deliveryFee)), minutes: o.estimate || (o.max_delivery_eta ? Math.round(o.max_delivery_eta / 60) : null) }; }
  function scan(root, pid, pname){
    var provs = [], dishes = [], nProv = 0;
    (function walk(o, depth){ if (!o || typeof o !== 'object' || depth > 9) return;
      if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i], depth + 1); return; }
      if (isProvider(o)) { nProv++; var keys = dealKeys(o); var badge = o.badges ? txt(o.badges) : ''; if (keys.length || /%|промо|free|безплат/i.test(badge)) provs.push(provOut(o, keys)); if (!seenProv[provId(o)]) seenProv[provId(o)] = { id: provId(o), slug: o.slug || '', name: txt(o.name || o.title), promo: !!(keys.length) }; }
      else if (isDish(o)) { var ks = dealKeys(o); var oldp = oldPriceOf(o); var pr = priceOf(o); if ((ks.length || (oldp != null && pr != null && oldp > pr)) && pr != null) dishes.push({ id: String(o.id || o.item_id || o.product_id || (pid + ':' + txt(o.name))), provider_id: String(pid || o.venue_id || o.store_id || o.storeId || ''), restaurant: pname || '', name: txt(o.name || o.title), price: pr, original: (oldp != null && oldp > pr) ? oldp : null, promo: ks.length ? label(o, ks) : '', image_url: img(o) }); return; }
      var kk = Object.keys(o); for (var j = 0; j < kk.length; j++) if (!/telemetry|track/i.test(kk[j])) walk(o[kk[j]], depth + 1); })(root, 0);
    return { provs: provs, dishes: dishes, nProv: nProv };
  }
  function fill(t, v){ return t.replace(/\\{(\\w+)\\}/g, function(_, k){ return v[k] != null ? v[k] : ''; }); }
  function fetchMenu(p){
    if (!auth || !CFG.menuTpl || fetched[p.id]) return; fetched[p.id] = 1;
    var url = fill(CFG.menuTpl, { id: p.id, slug: p.slug, qs: qs || '', lat: LOC.lat, lng: LOC.lng });
    window.__origFetch(url, { headers: { 'Authorization': auth, 'Accept': 'application/json' } }).then(function(r){ return r.text(); }).then(function(t){ var j = JSON.parse(t); var r = scan(j, p.id, p.name); post({ type: 'dishes', platform: P, provider_id: p.id, deals: r.dishes.slice(0, 80) }); }).catch(function(){});
  }
  function fetchList(){
    if (!auth || !CFG.listTpl || listDone) return; listDone = true;
    var spec = fill(CFG.listTpl, { qs: qs || '', lat: LOC.lat, lng: LOC.lng }); var method = 'GET', url = spec;
    if (spec.indexOf('POST ') === 0) { method = 'POST'; url = spec.slice(5); }
    var init = { method: method, headers: { 'Authorization': auth, 'Accept': 'application/json', 'Content-Type': 'application/json' } };
    if (method === 'POST') init.body = JSON.stringify({ lat: LOC.lat, lng: LOC.lng, filters: [] });
    window.__origFetch(url, init).then(function(r){ return r.text(); }).then(function(t){ handle(url, { Authorization: auth }, init.body, t, true); }).catch(function(){});
  }
  function handle(url, h, body, text, own){
    if (!url || !isApi(url)) return;
    var authed = !!(h && h.Authorization);
    if (authed && !own) { auth = h.Authorization; sessHeaders = h; var q = url.split('?')[1]; if (q) qs = q.replace(/&?(provider_id|delivery_lat|delivery_lng|lat|lon|lng|slug)=[^&]*/g, '').replace(/^&/, '');
      if (LIST.test(url) && !listReq) listReq = { url: url, method: (body ? 'POST' : 'GET'), body: (typeof body === 'string' ? body : null) };
      if (MENU.test(url) && !LIST.test(url) && !menuTplSeen) menuTplSeen = url.replace(/provider_id=\\d+/, 'provider_id={id}').replace(/venues\\/slug\\/[^\\/?]+/, 'venues/slug/{slug}').replace(/stores\\/\\d+/, 'stores/{id}');
      if (listReq && sessPosted < 3) { sessPosted++; post({ type: 'session', platform: P, headers: sessHeaders, listReq: listReq, menuTpl: menuTplSeen || CFG.menuTpl, qs: qs }); } }
    var j; try { j = JSON.parse(text); } catch(e){ return; }
    if (MENU.test(url) && !LIST.test(url)) { var m = /provider_id=(\\d+)|venues\\/slug\\/([^\\/?]+)|stores\\/(\\d+)/.exec(url); var pid = m ? (m[1] || m[2] || m[3]) : ''; var r0 = scan(j, pid, (seenProv[pid] || {}).name || ''); if (r0.dishes.length) post({ type: 'dishes', platform: P, provider_id: pid, deals: r0.dishes.slice(0, 80) }); return; }
    var r = scan(j, '', '');
    if (r.nProv || r.provs.length || r.dishes.length) {
      post({ type: 'providers', platform: P, authed: authed || !!auth, total: r.nProv, promos: r.provs.slice(0, 120), dishes: r.dishes.slice(0, 80), url: url.split('?')[0] });
      if (auth) r.provs.slice(0, 40).forEach(fetchMenu);
    }
    if (authed && !own) fetchList();
  }
  function headersOf(init, input){ var h = {}; var src = (init && init.headers) || (input && input.headers); try { if (src) { if (typeof src.forEach === 'function' && !Array.isArray(src)) src.forEach(function(v, k){ h[k] = v; }); else if (Array.isArray(src)) src.forEach(function(kv){ h[kv[0]] = kv[1]; }); else Object.keys(src).forEach(function(k){ h[k] = src[k]; }); } } catch(e){} var n = {}; Object.keys(h).forEach(function(k){ n[k.toLowerCase() === 'authorization' ? 'Authorization' : k] = h[k]; }); return n; }
  var of = window.fetch; window.__origFetch = of.bind(window);
  window.fetch = function(input, init){ var p = of.apply(this, arguments); try { var url = typeof input === 'string' ? input : (input && input.url); if (url && isApi(url)) { var h = headersOf(init, input); var body = init && init.body; p.then(function(res){ try { res.clone().text().then(function(t){ handle(url, h, body, t, false); }); } catch(e){} }); } } catch(e){} return p; };
  var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send, oSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(m, u){ this.__u = u; this.__h = {}; return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function(k, v){ if (this.__h) this.__h[k.toLowerCase() === 'authorization' ? 'Authorization' : k] = v; return oSet.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(b){ var x = this; x.addEventListener('load', function(){ try { handle(x.__u, x.__h, b, x.responseText, false); } catch(e){} }); return oSend.apply(this, arguments); };
  post({ type: 'ready', platform: P });
})(); true;
`;

// After load: if the early hook did not run (Android sometimes skips it on the first load) reload once so it does.
const AFTER_LOAD = `(function(){ try { if (!window.__bgEarly && !sessionStorage.getItem('bgReloaded')) { sessionStorage.setItem('bgReloaded', '1'); setTimeout(function(){ location.reload(); }, 800); } } catch(e){} })(); true;`;

const UA = "Mozilla/5.0 (Linux; Android 14; SM-A266B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
/** The sites try to hand you over to their native app (wolt://, glovoapp://, intent://, Play Store). Stay in the page. */
const stayInPage = (req) => {
  const u = String(req?.url || "");
  if (/^https?:\/\//i.test(u) && !/play\.google\.com|apps\.apple\.com|market:\/\//i.test(u)) return true;
  return false;
};
const WEBVIEW_COMMON = { javaScriptEnabled: true, domStorageEnabled: true, sharedCookiesEnabled: true, thirdPartyCookiesEnabled: true, setSupportMultipleWindows: false, userAgent: UA, originWhitelist: ["*"], onShouldStartLoadWithRequest: stayInPage, mixedContentMode: "compatibility", allowsBackForwardNavigationGestures: true };

/** Merge one capture message into the stored per-platform record. */
function mergeMessage(rec, m) {
  const next = { ...(rec || { providers: {}, dishes: {}, authed: false, total: 0 }) };
  next.providers = { ...next.providers };
  next.dishes = { ...next.dishes };
  if (m.type === "providers") {
    for (const p of m.promos || []) next.providers[p.id] = p;
    for (const d of m.dishes || []) next.dishes[d.id] = d;
    next.authed = next.authed || !!m.authed;
    next.total = Math.max(next.total || 0, m.total || 0);
  } else if (m.type === "dishes") {
    for (const d of m.deals || []) next.dishes[d.id] = d;
  }
  next.capturedAt = new Date().toISOString();
  return next;
}

export function useAccountWebView(platform, location, onUpdate, onSession) {
  const recRef = useRef(null);
  const [rec, setRec] = useState(null);
  useEffect(() => {
    recRef.current = null;
    setRec(null);
  }, [platform]);
  const onMessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === "session" && m.headers && m.listReq) {
      saveAccountSession(platform, { headers: m.headers, listReq: m.listReq, menuTpl: m.menuTpl || null, qs: m.qs || null, connectedAt: new Date().toISOString(), expired: false });
      onSession?.(platform);
      return;
    }
    if (m.type !== "providers" && m.type !== "dishes") return;
    const next = mergeMessage(recRef.current, m);
    recRef.current = next;
    setRec(next);
    const stored = { platform, capturedAt: next.capturedAt, authed: next.authed, total: next.total, providers: Object.values(next.providers), dishes: Object.values(next.dishes) };
    saveAccountDeals(platform, stored);
    onUpdate?.(platform, stored);
  };
  const cfg = ACCOUNTS[platform];
  const script = inject(platform, cfg, location);
  return { rec, onMessage, script, cfg };
}

function getWebView() {
  if (Platform.OS === "web") return null;
  // eslint-disable-next-line global-require
  return require("react-native-webview").WebView;
}

/** Invisible refresh: loads the platform signed-in (cookies kept) and lets the script collect. */
export function HiddenRefresh({ platform, location, onUpdate, onSession, onDone, timeoutMs = 75000 }) {
  const { onMessage, script, cfg } = useAccountWebView(platform, location, onUpdate, onSession);
  const WebView = getWebView();
  useEffect(() => {
    const t = setTimeout(() => onDone?.(platform), timeoutMs);
    return () => clearTimeout(t);
  }, [platform, timeoutMs, onDone]);
  if (!WebView) return null;
  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: "absolute", left: -10, top: -10 }} pointerEvents="none">
      <WebView source={{ uri: cfg.home }} injectedJavaScriptBeforeContentLoaded={script} injectedJavaScript={AFTER_LOAD} onMessage={onMessage} {...WEBVIEW_COMMON} style={{ width: 1, height: 1 }} />
    </View>
  );
}

export default function AccountConnect({ platform, visible, location, onClose, onUpdate, onSession }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState(null);
  const [nav, setNav] = useState("");
  const [key, setKey] = useState(0); // bump to reload the page
  const webRef = useRef(null);
  useEffect(() => {
    setConnected(false);
    setErr(null);
    setLoading(true);
  }, [platform, visible]);
  const { rec, onMessage, script, cfg } = useAccountWebView(platform, location, onUpdate, (p) => {
    setConnected(true);
    onSession?.(p);
  });
  if (!visible || !platform) return null;
  const WebView = getWebView();
  const nProv = rec ? Object.keys(rec.providers).length : 0;
  const nDish = rec ? Object.keys(rec.dishes).length : 0;
  const found = nProv + nDish;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.wrap, { paddingTop: insets.top }]}>
        <View style={[styles.bar, { backgroundColor: cfg.bg }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: cfg.fg }]}>{platform} · твоят профил</Text>
            <Text style={[styles.sub, { color: cfg.fg }]} numberOfLines={2}>
              {connected || rec?.authed
                ? `Свързано ✓ Оттук нататък приложението само тегли отстъпките ти. Засега: ${nProv} ресторанта с промо · ${nDish} ястия${rec?.total ? ` (прегледани ${rec.total})` : ""}. Можеш да натиснеш Готово.`
                : `${cfg.hint} Паролата остава в ${platform} - ние виждаме само отстъпките.`}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.done}>
            <Ionicons name={found || connected ? "checkmark" : "close"} size={18} color="#fff" />
            <Text style={styles.doneText}>{found || connected ? "Готово" : "Затвори"}</Text>
          </Pressable>
        </View>
        {WebView ? (
          <WebView
            key={`${platform}-${key}`}
            ref={webRef}
            source={{ uri: cfg.home }}
            injectedJavaScriptBeforeContentLoaded={script}
            injectedJavaScript={AFTER_LOAD}
            onMessage={onMessage}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onNavigationStateChange={(st) => setNav(String(st?.url || "").replace(/^https?:\/\//, "").slice(0, 60))}
            onError={(e) => setErr(`${e?.nativeEvent?.description || "грешка при зареждане"} (${e?.nativeEvent?.code ?? ""})`)}
            onHttpError={(e) => (e?.nativeEvent?.statusCode >= 400 && /^https?:\/\/[^/]*(wolt|glovo|bolt)/.test(String(e?.nativeEvent?.url || "")) ? setErr(`HTTP ${e.nativeEvent.statusCode} от ${String(e.nativeEvent.url).replace(/^https?:\/\//, "").slice(0, 50)}`) : null)}
            onRenderProcessGone={() => setErr("браузърът спря - натисни Презареди")}
            {...WEBVIEW_COMMON}
            style={{ flex: 1 }}
          />
        ) : (
          <View style={styles.center}>
            <Text style={styles.subDark}>Входът в {platform} работи само в приложението на телефона.</Text>
          </View>
        )}
        <View style={styles.status}>
          {loading ? <ActivityIndicator size="small" color={cfg.bg} /> : <Ionicons name={err ? "alert-circle" : "globe-outline"} size={14} color={err ? colors.danger : colors.ink3} />}
          <Text style={[styles.statusText, err && { color: colors.danger }]} numberOfLines={2}>
            {err ? `Не се зареди: ${err}` : loading ? `Зареждаме ${nav || cfg.home.replace(/^https?:\/\//, "")}…` : nav || ""}
          </Text>
          <Pressable onPress={() => { setErr(null); setKey((k) => k + 1); }} hitSlop={8} style={styles.reload}>
            <Ionicons name="refresh" size={14} color={colors.ink2} />
            <Text style={styles.reloadText}>Презареди</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(cfg.home).catch(() => {})} hitSlop={8} style={styles.reload}>
            <Ionicons name="open-outline" size={14} color={colors.ink2} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  title: { fontSize: 15, fontWeight: "800" },
  sub: { fontSize: 11, marginTop: 2, lineHeight: 15, opacity: 0.9 },
  subDark: { fontSize: 13, color: colors.ink2, textAlign: "center" },
  done: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  doneText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  status: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.border },
  statusText: { flex: 1, fontSize: 11, color: colors.ink3 },
  reload: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  reloadText: { fontSize: 11, fontWeight: "700", color: colors.ink2 },
});
