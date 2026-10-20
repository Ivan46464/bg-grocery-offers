/**
 * "Разходи" - what you spent on groceries: this month, the last 6 months as
 * bars, per-store split, and every saved shopping trip (expandable, deletable).
 * Everything lives on the phone (AsyncStorage); nothing is sent anywhere.
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { STORES } from "../../config";
import { colors, money, radius, shadow } from "../../theme";

const MONTHS = ["яну", "фев", "мар", "апр", "май", "юни", "юли", "авг", "сеп", "окт", "ное", "дек"];
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

export default function ExpensesView({ trips, onDelete }) {
  const [open, setOpen] = useState(null);

  const stats = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: monthKey(d), label: MONTHS[d.getMonth()], total: 0, trips: 0 });
    }
    const byStore = {};
    const thisKey = monthKey(now);
    for (const t of trips) {
      const k = monthKey(new Date(t.date));
      const m = months.find((x) => x.key === k);
      if (m) {
        m.total += t.total;
        m.trips += 1;
      }
      if (k === thisKey) byStore[t.store] = (byStore[t.store] || 0) + t.total;
    }
    const thisMonth = months[months.length - 1];
    const prevMonth = months[months.length - 2];
    const max = Math.max(...months.map((m) => m.total), 1);
    return { months, thisMonth, prevMonth, max, byStore: Object.entries(byStore).sort((a, b) => b[1] - a[1]), allTime: trips.reduce((s, t) => s + t.total, 0) };
  }, [trips]);

  if (trips.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="wallet-outline" size={36} color={colors.ink3} />
        <Text style={styles.emptyTitle}>Още няма записани покупки</Text>
        <Text style={styles.emptySub}>Направи списък, отметни продуктите в магазина, въведи цените и натисни „Приключи пазаруването“ - тук ще виждаш колко харчиш за храна по месеци и магазини.</Text>
      </View>
    );
  }

  const delta = stats.prevMonth.total ? ((stats.thisMonth.total - stats.prevMonth.total) / stats.prevMonth.total) * 100 : null;

  return (
    <View style={{ gap: 12 }}>
      {/* this month */}
      <View style={[styles.card, styles.hero]}>
        <Text style={styles.heroLabel}>Този месец</Text>
        <Text style={styles.heroValue}>{money(stats.thisMonth.total)}</Text>
        <Text style={styles.heroSub}>
          {stats.thisMonth.trips} {stats.thisMonth.trips === 1 ? "пазаруване" : "пазарувания"}
          {delta != null ? ` · ${delta >= 0 ? "+" : ""}${delta.toFixed(0)}% спрямо ${stats.prevMonth.label}` : ""}
          {` · общо ${money(stats.allTime)}`}
        </Text>
      </View>

      {/* 6-month bars */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Последните 6 месеца</Text>
        <View style={styles.bars}>
          {stats.months.map((m) => (
            <View key={m.key} style={styles.barCol}>
              <Text style={styles.barValue}>{m.total ? Math.round(m.total) : ""}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { height: `${Math.max(4, (m.total / stats.max) * 100)}%` }, m.key === stats.thisMonth.key && { backgroundColor: colors.primary }]} />
              </View>
              <Text style={styles.barLabel}>{m.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* by store this month */}
      {stats.byStore.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>По магазини този месец</Text>
          {stats.byStore.map(([store, total]) => (
            <View key={store} style={styles.storeRow}>
              <View style={[styles.dot, { backgroundColor: STORES[store]?.bg || colors.ink3 }]} />
              <Text style={styles.storeName}>{store}</Text>
              <View style={styles.storeTrack}>
                <View style={[styles.storeFill, { width: `${(total / stats.thisMonth.total) * 100}%`, backgroundColor: STORES[store]?.bg || colors.ink3 }]} />
              </View>
              <Text style={styles.storeTotal}>{money(total)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* trips */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Покупки</Text>
        {trips.map((t, idx) => {
          const expanded = open === t.id;
          return (
            <View key={t.id} style={[idx > 0 && styles.tripBorder]}>
              <Pressable onPress={() => setOpen(expanded ? null : t.id)} style={styles.trip}>
                <View style={[styles.dot, { backgroundColor: STORES[t.store]?.bg || colors.ink3 }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tripStore}>
                    {t.store}
                    {t.note ? <Text style={styles.tripNote}> · {t.note}</Text> : null}
                  </Text>
                  <Text style={styles.tripMeta}>
                    {fmtDate(t.date)} · {t.items.length} продукта
                  </Text>
                </View>
                <Text style={styles.tripTotal}>{money(t.total)}</Text>
                <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.ink3} />
              </Pressable>
              {expanded && (
                <View style={styles.tripItems}>
                  {t.items.map((it, i) => (
                    <View key={i} style={styles.tripItem}>
                      <Text style={styles.tripItemName} numberOfLines={1}>
                        {it.qty > 1 ? `${it.qty}× ` : ""}
                        {it.name}
                      </Text>
                      <Text style={styles.tripItemPrice}>{it.price != null ? money(it.price * (it.qty || 1)) : "–"}</Text>
                    </View>
                  ))}
                  <Pressable onPress={() => onDelete(t.id)} style={styles.delete} hitSlop={6}>
                    <Ionicons name="trash-outline" size={14} color={colors.danger} />
                    <Text style={styles.deleteText}>Изтрий покупката</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: 8, paddingVertical: 36, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  emptySub: { fontSize: 13, color: colors.ink2, textAlign: "center", lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, ...shadow.card },
  hero: { backgroundColor: colors.ink },
  heroLabel: { color: colors.headerInk2, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  heroValue: { color: "#fff", fontSize: 34, fontWeight: "900", letterSpacing: -0.5, marginTop: 2 },
  heroSub: { color: colors.headerInk2, fontSize: 12, marginTop: 4 },
  cardTitle: { fontSize: 14, fontWeight: "800", color: colors.ink, marginBottom: 10 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 8, height: 120 },
  barCol: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end" },
  barValue: { fontSize: 10, color: colors.ink3, fontWeight: "700", marginBottom: 3 },
  barTrack: { flex: 1, width: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", backgroundColor: colors.border, borderRadius: 6 },
  barLabel: { fontSize: 11, color: colors.ink2, marginTop: 6, fontWeight: "600" },
  storeRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  storeName: { width: 64, fontSize: 13, fontWeight: "700", color: colors.ink },
  storeTrack: { flex: 1, height: 8, backgroundColor: colors.surfaceAlt, borderRadius: 4, overflow: "hidden" },
  storeFill: { height: "100%", borderRadius: 4 },
  storeTotal: { fontSize: 13, fontWeight: "800", color: colors.ink, minWidth: 64, textAlign: "right" },
  tripBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  trip: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  tripStore: { fontSize: 14, fontWeight: "700", color: colors.ink },
  tripNote: { fontWeight: "400", color: colors.ink2 },
  tripMeta: { fontSize: 12, color: colors.ink3, marginTop: 1 },
  tripTotal: { fontSize: 15, fontWeight: "800", color: colors.ink },
  tripItems: { paddingLeft: 20, paddingBottom: 10, gap: 4 },
  tripItem: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  tripItemName: { flex: 1, fontSize: 13, color: colors.ink2 },
  tripItemPrice: { fontSize: 13, color: colors.ink, fontWeight: "600" },
  delete: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, alignSelf: "flex-start" },
  deleteText: { fontSize: 12, color: colors.danger, fontWeight: "600" },
});
