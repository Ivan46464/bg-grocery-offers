/**
 * Smart cart: type the things you need, we tell you the cheapest single store
 * and the cheapest split across stores (with what you save).
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { optimizeCart } from "../api";
import EmptyState from "../components/EmptyState";
import OfferSheet from "../components/OfferSheet";
import ScreenHeader from "../components/ScreenHeader";
import StoreBadge from "../components/StoreBadge";
import { useToast } from "../components/Toast";
import { STORES } from "../config";
import { loadCart, saveCart } from "../storage";
import { colors, money, radius, shadow } from "../theme";
import { plural } from "../utils";

const SUGGESTIONS = ["яйца", "мляко", "кафе", "сирене", "кашкавал", "хляб", "банани", "пилешко", "олио", "бира"];

export default function CartScreen() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadCart().then(setItems);
    }, [])
  );

  const persist = (next) => {
    setItems(next);
    setResult(null);
    saveCart(next);
  };
  const add = (raw) => {
    const q = (raw ?? text).trim().toLowerCase();
    if (!q) return;
    if (!items.includes(q)) persist([...items, q]);
    setText("");
  };
  const remove = (q) => persist(items.filter((x) => x !== q));

  const run = async () => {
    Keyboard.dismiss();
    setLoading(true);
    setError(null);
    try {
      setResult(await optimizeCart(items));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const single = result?.best_single_store;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Умна количка" subtitle="Къде е най-евтино да напазаруваш всичко">
        <View style={styles.inputRow}>
          <Ionicons name="add-circle-outline" size={20} color={colors.ink3} />
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => add()}
            placeholder="Добави продукт… напр. яйца"
            placeholderTextColor={colors.ink3}
            returnKeyType="done"
            blurOnSubmit={false}
            autoCapitalize="none"
          />
          <Pressable onPress={() => add()} style={styles.addBtn}>
            <Text style={styles.addBtnText}>Добави</Text>
          </Pressable>
        </View>
      </ScreenHeader>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {items.length === 0 ? (
          <View>
            <EmptyState icon="basket-outline" title="Списъкът е празен" subtitle="Добави няколко продукта или избери от предложенията:" />
            <View style={styles.suggest}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => add(s)} style={styles.suggestChip}>
                  <Text style={styles.suggestText}>+ {s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <>
            <View style={styles.chips}>
              {items.map((q) => (
                <View key={q} style={styles.itemChip}>
                  <Text style={styles.itemText}>{q}</Text>
                  <Pressable onPress={() => remove(q)} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={colors.ink3} />
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={() => persist([])} hitSlop={8} style={styles.clearAll}>
                <Text style={styles.clearAllText}>изчисти</Text>
              </Pressable>
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
            {/* Split trip */}
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

            {/* Single store */}
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

            {/* Comparison */}
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

      <OfferSheet offer={selected} onClose={() => setSelected(null)} onAddToCart={() => { setSelected(null); toast("Вече е в количката", "cart"); }} />
    </View>
  );
}

function Row({ match, onPress }) {
  const o = match.offer;
  return (
    <Pressable onPress={onPress} disabled={!o} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <Text style={styles.rowItem}>{match.item}</Text>
      {o ? (
        <>
          <Text style={styles.rowName} numberOfLines={1}>
            {o.product_name}
            {o.card_price != null ? <Text style={{ color: "#92400E" }}> · с карта</Text> : null}
            {o.promo_label ? <Text style={{ color: colors.info }}> · {o.promo_label}</Text> : null}
          </Text>
          <Text style={styles.rowPrice}>{money(o.effective_price || o.discounted_price)}</Text>
        </>
      ) : (
        <Text style={[styles.rowName, { color: colors.ink3, fontStyle: "italic" }]}>няма промоция</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inputRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.lg, paddingLeft: 14, paddingRight: 6, height: 52, gap: 8, ...shadow.float },
  input: { flex: 1, fontSize: 16, color: colors.ink, height: "100%" },
  addBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.md },
  addBtnText: { color: "#fff", fontWeight: "700" },
  body: { padding: 16, paddingBottom: 32, gap: 12 },
  suggest: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  suggestChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  suggestText: { color: colors.ink2, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  itemChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 8, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  itemText: { fontWeight: "600", color: colors.ink },
  clearAll: { paddingHorizontal: 8 },
  clearAllText: { color: colors.ink3, fontSize: 13, textDecorationLine: "underline" },
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
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  rowItem: { fontSize: 13, fontWeight: "700", color: colors.ink2, width: 78 },
  rowName: { flex: 1, fontSize: 13, color: colors.ink },
  rowPrice: { fontWeight: "800", color: colors.ink },
  missing: { marginTop: 8, fontSize: 12, color: colors.ink3 },
  meta: { fontSize: 12, color: colors.ink3 },
  compareRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  compareStore: { flex: 1, fontWeight: "700", color: colors.ink },
  compareTotal: { fontWeight: "800", color: colors.ink, minWidth: 70, textAlign: "right" },
});
