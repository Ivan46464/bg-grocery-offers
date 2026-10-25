import React, { useEffect, useState } from "react";
import { Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getOfferHistory, getSimilar } from "../api";
import { LEAFLETS } from "../config";
import { colors, money, radius } from "../theme";
import { LowBadge, PromoBadges } from "./OfferCard";
import Sparkline from "./Sparkline";
import StoreBadge from "./StoreBadge";

const fmtDate = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "–");
const priceOf = (o) => o.effective_price || o.discounted_price;

/**
 * Bottom-sheet with the full offer: big image, price, validity, the same
 * product in other stores, similar products, 90-day trend, and actions
 * (add to cart, watch price, open store page). Tapping a suggested offer
 * swaps the sheet to it.
 */
export default function OfferSheet({ offer: initial, onClose, onAddToCart, onWatch }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [offer, setOffer] = useState(initial);
  const [history, setHistory] = useState(null);
  const [similar, setSimilar] = useState(null);

  useEffect(() => setOffer(initial), [initial]);

  useEffect(() => {
    setHistory(null);
    setSimilar(null);
    if (!offer) return;
    let alive = true;
    getOfferHistory(offer.id).then((h) => alive && setHistory(h)).catch(() => alive && setHistory({ points: [] }));
    getSimilar(offer.id).then((s) => alive && setSimilar(s)).catch(() => alive && setSimilar({ same_elsewhere: [], similar: [] }));
    return () => {
      alive = false;
    };
  }, [offer?.id]);

  if (!offer) return null;
  const shown = offer.effective_price || offer.discounted_price;
  const hasOld = offer.original_price != null && offer.original_price > shown;
  const hasCard = offer.card_price != null;

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
            <PromoBadges offer={offer} />
          </View>
          <Text style={styles.name}>{offer.product_name}</Text>

          <View style={styles.priceRow}>
            <Text style={styles.price}>{money(shown)}</Text>
            {hasOld && <Text style={styles.old}>{money(offer.original_price)}</Text>}
            {offer.discount_percent != null && (
              <View style={styles.discount}>
                <Text style={styles.discountText}>-{offer.discount_percent}%</Text>
              </View>
            )}
          </View>
          {hasCard && (
            <View style={styles.cardBox}>
              <Ionicons name="card" size={18} color="#92400E" />
              <Text style={styles.cardText}>
                {offer.card_only
                  ? `Тази цена е само с ${offer.card_name}. Без карта няма промоция.`
                  : `${money(offer.card_price)} с ${offer.card_name} · ${money(offer.discounted_price)} без карта`}
              </Text>
            </View>
          )}
          {offer.promo_label && (
            <View style={[styles.cardBox, { backgroundColor: colors.infoSoft }]}>
              <Ionicons name="gift" size={18} color={colors.info} />
              <Text style={[styles.cardText, { color: colors.info }]}>{offer.promo_label}</Text>
            </View>
          )}

          <View style={styles.facts}>
            <Fact icon="calendar-outline" label="Валидна" value={`${fmtDate(offer.valid_from)} – ${fmtDate(offer.valid_to)}`} />
            {offer.barcode ? <Fact icon="barcode-outline" label="Баркод" value={offer.barcode} /> : null}
            {offer.tags?.length ? <Fact icon="pricetags-outline" label="Категория" value={offer.tags.join(" · ")} /> : null}
          </View>

          {/* same product elsewhere */}
          <Text style={styles.section}>Същият продукт в други магазини</Text>
          {!similar ? (
            <Text style={styles.muted}>Търсим…</Text>
          ) : similar.same_elsewhere.length === 0 ? (
            <Text style={styles.muted}>Не е на промоция другаде тази седмица.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hrow}>
              {similar.same_elsewhere.map((o) => {
                const diff = priceOf(o) - priceOf(offer);
                return (
                  <Pressable key={o.id} onPress={() => setOffer(o)} style={({ pressed }) => [styles.mini, pressed && { opacity: 0.7 }]}>
                    <View style={styles.miniThumb}>{o.image_url ? <Image source={{ uri: o.image_url }} style={styles.image} resizeMode="contain" /> : <Ionicons name="cube-outline" size={18} color={colors.ink3} />}</View>
                    <StoreBadge store={o.store} size="sm" />
                    <Text style={styles.miniPrice}>{money(priceOf(o))}</Text>
                    <Text style={[styles.miniDiff, { color: diff < 0 ? colors.success : diff > 0 ? colors.danger : colors.ink3 }]}>
                      {diff < 0 ? `${money(diff)} по-евтино` : diff > 0 ? `+${money(diff)}` : "същата цена"}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* similar products */}
          {similar?.similar?.length > 0 && (
            <>
              <Text style={styles.section}>Подобни продукти{similar.query ? ` · „${similar.query}“` : ""}</Text>
              {similar.similar.slice(0, 6).map((o) => (
                <Pressable key={o.id} onPress={() => setOffer(o)} style={({ pressed }) => [styles.simRow, pressed && { opacity: 0.7 }]}>
                  <View style={styles.simThumb}>{o.image_url ? <Image source={{ uri: o.image_url }} style={styles.image} resizeMode="contain" /> : <Ionicons name="cube-outline" size={16} color={colors.ink3} />}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.simName} numberOfLines={1}>
                      {o.product_name}
                    </Text>
                    <StoreBadge store={o.store} size="sm" />
                  </View>
                  <Text style={styles.simPrice}>{money(priceOf(o))}</Text>
                </Pressable>
              ))}
            </>
          )}

          {/* the same product in the store's next leaflet (scraped 2 days before the current one ends) */}
          {similar?.upcoming?.length > 0 && (
            <>
              <Text style={styles.section}>Следваща брошура · {offer.store}</Text>
              {similar.upcoming.map((u) => {
                const next = u.effective_price || u.discounted_price;
                const diff = next - shown;
                return (
                  <Pressable key={u.id} onPress={() => (u.product_url ? Linking.openURL(u.product_url).catch(() => {}) : null)} style={styles.nextRow}>
                    <Ionicons name="calendar-outline" size={16} color={colors.info} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nextTitle} numberOfLines={2}>
                        {u.product_name}
                      </Text>
                      <Text style={styles.nextMeta}>
                        от {u.valid_from ? u.valid_from.split("-").reverse().slice(0, 2).join(".") : "скоро"}
                        {u.valid_to ? ` до ${u.valid_to.split("-").reverse().slice(0, 2).join(".")}` : ""}
                        {u.promo_label ? ` · ${u.promo_label}` : ""}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[styles.nextPrice, diff < 0 && { color: colors.success }, diff > 0 && { color: colors.danger }]}>{money(next)}</Text>
                      <Text style={styles.nextMeta}>{diff === 0 ? "същата цена" : diff < 0 ? `-${money(-diff)} от сега` : `+${money(diff)} от сега`}</Text>
                    </View>
                  </Pressable>
                );
              })}
              <Text style={styles.muted}>Изчакай, ако в следващата брошура е по-евтино.</Text>
            </>
          )}

          <Text style={styles.section}>Цена през последните 90 дни</Text>
          {history ? <Sparkline points={history.points} width={width - 48} current={offer.discounted_price} /> : <Text style={styles.muted}>Зареждане…</Text>}
          {offer.is_lowest_90d === false && offer.lowest_90d != null && (
            <Text style={styles.warn}>Внимание: същият продукт е бил {money(offer.lowest_90d)} в този магазин през последните 90 дни - "отстъпката" не е най-добрата.</Text>
          )}

          <View style={styles.actions}>
            <Action icon="cart" label="В количката" onPress={() => onAddToCart?.(offer)} primary />
            <Action icon="notifications" label="Следи цената" onPress={() => onWatch?.(offer)} />
            {offer.product_url ? <Action icon="open-outline" label="Магазин" onPress={() => Linking.openURL(offer.product_url).catch(() => {})} /> : null}
            {LEAFLETS[offer.store] ? <Action icon="newspaper-outline" label="Брошура" onPress={() => Linking.openURL(LEAFLETS[offer.store]).catch(() => {})} /> : null}
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
  cardBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.accentSoft, borderRadius: 10, padding: 10, marginTop: 10 },
  cardText: { flex: 1, fontSize: 13, color: "#92400E", fontWeight: "600", lineHeight: 18 },
  facts: { marginTop: 14, gap: 8 },
  fact: { flexDirection: "row", alignItems: "center", gap: 8 },
  factLabel: { fontSize: 13, color: colors.ink3, width: 76 },
  factValue: { fontSize: 13, color: colors.ink, fontWeight: "600", flex: 1 },
  section: { fontSize: 13, fontWeight: "700", color: colors.ink2, marginTop: 20, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  hrow: { gap: 10, paddingVertical: 2 },
  mini: { width: 118, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 8, gap: 5, alignItems: "flex-start" },
  miniThumb: { width: "100%", height: 56, borderRadius: 8, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  miniPrice: { fontSize: 15, fontWeight: "800", color: colors.ink },
  miniDiff: { fontSize: 11, fontWeight: "700" },
  simRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  simThumb: { width: 36, height: 36, borderRadius: 8, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  simName: { fontSize: 13, color: colors.ink, marginBottom: 3 },
  simPrice: { fontWeight: "800", color: colors.ink },
  muted: { color: colors.ink3, fontSize: 13 },
  nextRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, backgroundColor: colors.infoSoft, marginBottom: 6 },
  nextTitle: { fontSize: 13, fontWeight: "600", color: colors.ink },
  nextMeta: { fontSize: 11, color: colors.ink2, marginTop: 2 },
  nextPrice: { fontSize: 16, fontWeight: "800", color: colors.ink },
  warn: { marginTop: 10, fontSize: 13, color: "#92400E", backgroundColor: colors.accentSoft, padding: 10, borderRadius: 10, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  actionPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionText: { fontWeight: "700", color: colors.ink, fontSize: 13 },
});
