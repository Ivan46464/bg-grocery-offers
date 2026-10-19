import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { STORES } from "../config";

/**
 * Store logo. Shows the PNG from config.STORES[store].logo when provided,
 * otherwise a brand-coloured badge with the store's initial + name.
 */
export default function StoreBadge({ store, compact = false }) {
  const brand = STORES[store] || { bg: "#334155", fg: "#FFFFFF", short: store?.[0] ?? "?", logo: null };

  if (brand.logo) {
    return <Image source={brand.logo} style={compact ? styles.logoCompact : styles.logo} resizeMode="contain" />;
  }

  return (
    <View style={[styles.badge, compact && styles.badgeCompact, { backgroundColor: brand.bg }]}>
      <Text style={[styles.short, { color: brand.fg }]}>{brand.short}</Text>
      {!compact && <Text style={[styles.name, { color: brand.fg }]}>{store}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 6,
  },
  badgeCompact: { paddingHorizontal: 6 },
  short: { fontWeight: "900", fontSize: 13 },
  name: { fontWeight: "700", fontSize: 12, letterSpacing: 0.3 },
  logo: { width: 64, height: 24 },
  logoCompact: { width: 40, height: 18 },
});
