/**
 * "Най-евтино" - runs the list through /api/cart/optimize and shows the
 * cheapest single store and the cheapest split trip.
 */
import React from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import StoreBadge from "../../components/StoreBadge";
import { STORES } from "../../config";
import { colors, money, radius, shadow } from "../../theme";
import { plural } from "../../utils";

export default function OptimizeView({ items, result, loading, error, onRun, onOpenOffer, onGoToList }) {
  const single = result?.best_single_store;

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="sparkles-outline" size={36} color={colors.ink3} />
        <Text style={styles.emptyTitle}>Първо напиши списъка</Text>
        <Text style={styles.emptySub}>Сложи продуктите в „Списък“ и тук ще сметнем в кой магазин (или комбинация от магазини) ще платиш най-малко тази седмица.</Text>
        <Pressable onPress={onGoToList} style={styles.link}>
          <Text style={styles.linkText}>Към списъка</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Pressable onPress={onRun} disabled={loading} style={({ pressed }) => [styles.cta, (pressed || loading) && { opacity: 0.8 }]}>
        {loading ? <ActivityIndicator color="#fff" /> : <Ionicons name="sparkles" size={18} color="#fff" />}
        <Text style={styles.ctaText}>{loading ? "Смятаме…" : `Намери най-евтиното за ${plural(items.length, "продукт", "продукта")}`}</Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      {!result && !loading && <Text style={styles.hint}>Сравняваме всеки продукт от списъка с промоциите в Lidl, Kaufland, Billa и Metro (с цените с карта).</Text>}

      {result && (
        <View style={{ gap: 14 }}>
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
                    <Row key={it.item} match={it} onPress={() => onOpenOffer(it.offer)} />
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
                <Row key={it.item} match={it} onPress={() => it.offer && onOpenOffer(it.offer)} />
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
    </View>
  );
}

function Row({ match, onPress }) {
  const o = match.offer;
  return (
    <Pressable onPress={onPress} disabled={!o} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={styles.rowThumb}>
        {o?.image_url || match.image_url ? <Image source={{ uri: o?.image_url || match.image_url }} style={styles.img} resizeMode="contain" /> : <Ionicons name="cube-outline" size={16} color={colors.ink3} />}
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
  empty: { alignItems: "center", gap: 8, paddingVertical: 36, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  emptySub: { fontSize: 13, color: colors.ink2, textAlign: "center", lineHeight: 19 },
  link: { marginTop: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.primary },
  linkText: { color: "#fff", fontWeight: "700" },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.ink, paddingVertical: 14, borderRadius: radius.lg, ...shadow.card },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  hint: { fontSize: 12, color: colors.ink3, textAlign: "center", lineHeight: 17 },
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
  img: { width: "100%", height: "100%" },
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
