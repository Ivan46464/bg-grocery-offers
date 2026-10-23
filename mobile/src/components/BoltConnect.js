/**
 * "Влез в Bolt" - Bolt Food shows discounts (Bolt Plus menu discounts, personal
 * campaigns) only to signed-in users, and there is no public source for them.
 * So the user signs in to food.bolt.eu THEMSELVES, inside this WebView, with
 * their own phone number and code. We never see or store the password/code.
 *
 * While they are signed in, the page talks to Bolt's API like the real app.
 * A small script injected into the page watches those responses (fetch/XHR)
 * and forwards only the parts we care about - restaurants carrying a promo
 * field and dishes with a crossed-out/promo price - plus it reuses the page's
 * own Authorization header to fetch the menus of restaurants with promos.
 * Everything stays on the phone (AsyncStorage); nothing goes to our server.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius } from "../theme";
import { saveBoltDeals } from "../storage";

export const BOLT_HOME = "https://food.bolt.eu/bg-BG/2098-varna";

// Runs inside food.bolt.eu before the app's own code. Keep it ES5-ish and defensive.
const INJECT = `
(function(){
  if (window.__bgInjected) return; window.__bgInjected = true;
  var API = 'deliveryuser.live.boltsvc.net';
  var auth = null, qs = null, loc = null, menuTpl = null, fetched = {};
  function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){} }
  function txt(v){
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map(txt).filter(Boolean).join(' · ');
    if (typeof v === 'object') {
      var ks = ['value','text','title','label','name','description','short'];
      for (var i = 0; i < ks.length; i++) if (typeof v[ks[i]] === 'string' && v[ks[i]]) return v[ks[i]];
      return Object.keys(v).map(function(k){ return txt(v[k]); }).filter(Boolean).join(' ');
    }
    return String(v);
  }
  function promoProv(p){
    return !!(p.promotion || p.menu_discount || (p.tile_labels && p.tile_labels.length) || p.inclusion_campaigns_max_percentage ||
      p.max_discount_amount || p.delivery_promo_icon_key || p.exclusion_campaign_percentage || p.provider_snackbar_text);
  }
  function provLabel(p){
    var parts = [];
    if (p.tile_labels && p.tile_labels.length) parts.push(txt(p.tile_labels));
    if (p.promotion) parts.push(txt(p.promotion));
    if (p.menu_discount) { var md = p.menu_discount; parts.push(md.percentage ? ('-' + md.percentage + '% меню') : txt(md)); }
    if (p.inclusion_campaigns_max_percentage) parts.push('до -' + p.inclusion_campaigns_max_percentage + '%');
    if (p.max_discount_amount) parts.push('до ' + txt(p.max_discount_amount));
    if (p.provider_snackbar_text) parts.push(txt(p.provider_snackbar_text));
    if (p.delivery_promo_icon_key) parts.push('промо доставка');
    return parts.filter(Boolean).join(' · ').slice(0, 140);
  }
  function img(images){
    try { var ks = Object.keys(images || {}); for (var i = 0; i < ks.length; i++) { var s = images[ks[i]].aspect_ratio_map.original; var u = s['1x'] || s['2x'] || s['3x']; if (u) return u; } } catch(e){}
    return null;
  }
  function numDeep(o, rx, depth){
    if (!o || typeof o !== 'object' || depth > 2) return null;
    var ks = Object.keys(o);
    for (var i = 0; i < ks.length; i++) { var k = ks[i], v = o[k]; if (rx.test(k)) { if (typeof v === 'number') return v; if (v && typeof v === 'object' && typeof v.value === 'number') return v.value; } }
    for (var j = 0; j < ks.length; j++) { var r = numDeep(o[ks[j]], rx, depth + 1); if (r != null) return r; }
    return null;
  }
  function dishDeal(d){
    var price = d.price || {};
    if (d.promo_key) return true;
    if (d.original_price || d.discount || d.campaign) return true;
    var pk = Object.keys(price);
    for (var i = 0; i < pk.length; i++) if (/original|old|before|discount|strike|campaign|promo/i.test(pk[i]) && price[pk[i]]) return true;
    var dk = Object.keys(d);
    for (var j = 0; j < dk.length; j++) if (/discount|campaign/i.test(dk[j]) && d[dk[j]] && (typeof d[dk[j]] !== 'object' || Object.keys(d[dk[j]]).length)) return true;
    return false;
  }
  function parseMenu(text, pid, pname){
    var j; try { j = JSON.parse(text); } catch(e){ return; }
    var data = j.data || j; var items = data.items || {}; var promos = data.menu_promos || {};
    var out = [];
    Object.keys(items).forEach(function(k){
      var d = items[k]; if (!d || d.type !== 'dish' || !dishDeal(d)) return;
      var parent = items[String(d.parent_id)] || {};
      var price = d.price || {};
      var orig = numDeep(price, /original|old|before|strike/i, 0); if (orig == null) orig = numDeep(d, /original|old|before|strike/i, 0);
      var promo = d.promo_key ? (promos[d.promo_key] ? txt(promos[d.promo_key]) : String(d.promo_key)) : '';
      out.push({ id: String(d.id), provider_id: String(pid), restaurant: pname || '', name: txt(d.name), price: typeof price.value === 'number' ? price.value : null, price_str: price.price_str || '', original: orig, promo: promo.slice(0, 120), category: txt(parent.name), image_url: img(d.images) });
    });
    post({ type: 'dishes', provider_id: String(pid), count: Object.keys(items).length, deals: out.slice(0, 80) });
  }
  function fetchMenu(p){
    if (!auth || fetched[p.id] || (!menuTpl && !(qs && loc))) return; fetched[p.id] = 1;
    var url = menuTpl ? menuTpl.replace(/provider_id=\\d+/, 'provider_id=' + p.id) :
      ('https://' + API + '/deliveryClient/getMenuCategories?' + qs + '&provider_id=' + p.id + '&delivery_lat=' + loc.lat + '&delivery_lng=' + loc.lng);
    var h = { 'Authorization': auth, 'Accept': 'application/json' };
    window.__origFetch(url, { headers: h }).then(function(r){ return r.text(); }).then(function(t){ parseMenu(t, p.id, p.name); }).catch(function(){});
  }
  function handle(url, h, body, text){
    if (!url || url.indexOf(API) < 0) return;
    var authed = !!(h && h.Authorization);
    if (authed) { auth = h.Authorization; var q = url.split('?')[1]; if (q) qs = q.replace(/&?(provider_id|delivery_lat|delivery_lng|lat|lng)=[^&]*/g, ''); }
    if (/getMenuCategories/.test(url)) {
      if (authed) menuTpl = url;
      var m = /provider_id=(\\d+)/.exec(url); parseMenu(text, m ? m[1] : '', '');
      return;
    }
    if (/findProviders|getScreenContent|cityWideSearch|deliverySearch/.test(url)) {
      var j; try { j = JSON.parse(text); } catch(e){ return; }
      try { var b = typeof body === 'string' ? JSON.parse(body) : null; if (b && b.lat) loc = { lat: b.lat, lng: b.lng }; if (b && b.delivery_lat) loc = { lat: b.delivery_lat, lng: b.delivery_lng }; } catch(e){}
      var provs = [];
      (function walk(o, depth){ if (!o || typeof o !== 'object' || depth > 6) return; if (Array.isArray(o)) { o.forEach(function(x){ walk(x, depth + 1); }); return; }
        if (o.provider_id && o.name) { provs.push(o); return; } if (o.id && o.name && o.delivery && o.contact) { provs.push(o); return; }
        Object.keys(o).forEach(function(k){ walk(o[k], depth + 1); }); })(j, 0);
      var promos = provs.filter(promoProv).map(function(p){ var id = String(p.provider_id || p.id); return { id: id, name: txt(p.name), label: provLabel(p), slug: p.slug || '', image_url: img(p.images) || (p.media && p.media.cover_image) || null, fee: p.delivery_price && p.delivery_price.value, minutes: p.max_delivery_eta ? Math.round(p.max_delivery_eta / 60) : null }; });
      post({ type: 'providers', authed: authed, total: provs.length, promos: promos, url: url.split('?')[0] });
      if (authed) promos.slice(0, 40).forEach(fetchMenu);
    }
  }
  function headersOf(init, input){
    var h = {}; var src = (init && init.headers) || (input && input.headers);
    try { if (src) { if (typeof src.forEach === 'function' && !Array.isArray(src)) src.forEach(function(v, k){ h[k] = v; }); else if (Array.isArray(src)) src.forEach(function(kv){ h[kv[0]] = kv[1]; }); else Object.keys(src).forEach(function(k){ h[k] = src[k]; }); } } catch(e){}
    var n = {}; Object.keys(h).forEach(function(k){ n[k.toLowerCase() === 'authorization' ? 'Authorization' : k] = h[k]; }); return n;
  }
  var of = window.fetch; window.__origFetch = of.bind(window);
  window.fetch = function(input, init){
    var p = of.apply(this, arguments);
    try { var url = typeof input === 'string' ? input : (input && input.url); if (url && url.indexOf(API) >= 0) { var h = headersOf(init, input); var body = init && init.body; p.then(function(res){ try { res.clone().text().then(function(t){ handle(url, h, body, t); }); } catch(e){} }); } } catch(e){}
    return p;
  };
  var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send, oSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(m, u){ this.__u = u; this.__h = {}; return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function(k, v){ if (this.__h) this.__h[k.toLowerCase() === 'authorization' ? 'Authorization' : k] = v; return oSet.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(b){ var x = this; x.addEventListener('load', function(){ try { handle(x.__u, x.__h, b, x.responseText); } catch(e){} }); return oSend.apply(this, arguments); };
  post({ type: 'ready' });
})(); true;
`;

export default function BoltConnect({ visible, onClose, onDeals }) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState({ authed: false, providers: 0, promos: {}, dishes: {} });
  const [loading, setLoading] = useState(true);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (visible) setState({ authed: false, providers: 0, promos: {}, dishes: {} });
  }, [visible]);

  const onMessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    const s = stateRef.current;
    if (m.type === "providers") {
      const promos = { ...s.promos };
      for (const p of m.promos || []) promos[p.id] = p;
      const next = { ...s, authed: s.authed || !!m.authed, providers: Math.max(s.providers, m.total || 0), promos };
      setState(next);
      persist(next);
    } else if (m.type === "dishes") {
      const dishes = { ...s.dishes };
      for (const d of m.deals || []) dishes[d.id] = d;
      const next = { ...s, dishes };
      setState(next);
      persist(next);
    }
  };
  const persist = (s) => {
    const data = { capturedAt: new Date().toISOString(), authed: s.authed, providers: Object.values(s.promos), dishes: Object.values(s.dishes) };
    saveBoltDeals(data);
    onDeals?.(data);
  };

  if (!visible) return null;
  const nProv = Object.keys(state.promos).length;
  const nDish = Object.keys(state.dishes).length;
  let WebView = null;
  if (Platform.OS !== "web") {
    // eslint-disable-next-line global-require
    WebView = require("react-native-webview").WebView;
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.wrap, { paddingTop: insets.top }]}>
        <View style={styles.bar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Bolt Food · твоят профил</Text>
            <Text style={styles.sub} numberOfLines={2}>
              {state.authed
                ? `Влязъл си. Намерени: ${nProv} ресторанта с промо · ${nDish} ястия с отстъпка${state.providers ? ` (от ${state.providers})` : ""}. Разгледай началната страница и ресторантите - събираме отстъпките.`
                : "Влез с телефона си както в приложението на Bolt. Паролата/кодът остават в Bolt - ние виждаме само отстъпките."}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.done}>
            <Ionicons name={nProv || nDish ? "checkmark" : "close"} size={18} color="#fff" />
            <Text style={styles.doneText}>{nProv || nDish ? "Готово" : "Затвори"}</Text>
          </Pressable>
        </View>
        {WebView ? (
          <WebView
            source={{ uri: BOLT_HOME }}
            injectedJavaScriptBeforeContentLoaded={INJECT}
            injectedJavaScript={INJECT}
            onMessage={onMessage}
            onLoadEnd={() => setLoading(false)}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            userAgent="Mozilla/5.0 (Linux; Android 14; SM-A266B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
            style={{ flex: 1 }}
          />
        ) : (
          <View style={styles.center}>
            <Text style={styles.sub}>Входът в Bolt работи само в приложението на телефона.</Text>
          </View>
        )}
        {loading && WebView ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.headerBg },
  title: { color: colors.headerInk, fontSize: 15, fontWeight: "800" },
  sub: { color: colors.headerInk2, fontSize: 11, marginTop: 2, lineHeight: 15 },
  done: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#34D186", borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  doneText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  loading: { position: "absolute", top: 80, left: 0, right: 0, alignItems: "center" },
});
