import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../theme";

/** Centered message for loading / error / no-results situations. */
export default function EmptyState({ icon = "search-outline", title, subtitle, actionLabel, onAction, loading = false }) {
  return (
    <View style={styles.wrap}>
      {loading ? <ActivityIndicator size="large" color={colors.primary} /> : <Ionicons name={icon} size={44} color={colors.ink3} />}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel ? (
        <Pressable onPress={onAction} style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 28, gap: 10 },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink, textAlign: "center", marginTop: 6 },
  subtitle: { fontSize: 14, color: colors.ink2, textAlign: "center", lineHeight: 20 },
  button: { marginTop: 10, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 20, paddingVertical: 11 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
});
