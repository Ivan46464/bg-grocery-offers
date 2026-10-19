import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { STORE_ORDER, STORES } from "../config";

/**
 * Horizontal row of chips: "Всички" + one per store.
 * `value` is null for all stores or a store name.
 */
export default function StoreFilter({ value, onChange }) {
  const chips = [{ key: null, label: "Всички" }, ...STORE_ORDER.map((s) => ({ key: s, label: s }))];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {chips.map(({ key, label }) => {
        const active = value === key;
        const brand = key ? STORES[key] : { bg: "#0F172A", fg: "#FFFFFF" };
        return (
          <Pressable
            key={label}
            onPress={() => onChange(key)}
            style={[styles.chip, active && { backgroundColor: brand.bg, borderColor: brand.bg }]}
          >
            <Text style={[styles.label, active && { color: brand.fg }]}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  label: { fontSize: 13, fontWeight: "600", color: "#334155" },
});
