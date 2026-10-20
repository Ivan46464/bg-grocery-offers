import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { loadFlag, saveFlag } from "../storage";
import { colors, radius, shadow } from "../theme";

const STEPS = [
  { icon: "search", text: "Търси продукт или натисни картата за детайли и подобни оферти" },
  { icon: "add-circle", text: "„+ Списък“ на картата слага продукта в твоя списък за пазаруване" },
  { icon: "basket", text: "Количка → „Най-евтино“ казва къде да пазаруваш; „Разходи“ брои парите" },
  { icon: "notifications", text: "„Следи цената“ те известява, когато продуктът поевтинее" },
];

/** Dismissible 4-step explainer shown on the main screen until the user closes it. */
export default function HowItWorks() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    loadFlag("howItWorksDismissed").then((d) => setVisible(!d));
  }, []);
  if (!visible) return null;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Как работи</Text>
        <Pressable
          onPress={() => {
            setVisible(false);
            saveFlag("howItWorksDismissed", true);
          }}
          hitSlop={10}
        >
          <Ionicons name="close" size={18} color={colors.ink3} />
        </Pressable>
      </View>
      {STEPS.map((s, i) => (
        <View key={i} style={styles.step}>
          <View style={styles.num}>
            <Ionicons name={s.icon} size={14} color={colors.primary} />
          </View>
          <Text style={styles.text}>{s.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginBottom: 12, gap: 8, borderWidth: 1, borderColor: colors.primarySoft, ...shadow.card },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 14, fontWeight: "800", color: colors.ink },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, fontSize: 13, color: colors.ink2, lineHeight: 18 },
});
