/**
 * Smart cart: pick SPECIFIC products (with pictures) and we tell you the
 * cheapest single store and the cheapest split across stores (with savings).
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { optimizeCart } from "../api";
import EmptyState from "../components/EmptyState";
import OfferSheet from "../components/OfferSheet";
import ProductPicker from "../components/ProductPicker";
import ScreenHeader from "../components/ScreenHeader";
import StoreBadge from "../components/StoreBadge";
import { useToast } from "../components/Toast";
import { STORES } from "../config";
import { cartItemId, loadCart, saveCart } from "../storage";
import { colors, money, radius, shadow } from "../theme";
import { plural } from "../utils";

export default function CartScreen() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [picker, setPicker] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadCart().then((it) => {
        setItems(it);
        setResult(null);
      });
    }, [])
  );

  const persist = (next) => {
    setItems(next);
    setResult(null);
    saveCart(next);
  };
  const add = (p) => {
    const id = cartItemId(p);
    setPicker(false);
    if (items.some((x) => x.id === id)) return toast("Вече е в количката", "cart");
    persist([...items, { ...p, id }]);
    toast(`Добавено: ${p.name.slice(0, 40)}`, "cart");
  };
  const remove = (id) => persist(items.filter((x) => x.id !== id));

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await optimizeCart(items.map(({ name, barcode, image_url, exact }) => ({ name, barcode, image_url, exact }))));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const single = result?.best_single_store;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Умна количка" subtitle="Къде е най-евтино да напазаруваш всичко" icon="basket">
        <Pressable onPress={() => setPicker(true)} style={({ pressed }) => [styles.addBar, pressed && { opacity: 0.85 }]}>
          <Ionicons name="add-circle" size={22} color={colors.primary} />
          <Text style={styles.addBarText}>Добави продукт…</Text>
          <Ionicons name="images-outline" size={18} color={colors.ink3} />
        </Pressable>
      </ScreenHeader>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {items.length === 0 ? (
          <EmptyState icon="basket-outline" title="Списъкът е празен" subtitle="Натисни „Добави продукт“ и избери точните продукти, които ти трябват - със снимка, не само дума." actionLabel="Добави продукт" onAction={() => setPicker(true)} />
        ) : (
          <>
            <View style={styles.items}>
              {items.map((it) => (
                <View key={it.id} style={styles.itemRow}>
                  <View style={styles.thumb}>
                    {it.image_url ? <Image source={{ uri: it.image_url }} style={styles.img} resizeMode="contain" /> : <Ionicons name={it.exact ? "cube-outline" : "text-outline"} size={20} color={colors.ink3} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName} numberOfLines={2}>
                      {it.name}
                    </Text>
                    {!it.exact && <Text style={styles.itemHint}>общо търсене - всякакъв „{it.name}“</Text>}
                  </View>
                  <Pressable onPress={() => remove(it.id)} hitSlop={10} style={styles.trash}>
                    <Ionicons name="close-circle" size={22} color={colors.ink3} />
                  </Pressable>
                </View>
              ))}
            </View>

            <Pressable onPress={run} disabled={loading} style={({ pressed }) => [styles.cta, (pressed || loading) && { opacity: 0.8 }]}>
              {loading ? <ActivityIndicator color="#fff" /> : <Ionicons name="sparkles" size={18} color="#fff" />}
              <Text style={styles.ctaText}>{loading ? "Смятаме…" : `Намери най-евтиното за ${plural(items.length, "продукт", "продукта")}`}</Text>
            </Pressable>
            {error && <Text style={styles.error}>{error}</Text>}
          </>
        )}

        {result && (
          <View style={{ gap: 14, marginTop: 6 }}>
            {result.best_split.length > 0 && (
              <View style={[styles.card, styles.cardHero]}>
                <View style={styles.cardHead}>
                  <Ionicons name="git-branch-outline" size={18} color={colors.success} />
                  <Text style={styles.cardTitle}>Най-евтино общо</Text>
                  <Text style={styles.cardTotal}>{money(result.split_total)}</Text>
                </View>
                {result.savings_vs_single > 0 && single ? (
                  <Text style={styles.saveLine}>
                    Спестяваш <Text style={{ fontWeight: "800" }}>{money(result.savings_vs_single)}</Text> спрямо пазаруване само в {single.store}
                  </Text>
                ) : (
                  <Text style={styles.saveLine}>Един магазин е достатъчен - няма по-евтино разделяне.</Text>
                )}
                {result.best_split.map((stop) => (
                  <View key={stop.store} style={styles.stop}>
                    <View style={styles.stopHead}>
                      <StoreBadge store={stop.store} />
                      <Text style={styles.stopTotal}>{money(stop.subtotal)}</Text>
                    </View>
                    {stop.items.map((it) => (
                      <Row key={it.item} match={it} onPress={() => setSelected(it.offer)} />
                    ))}
                  </View>
                ))}
                {result.split_missing.length > 0 && <Text style={styles.missing}>Без промоция тази седмица: {result.split_missing.join(", ")}</Text>}
              </View>
            )}

            {single && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name="storefront-outline" size={18} color={colors.primary} />
                  <Text style={styles.cardTitle}>Само един магазин</Text>
                  <Text style={styles.cardTotal}>{money(single.total)}</Text>
                </View>
                <View style={[styles.stopHead, { marginBottom: 6 }]}>
                  <StoreBadge store={single.store} />
                  <Text style={styles.meta}>
                    {single.found}/{result.items.length} продукта на промоция
                  </Text>
                </View>
                {single.items.map((it) => (
                  <Row key={it.item} match={it} onPress={() => it.offer && setSelected(it.offer)} />
                ))}
              </View>
            )}

            <View style={styles.card}>
              <Text style={[styles.cardTitle, { marginBottom: 8 }]}>Сравнение по магазини</Text>
              {result.stores.map((s) => (
                <View key={s.store} style={styles.compareRow}>
                  <View style={[styles.dot, { backgroundColor: STORES[s.store]?.bg || colors.ink }]} />
                  <Text style={styles.compareStore}>{s.store}</Text>
                  <Text style={styles.meta}>
                    {s.found}/{result.items.length}
                  </Text>
                  <Text style={styles.compareTotal}>{s.found ? money(s.total) : "–"}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <ProductPicker visible={picker} onClose={() => setPicker(false)} onPick={add} title="Добави в количката" />
      <OfferSheet offer={selected} onClose={() => setSelected(null)} onAddToCart={() => { setSelected(null); toast("Вече е в количката", "cart"); }} />
    </View>
  );
}

function Row({ match, onPress }) {
  const o = match.offer;
  return (
    <Pressable onPress={onPress} disabled={!o} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={styles.rowThumb}>
        {(o?.image_url || match.image_url) ? <Image source={{ uri: o?.image_url || match.image_url }} style={styles.img} resizeMode="contain" /> : <Ionicons name="cube-outline" size={16} color={colors.ink3} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowItem} numberOfLines={1}>
          {match.item}
        </Text>
        {o ? (
          <Text style={styles.rowName} numberOfLines={1}>
            {o.product_name}
            {o.card_price != null ? <Text style={{ color: "#92400E" }}> · с карта</Text> : null}
            {o.promo_label ? <Text style={{ color: colors.info }}> · {o.promo_label}</Text> : null}
          </Text>
        ) : (
          <Text style={[styles.rowName, { color: colors.ink3, fontStyle: "italic" }]}>няма промоция</Text>
        )}
      </View>
      {o && <Text style={styles.rowPrice}>{money(o.effective_price || o.discounted_price)}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  addBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14, height: 52, ...shadow.float },
  addBarText: { flex: 1, fontSize: 16, color: colors.ink2 },
  body: { padding: 16, paddingBottom: 32, gap: 12 },
  items: { gap: 8 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 10, ...shadow.card },
  thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  img: { width: "100%", height: "100%" },
  itemName: { fontSize: 14, fontWeight: "600", color: colors.ink, lineHeight: 19 },
  itemHint: { fontSize: 11, color: colors.ink3, marginTop: 2 },
  trash: { padding: 4 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.ink, paddingVertical: 14, borderRadius: radius.lg, ...shadow.card },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  error: { color: colors.danger, textAlign: "center" },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, ...shadow.card },
  cardHero: { borderWidth: 1.5, borderColor: colors.success },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: colors.ink, flex: 1 },
  cardTotal: { fontSize: 18, fontWeight: "900", color: colors.ink },
  saveLine: { color: colors.success, fontSize: 13, marginBottom: 8 },
  stop: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  stopHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  stopTotal: { fontWeight: "800", color: colors.ink2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  rowThumb: { width: 34, height: 34, borderRadius: 8, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  rowItem: { fontSize: 12, fontWeight: "700", color: colors.ink2 },
  rowName: { fontSize: 13, color: colors.ink },
  rowPrice: { fontWeight: "800", color: colors.ink },
  missing: { marginTop: 8, fontSize: 12, color: colors.ink3 },
  meta: { fontSize: 12, color: colors.ink3 },
  compareRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  compareStore: { flex: 1, fontWeight: "700", color: colors.ink },
  compareTotal: { fontWeight: "800", color: colors.ink, minWidth: 70, textAlign: "right" },
});
