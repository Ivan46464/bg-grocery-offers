import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { STORES } from "../config";

/**
 * Store logo. Shows the PNG from config.STORES[store].logo when provided,
 * otherwise a brand-coloured pill with the store's initial + name.
 */
export default function StoreBadge({ store, size = "md" }) {
  const brand = STORES[store] || { bg: "#334155", fg: "#FFFFFF", short: store?.[0] ?? "?", logo: null };
  const small = size === "sm";

  if (brand.logo) {
    return <Image source={brand.logo} style={small ? styles.logoSm : styles.logo} resizeMode="contain" />;
  }
  return (
    <View style={[styles.badge, small && styles.badgeSm, { backgroundColor: brand.bg }]}>
      <Text style={[styles.short, small && styles.shortSm, { color: brand.fg }]}>{brand.short}</Text>
      <Text style={[styles.name, small && styles.nameSm, { color: brand.fg }]}>{store}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, gap: 5 },
  badgeSm: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  short: { fontWeight: "900", fontSize: 13 },
  shortSm: { fontSize: 11 },
  name: { fontWeight: "700", fontSize: 12, letterSpacing: 0.3 },
  nameSm: { fontSize: 11 },
  logo: { width: 64, height: 24 },
  logoSm: { width: 44, height: 18 },
});
