import React, { useEffect, useState } from "react";
import { Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getOfferHistory } from "../api";
import { colors, money, radius } from "../theme";
import { LowBadge } from "./OfferCard";
import Sparkline from "./Sparkline";
import StoreBadge from "./StoreBadge";

const fmtDate = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "–");

/**
 * Bottom-sheet with the full offer: big image, price, validity, 90-day trend,
 * and actions (add to cart, watch price, open store page).
 */
export default function OfferSheet({ offer, onClose, onAddToCart, onWatch }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [history, setHistory] = useState(null);

  useEffect(() => {
    setHistory(null);
    if (!offer) return;
    let alive = true;
    getOfferHistory(offer.id).then((h) => alive && setHistory(h)).catch(() => alive && setHistory({ points: [] }));
    return () => {
      alive = false;
    };
  }, [offer?.id]);

  if (!offer) return null;
  const hasOld = offer.original_price != null && offer.original_price > offer.discounted_price;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            {offer.image_url ? <Image source={{ uri: offer.image_url }} style={styles.image} resizeMode="contain" /> : <Ionicons name="cart-outline" size={48} color={colors.ink3} />}
          </View>

          <View style={styles.row}>
            <StoreBadge store={offer.store} />
            <LowBadge offer={offer} />
          </View>
          <Text style={styles.name}>{offer.product_name}</Text>

          <View style={styles.priceRow}>
            <Text style={styles.price}>{money(offer.discounted_price)}</Text>
            {hasOld && <Text style={styles.old}>{money(offer.original_price)}</Text>}
            {offer.discount_percent != null && (
              <View style={styles.discount}>
                <Text style={styles.discountText}>-{offer.discount_percent}%</Text>
              </View>
            )}
          </View>

          <View style={styles.facts}>
            <Fact icon="calendar-outline" label="Валидна" value={`${fmtDate(offer.valid_from)} – ${fmtDate(offer.valid_to)}`} />
            {offer.barcode ? <Fact icon="barcode-outline" label="Баркод" value={offer.barcode} /> : null}
            {offer.tags?.length ? <Fact icon="pricetags-outline" label="Категория" value={offer.tags.join(" · ")} /> : null}
          </View>

          <Text style={styles.section}>Цена през последните 90 дни</Text>
          {history ? <Sparkline points={history.points} width={width - 48} current={offer.discounted_price} /> : <Text style={styles.muted}>Зареждане…</Text>}
          {offer.is_lowest_90d === false && offer.lowest_90d != null && (
            <Text style={styles.warn}>Внимание: същият продукт е бил {money(offer.lowest_90d)} в този магазин през последните 90 дни - "отстъпката" не е най-добрата.</Text>
          )}

          <View style={styles.actions}>
            <Action icon="cart" label="В количката" onPress={() => onAddToCart?.(offer)} primary />
            <Action icon="notifications" label="Следи цената" onPress={() => onWatch?.(offer)} />
            {offer.product_url ? <Action icon="open-outline" label="Магазин" onPress={() => Linking.openURL(offer.product_url).catch(() => {})} /> : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Fact({ icon, label, value }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={16} color={colors.ink3} />
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Action({ icon, label, onPress, primary }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, primary && styles.actionPrimary, pressed && { opacity: 0.8 }]}>
      <Ionicons name={icon} size={18} color={primary ? "#fff" : colors.ink} />
      <Text style={[styles.actionText, primary && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.45)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 24, paddingTop: 8, maxHeight: "88%" },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
  hero: { height: 180, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 14 },
  image: { width: "100%", height: "100%" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  name: { fontSize: 19, fontWeight: "700", color: colors.ink, lineHeight: 25 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 8 },
  price: { fontSize: 30, fontWeight: "900", color: colors.ink, letterSpacing: -0.5 },
  old: { fontSize: 16, color: colors.ink3, textDecorationLine: "line-through" },
  discount: { backgroundColor: colors.dangerSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  discountText: { color: colors.danger, fontWeight: "800" },
  facts: { marginTop: 14, gap: 8 },
  fact: { flexDirection: "row", alignItems: "center", gap: 8 },
  factLabel: { fontSize: 13, color: colors.ink3, width: 76 },
  factValue: { fontSize: 13, color: colors.ink, fontWeight: "600", flex: 1 },
  section: { fontSize: 13, fontWeight: "700", color: colors.ink2, marginTop: 20, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  muted: { color: colors.ink3, fontSize: 13 },
  warn: { marginTop: 10, fontSize: 13, color: "#92400E", backgroundColor: colors.accentSoft, padding: 10, borderRadius: 10, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  actionPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionText: { fontWeight: "700", color: colors.ink, fontSize: 13 },
});
