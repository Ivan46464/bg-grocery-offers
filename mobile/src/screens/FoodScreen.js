/**
 * Ресторанти mode (Varna): search dishes across Wolt / Glovo / Bolt Food and
 * see where the same thing is cheaper, browse restaurants and open one to
 * compare every dish per platform, or browse today's deals (crossed-out
 * prices). "Поръчай" deep-links into the platform; the heart saves a dish to
 * Количка → Ресторанти so you can find it again and log what you ordered.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getFoodDeals, getFoodStatus, getRestaurant, listRestaurants, searchDishes } from "../api";
import EmptyState from "../components/EmptyState";
import { useToast } from "../components/Toast";
import { SEARCH_DEBOUNCE_MS } from "../config";
import { loadSavedDishes, onSavedDishesChange, toggleSavedDish } from "../storage";
import { colors, money, radius, shadow } from "../theme";

export const PLATFORMS = {
  Wolt: { bg: "#009DE0", fg: "#FFFFFF" },
  Glovo: { bg: "#FFC244", fg: "#1B1B1B" },
  Bolt: { bg: "#34D186", fg: "#0B1220" },
};
const PLATFORM_ORDER = ["Wolt", "Glovo", "Bolt"];

/** Dish kinds the backend assigns (restaurants.dish_kind). */
export const KINDS = [
  { key: null, label: "Всичко" },
  { key: "main", label: "Основни" },
  { key: "side", label: "Гарнитури" },
  { key: "drink", label: "Напитки" },
  { key: "dessert", label: "Десерти" },
  { key: "extra", label: "Добавки" },
];
export const KIND_LABEL = Object.fromEntries(KINDS.filter((k) => k.key).map((k) => [k.key, k.label]));

export function PlatformBadge({ platform, size = "sm" }) {
  const p = PLATFORMS[platform] || { bg: colors.ink, fg: "#fff" };
  return (
    <View style={[styles.pbadge, { backgroundColor: p.bg }, size === "lg" && { paddingHorizontal: 10, paddingVertical: 5 }]}>
      <Text style={[styles.pbadgeText, { color: p.fg }, size === "lg" && { fontSize: 13 }]}>{platform}</Text>
    </View>
  );
}

const open = (url) => Linking.openURL(url).catch(() => {});

/** Heart that saves / unsaves a dish (Количка → Ресторанти → Запазени). */
export function SaveDishButton({ dish, saved, size = 20 }) {
  const toast = useToast();
  const on = saved.has(dish.id);
  return (
    <Pressable
      onPress={async () => {
        const added = await toggleSavedDish(dish);
        toast(added ? `Запазено: ${dish.name.slice(0, 36)}` : "Премахнато от запазените", added ? "heart" : "heart-dislike-outline");
      }}
      hitSlop={8}
      style={styles.heart}
      accessibilityLabel={on ? "Премахни от запазените" : "Запази"}
    >
      <Ionicons name={on ? "heart" : "heart-outline"} size={size} color={on ? colors.danger : colors.ink3} />
    </Pressable>
  );
}

function useSavedIds() {
  const [saved, setSaved] = useState(new Set());
  useEffect(() => {
    loadSavedDishes().then((l) => setSaved(new Set(l.map((x) => x.id))));
    return onSavedDishesChange((l) => setSaved(new Set(l.map((x) => x.id))));
  }, []);
  return saved;
}

