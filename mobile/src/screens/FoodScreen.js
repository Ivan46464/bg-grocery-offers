/**
 * Ресторанти mode (Varna): search dishes across Wolt / Glovo / Bolt Food and
 * see where the same thing is cheaper, or browse restaurants and open one to
 * compare every dish per platform. "Поръчай" deep-links into the platform.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getFoodStatus, getRestaurant, listRestaurants, searchDishes } from "../api";
import EmptyState from "../components/EmptyState";
import { SEARCH_DEBOUNCE_MS } from "../config";
import { colors, money, radius, shadow } from "../theme";

export const PLATFORMS = {
  Wolt: { bg: "#009DE0", fg: "#FFFFFF" },
  Glovo: { bg: "#FFC244", fg: "#1B1B1B" },
  Bolt: { bg: "#34D186", fg: "#0B1220" },
};

export function PlatformBadge({ platform, size = "sm" }) {
  const p = PLATFORMS[platform] || { bg: colors.ink, fg: "#fff" };
  return (
    <View style={[styles.pbadge, { backgroundColor: p.bg }, size === "lg" && { paddingHorizontal: 10, paddingVertical: 5 }]}>
      <Text style={[styles.pbadgeText, { color: p.fg }, size === "lg" && { fontSize: 13 }]}>{platform}</Text>
    </View>
  );
}

const open = (url) => Linking.openURL(url).catch(() => {});

export default function FoodScreen({ query }) {
  const [status, setStatus] = useState(null);
  const [restaurants, setRestaurants] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // group_key
  const abortRef = useRef(null);
  const isSearching = query.trim().length >= 2;

  useEffect(() => {
    getFoodStatus().then(setStatus).catch(() => {});
  }, []);

  const load = useCallback(async (q) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      if (q.trim().length >= 2) {
        const [d, r] = await Promise.all([searchDishes(q.trim(), { signal: controller.signal }), listRestaurants({ q: q.trim(), limit: 8, signal: controller.signal })]);
        if (!controller.signal.aborted) {
          setDishes(d);
          setRestaurants(r);
        }
      } else {
        const r = await listRestaurants({ limit: 100, signal: controller.signal });
        if (!controller.signal.aborted) {
          setRestaurants(r);
          setDishes([]);
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(query), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  const platformsLine = status ? Object.entries(status.platforms).map(([p, n]) => `${p} ${n}`).join(" · ") : "";

  if (error) return <EmptyState icon="warning-outline" title="Грешка" subtitle={error} actionLabel="Опитай пак" onAction={() => load(query)} />;
  if (loading && restaurants.length === 0 && dishes.length === 0) return <EmptyState loading title="Зареждаме ресторантите във Варна…" />;
  if (status && status.dishes === 0) return <EmptyState icon="restaurant-outline" title="Менютата още се събират" subtitle="Първото изтегляне на ресторантите от Wolt отнема няколко минути след стартиране на сървъра." actionLabel="Опитай пак" onAction={() => load(query)} />;

  const data = isSearching ? [{ type: "restaurants" }, ...dishes.map((d) => ({ type: "dish", d }))] : restaurants.map((g) => ({ type: "group", g }));

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={data}
        keyExtractor={(it, i) => (it.type === "dish" ? `d${it.d.id}` : it.type === "group" ? `g${it.g.group_key}` : `r${i}`)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        ListHeaderComponent={
          <Text style={styles.label}>
            {isSearching ? `${dishes.length} ястия за „${query.trim()}“ · най-евтино първо` : `Ресторанти във Варна${platformsLine ? ` · ${platformsLine}` : ""}`}
          </Text>
        }
        ListEmptyComponent={<EmptyState icon="restaurant-outline" title="Нищо намерено" subtitle="Опитай „пица“, „бургер“, „дюнер“ или име на ресторант." />}
        renderItem={({ item }) => {
          if (item.type === "restaurants") {
            if (!restaurants.length) return null;
            return (
              <View style={{ marginBottom: 12 }}>
                <Text style={styles.sub}>Ресторанти</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {restaurants.map((g) => (
                    <Pressable key={g.group_key} onPress={() => setSelected(g.group_key)} style={styles.chip}>
                      <Text style={styles.chipText} numberOfLines={1}>
                        {g.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            );
          }
          if (item.type === "dish") return <DishRow d={item.d} onOpen={() => open(item.d.restaurant_url)} />;
          return <RestaurantCard g={item.g} onPress={() => setSelected(item.g.group_key)} />;
        }}
      />
      <RestaurantSheet groupKey={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

function DishRow({ d, onOpen }) {
  return (
    <View style={styles.card}>
      <View style={styles.thumb}>{d.image_url ? <Image source={{ uri: d.image_url }} style={styles.img} /> : <Ionicons name="fast-food-outline" size={22} color={colors.ink3} />}</View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.name} numberOfLines={2}>
          {d.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {d.restaurant_name}
          {d.delivery_minutes ? ` · ${d.delivery_minutes} мин` : ""}
          {d.delivery_fee != null ? ` · доставка ${money(d.delivery_fee)}` : ""}
        </Text>
        <PlatformBadge platform={d.platform} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <Text style={styles.price}>{money(d.price)}</Text>
        {d.original_price != null && <Text style={styles.old}>{money(d.original_price)}</Text>}
        <Pressable onPress={onOpen} style={styles.orderBtn}>
          <Text style={styles.orderText}>Поръчай</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RestaurantCard({ g, onPress }) {
  const best = g.listings.reduce((a, l) => (a == null || (l.rating || 0) > (a.rating || 0) ? l : a), null);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
      <View style={styles.thumb}>{g.image_url ? <Image source={{ uri: g.image_url }} style={styles.img} /> : <Ionicons name="restaurant-outline" size={22} color={colors.ink3} />}</View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.name} numberOfLines={1}>
          {g.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {best?.rating ? `★ ${best.rating}` : ""}
          {best?.delivery_minutes ? ` · ${best.delivery_minutes} мин` : ""}
          {g.tags.length ? ` · ${g.tags.slice(0, 3).join(", ")}` : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {g.listings.map((l) => (
            <PlatformBadge key={l.platform} platform={l.platform} />
          ))}
          {g.cheapest_delivery_platform && g.listings.length > 1 && <Text style={styles.cheap}>най-евтина доставка: {g.cheapest_delivery_platform}</Text>}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink3} />
    </Pressable>
  );
}

function RestaurantSheet({ groupKey, onClose }) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState(null);
  const [cat, setCat] = useState(null);
  useEffect(() => {
    setDetail(null);
    setCat(null);
    if (groupKey) getRestaurant(groupKey).then(setDetail).catch(() => setDetail({ error: true }));
  }, [groupKey]);
  if (!groupKey) return null;
  const dishes = detail?.dishes?.filter((d) => !cat || d.offers.some((o) => o.category === cat)) || [];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.handle} />
        {!detail ? (
          <EmptyState loading title="Зареждаме менюто…" />
        ) : detail.error ? (
          <EmptyState icon="warning-outline" title="Не успяхме да заредим менюто" />
        ) : (
          <>
            <Text style={styles.sheetTitle}>{detail.group.name}</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {detail.group.listings.map((l) => (
                <Pressable key={l.platform} onPress={() => open(l.url)} style={styles.platformBtn}>
                  <PlatformBadge platform={l.platform} size="lg" />
                  <Text style={styles.platformMeta}>
                    {l.rating ? `★ ${l.rating}` : ""}
                    {l.delivery_minutes ? ` · ${l.delivery_minutes} мин` : ""}
                    {l.delivery_fee != null ? ` · ${money(l.delivery_fee)} доставка` : ""}
                  </Text>
                  <Ionicons name="open-outline" size={14} color={colors.ink2} />
                </Pressable>
              ))}
            </View>
            {detail.categories.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
                {[null, ...detail.categories].map((c) => (
                  <Pressable key={String(c)} onPress={() => setCat(c)} style={[styles.catChip, cat === c && styles.catChipActive]}>
                    <Text style={[styles.catText, cat === c && { color: "#fff" }]}>{c || "Всички"}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <FlatList
              data={dishes}
              keyExtractor={(d, i) => d.name + i}
              renderItem={({ item: d }) => (
                <View style={styles.dishRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dishName}>{d.name}</Text>
                    {d.offers[0].description ? (
                      <Text style={styles.dishDesc} numberOfLines={2}>
                        {d.offers[0].description}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    {d.offers.map((o) => (
                      <Pressable key={o.id} onPress={() => open(o.restaurant_url)} style={styles.priceLine}>
                        <PlatformBadge platform={o.platform} />
                        <Text style={[styles.dishPrice, o.platform === d.cheapest_platform && d.offers.length > 1 && { color: colors.success }]}>{money(o.price)}</Text>
                      </Pressable>
                    ))}
                    {d.offers.length > 1 && d.savings > 0 && <Text style={styles.save}>-{money(d.savings)} в {d.cheapest_platform}</Text>}
                  </View>
                </View>
              )}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 },
  label: { fontSize: 13, color: colors.ink2, marginBottom: 10 },
  sub: { fontSize: 12, fontWeight: "800", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, maxWidth: 200 },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.ink },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12, marginBottom: 10, ...shadow.card },
  thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  img: { width: "100%", height: "100%" },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink, lineHeight: 20 },
  meta: { fontSize: 12, color: colors.ink3 },
  cheap: { fontSize: 11, color: colors.success, fontWeight: "700" },
  price: { fontSize: 18, fontWeight: "800", color: colors.ink },
  old: { fontSize: 12, color: colors.ink3, textDecorationLine: "line-through" },
  orderBtn: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  orderText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  pbadge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  pbadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.45)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 8, height: "88%" },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.ink, marginBottom: 8 },
  platformBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  platformMeta: { fontSize: 12, color: colors.ink2 },
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  catChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  catText: { fontSize: 12, fontWeight: "700", color: colors.ink2 },
  dishRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  dishName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  dishDesc: { fontSize: 12, color: colors.ink3, marginTop: 2 },
  priceLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  dishPrice: { fontSize: 15, fontWeight: "800", color: colors.ink },
  save: { fontSize: 11, color: colors.success, fontWeight: "700" },
});
