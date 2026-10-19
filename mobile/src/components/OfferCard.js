import React from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CURRENCY } from "../config";
import StoreBadge from "./StoreBadge";

const formatPrice = (n) => (n == null ? "" : `${n.toFixed(2)} ${CURRENCY}`);

const formatDates = (from, to) => {
  if (!from && !to) return null;
  const f = (d) => (d ? d.slice(8, 10) + "." + d.slice(5, 7) : "…");
  return `${f(from)} – ${f(to)}`;
};

/**
 * One search result: image | store + name + validity | price (old struck through).
 * Tapping opens the product page in the browser when the store provided one.
 */
export default function OfferCard({ offer, isBest = false }) {
  const dates = formatDates(offer.valid_from, offer.valid_to);
  const openLink = () => offer.product_url && Linking.openURL(offer.product_url).catch(() => {});

  return (
    <Pressable
      onPress={openLink}
      disabled={!offer.product_url}
      style={({ pressed }) => [styles.card, isBest && styles.cardBest, pressed && styles.cardPressed]}
    >
      <View style={styles.imageWrap}>
        {offer.image_url ? (
          <Image source={{ uri: offer.image_url }} style={styles.image} resizeMode="contain" />
        ) : (
          <Text style={styles.imagePlaceholder}>🛒</Text>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.topRow}>
          <StoreBadge store={offer.store} />
          {isBest && (
            <View style={styles.bestPill}>
              <Text style={styles.bestText}>НАЙ-ЕВТИНО</Text>
            </View>
          )}
        </View>
        <Text style={styles.name} numberOfLines={2}>
          {offer.product_name}
        </Text>
        <View style={styles.metaRow}>
          {dates && <Text style={styles.meta}>📅 {dates}</Text>}
          {offer.is_mock && <Text style={styles.mock}>demo</Text>}
        </View>
      </View>

      <View style={styles.priceCol}>
        <Text style={styles.price}>{formatPrice(offer.discounted_price)}</Text>
        {offer.original_price != null && offer.original_price > offer.discounted_price && (
          <Text style={styles.oldPrice}>{formatPrice(offer.original_price)}</Text>
        )}
        {offer.discount_percent != null && (
          <View style={styles.discountPill}>
            <Text style={styles.discountText}>-{offer.discount_percent}%</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    gap: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    borderWidth: 1,
    borderColor: "transparent",
  },
  cardBest: { borderColor: "#22C55E" },
  cardPressed: { opacity: 0.85 },

  imageWrap: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { fontSize: 30 },

  body: { flex: 1, justifyContent: "space-between", gap: 4 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 15, fontWeight: "600", color: "#0F172A", lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { fontSize: 12, color: "#64748B" },
  mock: { fontSize: 11, color: "#B45309", backgroundColor: "#FEF3C7", paddingHorizontal: 6, borderRadius: 4 },

  bestPill: { backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  bestText: { fontSize: 10, fontWeight: "800", color: "#15803D", letterSpacing: 0.5 },

  priceCol: { alignItems: "flex-end", justifyContent: "center", minWidth: 78, gap: 2 },
  price: { fontSize: 19, fontWeight: "800", color: "#0F172A" },
  oldPrice: { fontSize: 13, color: "#94A3B8", textDecorationLine: "line-through" },
  discountPill: { backgroundColor: "#FEE2E2", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  discountText: { fontSize: 12, fontWeight: "800", color: "#B91C1C" },
});