export default function FoodScreen({ query }) {
  const [status, setStatus] = useState(null);
  const [platform, setPlatform] = useState(null); // null = compare all platforms
  const [view, setView] = useState("restaurants"); // restaurants | deals (when not searching)
  const [kind, setKind] = useState(null); // dish kind filter for search / deals
  const [restaurants, setRestaurants] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // group_key
  const [compare, setCompare] = useState(null); // dish to compare across restaurants
  const abortRef = useRef(null);
  const saved = useSavedIds();
  const isSearching = query.trim().length >= 2;

  useEffect(() => {
    getFoodStatus().then(setStatus).catch(() => {});
  }, []);

  const load = useCallback(async (q, pf, vw, kd) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      if (q.trim().length >= 2) {
        const [d, r] = await Promise.all([
          searchDishes(q.trim(), { platform: pf, kind: kd, signal: controller.signal }),
          listRestaurants({ q: q.trim(), platform: pf, limit: 6, signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) {
          setDishes(d);
          setRestaurants(r);
        }
      } else if (vw === "deals") {
        const d = await getFoodDeals({ platform: pf, kind: kd, limit: 150, signal: controller.signal });
        if (!controller.signal.aborted) {
          setDishes(d);
          setRestaurants([]);
        }
      } else {
        const r = await listRestaurants({ platform: pf, limit: 300, signal: controller.signal });
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
    const t = setTimeout(() => load(query, platform, view, kind), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [query, platform, view, kind, load]);

  const retry = () => load(query, platform, view, kind);

  const platformBar = (
    <View style={styles.pfBar}>
      {[null, ...PLATFORM_ORDER].map((p) => {
        const active = platform === p;
        const brand = p ? PLATFORMS[p] : { bg: colors.ink, fg: "#fff" };
        const count = p ? status?.platforms?.[p] : null;
        const disabled = p && status && !count;
        return (
          <Pressable key={String(p)} onPress={() => !disabled && setPlatform(p)} style={[styles.pfBtn, active && { backgroundColor: brand.bg, borderColor: brand.bg }, disabled && { opacity: 0.4 }]}>
            <Text style={[styles.pfBtnText, active && { color: brand.fg }]}>
              {p || "Сравни всички"}
              {count ? ` ${count}` : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const showKinds = isSearching || view === "deals";
  const toolbar = (
    <View style={styles.toolbar}>
      {!isSearching && (
        <View style={styles.viewRow}>
          {[
            { key: "restaurants", label: "Ресторанти", icon: "restaurant" },
            { key: "deals", label: `Промоции${status?.deals ? ` ${status.deals}` : ""}`, icon: "pricetag" },
          ].map((v) => {
            const active = view === v.key;
            return (
              <Pressable key={v.key} onPress={() => setView(v.key)} style={[styles.viewBtn, active && styles.viewBtnActive]}>
                <Ionicons name={active ? v.icon : `${v.icon}-outline`} size={14} color={active ? "#fff" : colors.ink2} />
                <Text style={[styles.viewBtnText, active && { color: "#fff" }]}>{v.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {showKinds && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
          {KINDS.map((k) => {
            const active = kind === k.key;
            return (
              <Pressable key={String(k.key)} onPress={() => setKind(k.key)} style={[styles.kindChip, active && styles.kindChipActive]}>
                <Text style={[styles.kindText, active && { color: "#fff" }]}>{k.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );

  const platformsLine = status ? Object.entries(status.platforms).map(([p, n]) => `${p} ${n}`).join(" · ") : "";

  let body;
  if (error) body = <EmptyState icon="warning-outline" title="Грешка" subtitle={error} actionLabel="Опитай пак" onAction={retry} />;
  else if (loading && restaurants.length === 0 && dishes.length === 0) body = <EmptyState loading title={isSearching ? `Търсим „${query.trim()}“ в Wolt, Glovo и Bolt…` : "Зареждаме ресторантите във Варна…"} />;
  else if (status && status.dishes === 0) body = <EmptyState icon="restaurant-outline" title="Менютата още се събират" subtitle="Първото изтегляне на ресторантите отнема няколко минути след стартиране на сървъра." actionLabel="Опитай пак" onAction={retry} />;

  const data = isSearching
    ? [...restaurants.map((g) => ({ type: "group", g })), ...dishes.map((d) => ({ type: "dish", d }))]
    : view === "deals"
    ? dishes.map((d) => ({ type: "dish", d }))
    : restaurants.map((g) => ({ type: "group", g }));

  const header = isSearching
    ? `${restaurants.length ? `${restaurants.length} ресторанта · ` : ""}${dishes.length} ястия за „${query.trim()}“ · най-евтино първо`
    : view === "deals"
    ? `${dishes.length} ястия с намаление${platform ? ` в ${platform}` : " в Wolt / Glovo / Bolt"} · най-голяма отстъпка първо`
    : `${restaurants.length} ресторанта във Варна${platformsLine ? ` · ${platformsLine}` : ""}`;

  return (
    <View style={{ flex: 1 }}>
      {platformBar}
      {toolbar}
      {body || (
        <FlatList
          data={data}
          keyExtractor={(it) => (it.type === "dish" ? `d${it.d.id}` : `g${it.g.group_key}`)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
          ListHeaderComponent={
            <View style={styles.labelRow}>
              <Text style={styles.label}>{header}</Text>
              {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            </View>
          }
          ListEmptyComponent={
            loading ? null : view === "deals" && !isSearching ? (
              <EmptyState icon="pricetag-outline" title="Няма намаления в момента" subtitle={platform ? `${platform} не показва зачеркнати цени днес. Виж „Сравни всички“.` : "Платформите не показват зачеркнати цени днес."} />
            ) : (
              <EmptyState icon="restaurant-outline" title="Нищо намерено" subtitle="Опитай „пица“, „бургер“, „дюнер“ или име на ресторант - „небесна“." />
            )
          }
          renderItem={({ item }) => {
            if (item.type === "dish") return <DishRow d={item.d} saved={saved} onOpen={() => open(item.d.restaurant_url)} onCompare={() => setCompare(item.d)} />;
            return <RestaurantCard g={item.g} onPress={() => setSelected(item.g.group_key)} />;
          }}
        />
      )}
      <RestaurantSheet groupKey={selected} onClose={() => setSelected(null)} platform={platform} saved={saved} />
      <CompareSheet dish={compare} onClose={() => setCompare(null)} platform={platform} saved={saved} />
    </View>
  );
}

function DiscountTag({ d }) {
  if (!d.discount_pct) return null;
  return (
    <View style={styles.discount}>
      <Text style={styles.discountText}>-{d.discount_pct}%</Text>
    </View>
  );
}

function DishRow({ d, saved, onOpen, onCompare }) {
  return (
    <Pressable onPress={onCompare} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
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
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <PlatformBadge platform={d.platform} />
          <DiscountTag d={d} />
          {d.kind && d.kind !== "main" ? <Text style={styles.kindTag}>{KIND_LABEL[d.kind]}</Text> : null}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <SaveDishButton dish={d} saved={saved} />
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[styles.price, d.discount_pct ? { color: colors.success } : null]}>{money(d.price)}</Text>
            {d.original_price != null && <Text style={styles.old}>{money(d.original_price)}</Text>}
          </View>
        </View>
        <Pressable onPress={onOpen} style={styles.orderBtn}>
          <Text style={styles.orderText}>Поръчай</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function RestaurantCard({ g, onPress }) {
  const best = g.listings.reduce((a, l) => (a == null || (l.rating || 0) > (a.rating || 0) ? l : a), null);
  const platforms = [...new Set(g.listings.map((l) => l.platform))];
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
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {platforms.map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
          {g.cheapest_delivery_platform && platforms.length > 1 && <Text style={styles.cheap}>най-евтина доставка: {g.cheapest_delivery_platform}</Text>}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink3} />
    </Pressable>
  );
}

/** The same dish in other restaurants / platforms, cheapest first. */
function CompareSheet({ dish, onClose, platform, saved }) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    setRows(null);
    if (dish) searchDishes(dish.name, { limit: 60 }).then((r) => setRows(r.filter((x) => x.id !== dish.id))).catch(() => setRows([]));
  }, [dish]);
  if (!dish) return null;
  const same = (rows || []).filter((x) => x.restaurant_group && x.restaurant_group === dish.restaurant_group);
  const others = (rows || []).filter((x) => !(x.restaurant_group && x.restaurant_group === dish.restaurant_group));
  const Section = ({ title, items }) =>
    items.length ? (
      <>
        <Text style={styles.sub}>{title}</Text>
        {items.map((x) => (
          <View key={x.id} style={styles.cmpRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dishName} numberOfLines={2}>
                {x.name}
              </Text>
              <Text style={styles.dishDesc} numberOfLines={1}>
                {x.restaurant_name}
                {x.delivery_fee != null ? ` · доставка ${money(x.delivery_fee)}` : ""}
              </Text>
            </View>
            <PlatformBadge platform={x.platform} />
            <Text style={[styles.dishPrice, x.price < dish.price && { color: colors.success }]}>{money(x.price)}</Text>
            <SaveDishButton dish={x} saved={saved} size={18} />
            <Pressable onPress={() => open(x.restaurant_url)} hitSlop={6}>
              <Ionicons name="open-outline" size={18} color={colors.primary} />
            </Pressable>
          </View>
        ))}
      </>
    ) : null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.handle} />
        <Text style={styles.sheetTitle} numberOfLines={2}>
          {dish.name}
        </Text>
        <View style={[styles.cmpRow, { borderBottomWidth: 0, paddingTop: 0 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dishDesc}>{dish.restaurant_name}</Text>
          </View>
          <PlatformBadge platform={dish.platform} />
          <Text style={styles.dishPrice}>{money(dish.price)}</Text>
          <SaveDishButton dish={dish} saved={saved} size={18} />
          <Pressable onPress={() => open(dish.restaurant_url)} style={styles.orderBtn}>
            <Text style={styles.orderText}>Поръчай</Text>
          </Pressable>
        </View>
        {rows == null ? (
          <EmptyState loading title="Търсим същото ястие другаде…" />
        ) : rows.length === 0 ? (
          <EmptyState icon="git-compare-outline" title="Няма същото ястие другаде" subtitle="Не намерихме това ястие в друг ресторант или платформа." />
        ) : (
          <ScrollView>
            <Section title="Същият ресторант в другите платформи" items={same} />
            <Section title="Подобно в други ресторанти · най-евтино първо" items={others} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function RestaurantSheet({ groupKey, onClose, platform, saved }) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState(null);
  const [cat, setCat] = useState(null);
  useEffect(() => {
    setDetail(null);
    setCat(null);
    if (groupKey) getRestaurant(groupKey).then(setDetail).catch(() => setDetail({ error: true }));
  }, [groupKey]);
  if (!groupKey) return null;
  // when a single platform is selected, show only that platform's prices
  const dishes = (detail?.dishes || [])
    .map((d) => (platform ? { ...d, offers: d.offers.filter((o) => o.platform === platform) } : d))
    .filter((d) => d.offers.length && (!cat || d.offers.some((o) => o.category === cat)));
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
              {detail.group.listings
                .filter((l) => !platform || l.platform === platform)
                .map((l) => (
                  <Pressable key={`${l.platform}-${l.id}`} onPress={() => open(l.url)} style={styles.platformBtn}>
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
                      <View key={o.id} style={styles.priceLine}>
                        <SaveDishButton dish={o} saved={saved} size={16} />
                        <Pressable onPress={() => open(o.restaurant_url)} style={styles.priceLine}>
                          <PlatformBadge platform={o.platform} />
                          {o.discount_pct ? <DiscountTag d={o} /> : null}
                          <Text style={[styles.dishPrice, o.platform === d.cheapest_platform && d.offers.length > 1 && { color: colors.success }]}>{money(o.price)}</Text>
                        </Pressable>
                      </View>
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
  pfBar: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: colors.surface },
  pfBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: "center" },
  pfBtnText: { fontSize: 12, fontWeight: "800", color: colors.ink2 },
  toolbar: { paddingHorizontal: 16, paddingBottom: 8, gap: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  viewRow: { flexDirection: "row", gap: 6 },
  viewBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  viewBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  viewBtnText: { fontSize: 12, fontWeight: "800", color: colors.ink2 },
  kindChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  kindChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  kindText: { fontSize: 12, fontWeight: "700", color: colors.ink2 },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  label: { flex: 1, fontSize: 13, color: colors.ink2 },
  sub: { fontSize: 12, fontWeight: "800", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 10, marginBottom: 4 },
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
  heart: { padding: 2 },
  discount: { backgroundColor: colors.successSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  discountText: { fontSize: 10, fontWeight: "900", color: colors.success },
  kindTag: { fontSize: 10, fontWeight: "700", color: colors.ink3, backgroundColor: colors.surfaceAlt, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
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
  cmpRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  dishName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  dishDesc: { fontSize: 12, color: colors.ink3, marginTop: 2 },
  priceLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  dishPrice: { fontSize: 15, fontWeight: "800", color: colors.ink },
  save: { fontSize: 11, color: colors.success, fontWeight: "700" },
});
