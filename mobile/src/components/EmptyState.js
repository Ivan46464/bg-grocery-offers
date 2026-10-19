import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** Centered message for loading / error / no-results situations. */
export default function EmptyState({ emoji = "🔍", title, subtitle, actionLabel, onAction }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel ? (
        <Pressable onPress={onAction} style={styles.button}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 24, gap: 8 },
  emoji: { fontSize: 44, marginBottom: 6 },
  title: { fontSize: 17, fontWeight: "700", color: "#0F172A", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#64748B", textAlign: "center", lineHeight: 20 },
  button: { marginTop: 12, backgroundColor: "#0F172A", borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
});
