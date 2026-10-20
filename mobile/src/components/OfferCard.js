import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, money, radius, shadow } from "../theme";
import StoreBadge from "./StoreBadge";

const fmtDate = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : null);

/** Green "real low" / amber "was cheaper" badge based on 90-day history. */
export function LowBadge({ offer, compact = false }) {
  if (offer.is_lowest_90d === true) {
    return (
      <View style={[styles.badge, { backgroundColor: colors.successSoft }]}>
        <Ionicons name="trending-down" size={12} color={colors.success} />
        <Text style={[styles.badgeText, { color: colors.success }]}>{compact ? "Най-ниска" : "Най-ниска за 90 дни"}</Text>
      </View>
    );
  }
  if (offer.is_lowest_90d === false && offer.lowest_90d != null) {
    return (
      <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
        <Ionicons name="alert-circle" size={12} color="#B45309" />
        <Text style={[styles.badgeText, { color: "#B45309" }]}>Беше {money(offer.lowest_90d)}</Text>
      </View>
    );
  }
  return null;
}

/**
 * One result row: image | store + name + validity + badges | price column.
 */
export default function OfferCard({ offer, isBest = false, onPress }) {
  const from = fmtDate(offer.valid_from);
  const to = fmtDate(offer.valid_to);
  const hasOld = offer.original_price != null && offer.original_price > offer.discounted_price;

  return (
    <Pressable onPress={() => onPress?.(offer)} style={({ pressed }) => [styles.card, isBest && styles.cardBest, pressed && styles.cardPressed]}>
      <View style={styles.imageWrap}>
        {offer.image_url ? (
          <Image source={{ uri: offer.image_url }} style={styles.image} resizeMode="contain" />
        ) : (
          <Ionicons name="cart-outline" size={28} color={colors.ink3} />
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.topRow}>
          <StoreBadge store={offer.store} size="sm" />
          {isBest && (
            <View style={[styles.badge, { backgroundColor: colors.successSoft }]}>
              <Ionicons name="trophy" size={11} color={colors.success} />
              <Text style={[styles.badgeText, { color: colors.success }]}>НАЙ-ЕВТИНО</Text>
            </View>
          )}
        </View>
        <Text style={styles.name} numberOfLines={2}>
          {offer.product_name}
        </Text>
        <View style={styles.metaRow}>
          {to ? (
            <Text style={styles.meta}>
              <Ionicons name="calendar-outline" size={11} color={colors.ink3} /> {from ? `${from} – ` : "до "}
              {to}
            </Text>
          ) : null}
          <LowBadge offer={offer} compact />
          {offer.is_mock && <Text style={styles.mock}>демо</Text>}
        </View>
      </View>

      <View style={styles.priceCol}>
        <Text style={styles.price}>{money(offer.discounted_price)}</Text>
        {hasOld && <Text style={styles.oldPrice}>{money(offer.original_price)}</Text>}
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
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 12,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: "transparent",
    ...shadow.card,
  },
  cardBest: { borderColor: colors.success },
  cardPressed: { opacity: 0.85, transform: [{ scale: 0.995 }] },

  imageWrap: { width: 76, height: 76, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: "100%", height: "100%" },

  body: { flex: 1, justifyContent: "space-between", gap: 4 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 15, fontWeight: "600", color: colors.ink, lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  meta: { fontSize: 12, color: colors.ink3 },
  mock: { fontSize: 11, color: "#B45309", backgroundColor: colors.accentSoft, paddingHorizontal: 6, borderRadius: 4 },

  badge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },

  priceCol: { alignItems: "flex-end", justifyContent: "center", minWidth: 76, gap: 2 },
  price: { fontSize: 19, fontWeight: "800", color: colors.ink },
  oldPrice: { fontSize: 13, color: colors.ink3, textDecorationLine: "line-through" },
  discountPill: { backgroundColor: colors.dangerSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  discountText: { fontSize: 12, fontWeight: "800", color: colors.danger },
});
