import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { STORE_ORDER } from "../config";
import { colors, radius } from "../theme";

/**
 * Shown while the backend wakes up (free hosting) or is still scraping after a
 * restart. `status` is the /api/status payload (may be null while unreachable).
 */
export default function ServerWaking({ status, seconds }) {
  const stores = status?.stores || [];
  const byName = Object.fromEntries(stores.map((s) => [s.store, s]));
  const phase = !status ? "Събуждаме сървъра…" : status.scraping ? "Зареждаме офертите от магазините…" : "Почти готово…";
  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.title}>{phase}</Text>
      <Text style={styles.sub}>
        {!status
          ? `Безплатният сървър заспива при неактивност - първото отваряне отнема до минута (${seconds}s).`
          : "Всяка седмица събираме промоциите наново - отнема около 30 секунди."}
      </Text>
      <View style={styles.grid}>
        {STORE_ORDER.map((name) => {
          const s = byName[name];
          const done = s && s.offers > 0;
          return (
            <View key={name} style={[styles.pill, done && styles.pillDone]}>
              <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={14} color={done ? colors.success : colors.ink3} />
              <Text style={[styles.pillText, done && { color: colors.ink }]}>
                {name}
                {done ? ` · ${s.offers}` : ""}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 44, paddingHorizontal: 28, gap: 10 },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink, marginTop: 6 },
  sub: { fontSize: 13, color: colors.ink2, textAlign: "center", lineHeight: 19 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 10 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pillDone: { borderColor: colors.successSoft, backgroundColor: colors.successSoft },
  pillText: { fontSize: 12, fontWeight: "600", color: colors.ink3 },
});
