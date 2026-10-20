import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { colors, radius } from "../theme";

/**
 * Horizontal row of selectable chips.
 * items: [{ key, label, color?, fg?, count? }]   value: selected key (null = none)
 */
export default function Chips({ items, value, onChange, style }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, style]}>
      {items.map((it) => {
        const active = value === it.key;
        const bg = it.color || colors.ink;
        const fg = it.fg || "#FFFFFF";
        return (
          <Pressable
            key={String(it.key)}
            onPress={() => onChange(active && it.key !== null ? null : it.key)}
            style={({ pressed }) => [
              styles.chip,
              active && { backgroundColor: bg, borderColor: bg },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.label, active && { color: fg }]}>
              {it.label}
              {it.count != null ? <Text style={[styles.count, active && { color: fg, opacity: 0.8 }]}> {it.count}</Text> : null}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { fontSize: 13, fontWeight: "600", color: colors.ink2 },
  count: { fontSize: 11, color: colors.ink3, fontWeight: "600" },
});
