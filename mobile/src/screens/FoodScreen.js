/**
 * Ресторанти mode (Varna) - Wolt / Glovo / Bolt Food in one place.
 *
 *  target  = what the search box works on:  Ресторанти · Ястия · Промоции
 *  filters = platform (Сравни всички / Wolt / Glovo / Bolt), delivery point
 *            ("Доставка до" - fees / availability depend on it) and cuisine
 *            shortcuts like the apps have (🍕 Пица, 🥙 Дюнер, 🍣 Суши ...).
 *
 * Tap a restaurant → its whole menu with the price on every platform (kinds
 * Основни / Гарнитури / Напитки / Десерти / Добавки and the menu sections as
 * chips). Tap a dish → the same dish elsewhere, cheapest first. The heart
 * saves a dish to Количка → Ресторанти. "Поръчай" deep-links into the app.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getFoodDeals, getFoodNearby, getFoodStatus, getRestaurant, listRestaurants, searchDishes } from "../api";
import EmptyState from "../components/EmptyState";
import { useToast } from "../components/Toast";
import { SEARCH_DEBOUNCE_MS } from "../config";
import { loadFoodLocation, loadSavedDishes, onSavedDishesChange, saveFoodLocation, toggleSavedDish } from "../storage";
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

/** Cuisine shortcuts - keys match backend restaurants.CUISINES; counts come from /api/food/status. */
const CUISINES = [
  ["pizza", "Пица", "🍕"], ["burger", "Бургери", "🍔"], ["doner", "Дюнер", "🥙"], ["sushi", "Суши", "🍣"],
  ["asian", "Азиатска", "🥢"], ["italian", "Италианска", "🍝"], ["grill", "Скара", "🍖"], ["chicken", "Пиле", "🍗"],
  ["healthy", "Салати", "🥗"], ["breakfast", "Закуска", "🥞"], ["dessert", "Десерти", "🍰"], ["coffee", "Кафе", "☕"],
  ["bulgarian", "Българска", "🇧🇬"], ["mexican", "Мексиканска", "🌮"], ["seafood", "Риба", "🐟"], ["sandwich", "Сандвичи", "🥪"],
  ["turkish", "Турска", "🇹🇷"], ["soup", "Супи", "🍲"],
];
const CUISINE_LABEL = Object.fromEntries(CUISINES.map(([k, l, e]) => [k, `${e} ${l}`]));

/** Varna districts as delivery points (lat, lng). */
export const DISTRICTS = [
  ["Център", 43.2047, 27.9105], ["Чайка", 43.224, 27.945], ["Левски", 43.227, 27.933], ["Младост", 43.23, 27.89],
  ["Възраждане", 43.225, 27.9], ["Владиславово", 43.233, 27.865], ["Трошево", 43.22, 27.895], ["Победа", 43.213, 27.885],
  ["Аспарухово", 43.185, 27.9], ["Галата", 43.17, 27.925], ["Виница", 43.25, 27.97], ["Бриз", 43.216, 27.955],
  ["Кайсиева градина", 43.238, 27.878], ["Изгрев", 43.24, 27.905], ["Св. Никола", 43.232, 27.955], ["Евксиноград", 43.236, 27.978],
];

const POPULAR_DISHES = ["пица маргарита", "бургер", "дюнер", "суши", "паста карбонара", "шопска салата", "пиле", "палачинки"];

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

/** Delivery info for one listing at the user's point: null = unknown (Glovo / no location), else {delivers, fee, minutes, note}. */
const atPoint = (nearby, platform, externalId) => (nearby && nearby[platform] ? nearby[platform][externalId] || { delivers: false } : null);

export default function FoodScreen({ query, target = "restaurants", onTarget }) {
  const [status, setStatus] = useState(null);
  const [platform, setPlatform] = useState(null); // null = compare all platforms
  const [cuisine, setCuisine] = useState(null);
  const [location, setLocation] = useState(null); // { label, lat, lng } | null
  const [nearby, setNearby] = useState(null); // /api/food/nearby for `location`
  const [locPicker, setLocPicker] = useState(false);
  const [restaurants, setRestaurants] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // group_key
  const [compare, setCompare] = useState(null); // dish to compare across restaurants
  const abortRef = useRef(null);
  const saved = useSavedIds();
  const q = query.trim();

  useEffect(() => {
    getFoodStatus().then(setStatus).catch(() => {});
    loadFoodLocation().then((l) => l && setLocation(l));
  }, []);

  // live delivery info for the chosen point (cached 15 min on the server)
  useEffect(() => {
    if (!location) return setNearby(null);
    let on = true;
    getFoodNearby(location.lat, location.lng)
      .then((n) => on && setNearby(n))
      .catch(() => on && setNearby(null));
    return () => {
      on = false;
    };
  }, [location]);

  const load = useCallback(async (tg, qq, pf, cu) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      if (tg === "dishes") {
        const d = qq.length >= 2 ? await searchDishes(qq, { platform: pf, cuisine: cu, limit: 80, signal: controller.signal }) : [];
        if (!controller.signal.aborted) {
          setDishes(d);
          setRestaurants([]);
        }
      } else if (tg === "deals") {
        const d = await getFoodDeals({ platform: pf, cuisine: cu, q: qq || undefined, limit: 200, signal: controller.signal });
        if (!controller.signal.aborted) {
          setDishes(d);
          setRestaurants([]);
        }
      } else {
        const r = await listRestaurants({ q: qq || undefined, platform: pf, cuisine: cu, limit: 300, signal: controller.signal });
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
    const t = setTimeout(() => load(target, q, platform, cuisine), q ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [target, q, platform, cuisine, load]);

  const retry = () => load(target, q, platform, cuisine);

  const pickLocation = (loc) => {
    setLocation(loc);
    saveFoodLocation(loc);
    setLocPicker(false);
  };

  // apply the delivery point: hide what cannot be delivered there (Glovo listings are kept - no public per-address data)
  const visibleRestaurants = useMemo(() => {
    if (!nearby) return restaurants;
    return restaurants
      .map((g) => {
        const listings = g.listings.filter((l) => {
          const a = atPoint(nearby, l.platform, l.external_id);
          return a == null || a.delivers;
        });
        return listings.length ? { ...g, listings } : null;
      })
      .filter(Boolean);
  }, [restaurants, nearby]);
  const visibleDishes = useMemo(() => {
    if (!nearby) return dishes;
    return dishes.filter((d) => {
      const a = atPoint(nearby, d.platform, d.restaurant_external_id);
      return a == null || a.delivers;
    });
  }, [dishes, nearby]);

  // ---- toolbar ------------------------------------------------------------
  const targets = [
    { key: "restaurants", label: "Ресторанти", icon: "restaurant" },
    { key: "dishes", label: "Ястия", icon: "fast-food" },
    { key: "deals", label: status?.deals ? `Промоции ${status.deals}` : "Промоции", icon: "pricetag" },
  ];
  const toolbar = (
    <View style={styles.toolbar}>
      <View style={styles.targetRow}>
        {targets.map((t) => {
          const active = target === t.key;
          return (
            <Pressable key={t.key} onPress={() => onTarget?.(t.key)} style={[styles.targetBtn, active && styles.targetBtnActive]}>
              <Ionicons name={active ? t.icon : `${t.icon}-outline`} size={14} color={active ? "#fff" : colors.ink2} />
              <Text style={[styles.targetText, active && { color: "#fff" }]} numberOfLines={1}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        {[null, ...PLATFORM_ORDER].map((p) => {
          const active = platform === p;
          const brand = p ? PLATFORMS[p] : { bg: colors.ink, fg: "#fff" };
          const count = p ? status?.platforms?.[p] : null;
          return (
            <Pressable key={String(p)} onPress={() => setPlatform(p)} style={[styles.chip, active && { backgroundColor: brand.bg, borderColor: brand.bg }]}>
              <Text style={[styles.chipText, active && { color: brand.fg }]}>{p ? `${p}${count ? ` ${count}` : ""}` : "Всички"}</Text>
            </Pressable>
          );
        })}
        <View style={styles.sep} />
        <Pressable onPress={() => setLocPicker(true)} style={[styles.chip, location && styles.chipLoc]}>
          <Ionicons name="location" size={13} color={location ? colors.primary : colors.ink2} />
          <Text style={[styles.chipText, location && { color: colors.primary }]}>{location ? location.label : "Доставка до…"}</Text>
        </Pressable>
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        {[[null, "Всички", "🍽️"], ...CUISINES.filter(([k]) => !status?.cuisines || status.cuisines[k])].map(([k, label, emoji]) => {
          const active = cuisine === k;
          return (
            <Pressable key={String(k)} onPress={() => setCuisine(active && k ? null : k)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && { color: "#fff" }]}>
                {emoji} {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  // ---- body ---------------------------------------------------------------
  const whereLine = location ? ` · доставка до ${location.label}` : "";
  const header =
    target === "dishes"
      ? q.length >= 2
        ? `${visibleDishes.length} ястия за „${q}“ · най-евтино първо${whereLine}`
        : ""
      : target === "deals"
      ? `${visibleDishes.length} ястия с намаление${platform ? ` в ${platform}` : ""}${cuisine ? ` · ${CUISINE_LABEL[cuisine]}` : ""} · най-голяма отстъпка първо${whereLine}`
      : `${visibleRestaurants.length} ресторанта${q ? ` за „${q}“` : ""}${cuisine ? ` · ${CUISINE_LABEL[cuisine]}` : ""}${whereLine}`;

  let body;
  if (error) body = <EmptyState icon="warning-outline" title="Грешка" subtitle={error} actionLabel="Опитай пак" onAction={retry} />;
  else if (status && status.dishes === 0) body = <EmptyState icon="restaurant-outline" title="Менютата още се събират" subtitle="Първото изтегляне на ресторантите отнема 20-30 минути след стартиране на сървъра." actionLabel="Опитай пак" onAction={retry} />;
  else if (target === "dishes" && q.length < 2)
    body = (
      <View style={styles.hint}>
        <Ionicons name="search-outline" size={34} color={colors.ink3} />
        <Text style={styles.hintTitle}>Какво ти се яде?</Text>
        <Text style={styles.hintSub}>Напиши ястие горе - ще го намерим във всички ресторанти на Wolt, Glovo и Bolt, най-евтиното първо.</Text>
        <View style={styles.popular}>
          {POPULAR_DISHES.map((p) => (
            <Pressable key={p} onPress={() => onTarget?.("dishes", p)} style={styles.popChip}>
              <Text style={styles.popText}>{p}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  else if (loading && restaurants.length === 0 && dishes.length === 0) body = <EmptyState loading title={q ? `Търсим „${q}“…` : "Зареждаме ресторантите във Варна…"} />;

  const data = target === "restaurants" ? visibleRestaurants.map((g) => ({ type: "group", g })) : visibleDishes.map((d) => ({ type: "dish", d }));

  return (
    <View style={{ flex: 1 }}>
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
            loading ? null : target === "deals" ? (
              <EmptyState icon="pricetag-outline" title="Няма намаления тук" subtitle={platform === "Bolt" ? "Bolt показва отстъпки само на влезли потребители (Bolt Plus / лични кампании) - без вход няма публични." : "Смени платформата или категорията."} />
            ) : (
              <EmptyState icon="restaurant-outline" title="Нищо намерено" subtitle={location ? `Няма такива ресторанти, които доставят до ${location.label}.` : "Опитай друга дума или категория."} />
            )
          }
          renderItem={({ item }) => {
            if (item.type === "dish") return <DishRow d={item.d} saved={saved} at={atPoint(nearby, item.d.platform, item.d.restaurant_external_id)} onOpen={() => open(item.d.restaurant_url)} onCompare={() => setCompare(item.d)} />;
            return <RestaurantCard g={item.g} nearby={nearby} onPress={() => setSelected(item.g.group_key)} />;
          }}
        />
      )}
      <RestaurantSheet groupKey={selected} onClose={() => setSelected(null)} platform={platform} saved={saved} nearby={nearby} />
      <CompareSheet dish={compare} onClose={() => setCompare(null)} saved={saved} />
      <LocationSheet visible={locPicker} current={location} onClose={() => setLocPicker(false)} onPick={pickLocation} />
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

const deliveryText = (at, fallbackMin, fallbackFee) => {
  const min = at?.minutes ?? fallbackMin;
  const fee = at?.fee ?? fallbackFee;
  return `${min ? ` · ${min} мин` : ""}${fee != null ? ` · доставка ${money(fee)}` : ""}`;
};

function DishRow({ d, saved, at, onOpen, onCompare }) {
  return (
    <Pressable onPress={onCompare} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={styles.thumb}>{d.image_url ? <Image source={{ uri: d.image_url }} style={styles.img} /> : <Ionicons name="fast-food-outline" size={22} color={colors.ink3} />}</View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.name} numberOfLines={2}>
          {d.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {d.restaurant_name}
          {deliveryText(at, d.delivery_minutes, d.delivery_fee)}
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

function RestaurantCard({ g, nearby, onPress }) {
  const best = g.listings.reduce((a, l) => (a == null || (l.rating || 0) > (a.rating || 0) ? l : a), null);
  const platforms = [...new Set(g.listings.map((l) => l.platform))];
  // at the chosen point: cheapest delivery among platforms that deliver there
  const quotes = g.listings.map((l) => ({ l, at: atPoint(nearby, l.platform, l.external_id) })).filter((x) => x.at?.fee != null);
  const cheapest = quotes.length ? quotes.reduce((a, b) => (b.at.fee < a.at.fee ? b : a)) : null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
      <View style={styles.thumb}>{g.image_url ? <Image source={{ uri: g.image_url }} style={styles.img} /> : <Ionicons name="restaurant-outline" size={22} color={colors.ink3} />}</View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.name} numberOfLines={1}>
          {g.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {best?.rating ? `★ ${best.rating}` : ""}
          {cheapest ? ` · ${cheapest.at.minutes ? `${cheapest.at.minutes} мин · ` : ""}доставка ${money(cheapest.at.fee)} (${cheapest.l.platform})` : best?.delivery_minutes ? ` · ${best.delivery_minutes} мин` : ""}
          {(g.cuisines || []).length ? ` · ${g.cuisines.slice(0, 3).map((c) => CUISINE_LABEL[c] || c).join(" ")}` : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {platforms.map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
          {!cheapest && g.cheapest_delivery_platform && platforms.length > 1 && <Text style={styles.cheap}>най-евтина доставка: {g.cheapest_delivery_platform}</Text>}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink3} />
    </Pressable>
  );
}

function LocationSheet({ visible, current, onClose, onPick }) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12, height: "70%" }]}>
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>Докъде да доставят?</Text>
        <Text style={styles.dishDesc}>Таксата, времето и дали изобщо доставят зависят от адреса. Проверяваме на живо в Wolt и Bolt за избрания квартал; Glovo няма публична проверка по адрес.</Text>
        <ScrollView contentContainerStyle={{ paddingTop: 10, gap: 6 }}>
          <Pressable onPress={() => onPick(null)} style={[styles.locRow, !current && styles.locRowActive]}>
            <Ionicons name="earth-outline" size={18} color={!current ? colors.primary : colors.ink2} />
            <Text style={[styles.locText, !current && { color: colors.primary }]}>Без адрес - покажи всичко</Text>
          </Pressable>
          {DISTRICTS.map(([label, lat, lng]) => {
            const active = current?.label === label;
            return (
              <Pressable key={label} onPress={() => onPick({ label, lat, lng })} style={[styles.locRow, active && styles.locRowActive]}>
                <Ionicons name="location-outline" size={18} color={active ? colors.primary : colors.ink2} />
                <Text style={[styles.locText, active && { color: colors.primary }]}>{label}</Text>
                {active ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** The same dish in other restaurants / platforms, cheapest first. */
function CompareSheet({ dish, onClose, saved }) {
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

function RestaurantSheet({ groupKey, onClose, platform, saved, nearby }) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState(null);
  const [cat, setCat] = useState(null);
  const [kind, setKind] = useState(null);
  useEffect(() => {
    setDetail(null);
    setCat(null);
    setKind(null);
    if (groupKey) getRestaurant(groupKey).then(setDetail).catch(() => setDetail({ error: true }));
  }, [groupKey]);
  if (!groupKey) return null;
  // when a single platform is selected, show only that platform's prices
  const dishes = (detail?.dishes || [])
    .map((d) => (platform ? { ...d, offers: d.offers.filter((o) => o.platform === platform) } : d))
    .filter((d) => d.offers.length && (!cat || d.offers.some((o) => o.category === cat)) && (!kind || d.offers.some((o) => (o.kind || "main") === kind)));
  const kindsPresent = new Set((detail?.dishes || []).flatMap((d) => d.offers.map((o) => o.kind || "main")));
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
            {(detail.group.cuisines || []).length ? <Text style={[styles.dishDesc, { marginBottom: 6 }]}>{detail.group.cuisines.map((c) => CUISINE_LABEL[c] || c).join("  ")}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {detail.group.listings
                .filter((l) => !platform || l.platform === platform)
                .map((l) => {
                  const at = atPoint(nearby, l.platform, l.external_id);
                  const no = at && !at.delivers;
                  return (
                    <Pressable key={`${l.platform}-${l.id}`} onPress={() => open(l.url)} style={[styles.platformBtn, no && { opacity: 0.5 }]}>
                      <PlatformBadge platform={l.platform} size="lg" />
                      <Text style={styles.platformMeta}>
                        {l.rating ? `★ ${l.rating}` : ""}
                        {no ? " · не доставя до теб" : deliveryText(at, l.delivery_minutes, l.delivery_fee)}
                      </Text>
                      <Ionicons name="open-outline" size={14} color={colors.ink2} />
                    </Pressable>
                  );
                })}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
              {KINDS.filter((k) => !k.key || kindsPresent.has(k.key)).map((k) => (
                <Pressable key={String(k.key)} onPress={() => setKind(k.key)} style={[styles.catChip, kind === k.key && styles.catChipActive]}>
                  <Text style={[styles.catText, kind === k.key && { color: "#fff" }]}>{k.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {detail.categories.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
                {[null, ...detail.categories].map((c) => (
                  <Pressable key={String(c)} onPress={() => setCat(c)} style={[styles.catChip, cat === c && styles.catChipActive]}>
                    <Text style={[styles.catText, cat === c && { color: "#fff" }]}>{c || "Всички секции"}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <FlatList
              data={dishes}
              keyExtractor={(d, i) => d.name + i}
              ListEmptyComponent={<EmptyState icon="fast-food-outline" title="Нищо в тази категория" />}
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
  toolbar: { paddingTop: 8, paddingBottom: 6, gap: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  targetRow: { flexDirection: "row", gap: 6, paddingHorizontal: 16 },
  targetBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  targetBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  targetText: { fontSize: 12, fontWeight: "800", color: colors.ink2 },
  chipRow: { gap: 6, paddingHorizontal: 16, alignItems: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipLoc: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.ink2 },
  sep: { width: 1, height: 20, backgroundColor: colors.border, marginHorizontal: 2 },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, minHeight: 18 },
  label: { flex: 1, fontSize: 13, color: colors.ink2 },
  sub: { fontSize: 12, fontWeight: "800", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 10, marginBottom: 4 },
  hint: { alignItems: "center", gap: 8, paddingVertical: 36, paddingHorizontal: 24 },
  hintTitle: { fontSize: 17, fontWeight: "800", color: colors.ink },
  hintSub: { fontSize: 13, color: colors.ink2, textAlign: "center", lineHeight: 19 },
  popular: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 8 },
  popChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  popText: { fontSize: 13, color: colors.ink, fontWeight: "600" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12, marginBottom: 10, ...shadow.card },
  thumb: { width: 60, height: 60, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  img: { width: "100%", height: "100%" },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink, lineHeight: 20 },
  meta: { fontSize: 12, color: colors.ink3 },
  cheap: { fontSize: 11, color: colors.success, fontWeight: "700" },
  price: { fontSize: 17, fontWeight: "800", color: colors.ink },
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
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.ink, marginBottom: 6 },
  platformBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  platformMeta: { fontSize: 12, color: colors.ink2 },
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  catChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  catText: { fontSize: 12, fontWeight: "700", color: colors.ink2 },
  locRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  locRowActive: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  locText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.ink },
  dishRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  cmpRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  dishName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  dishDesc: { fontSize: 12, color: colors.ink3, marginTop: 2 },
  priceLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  dishPrice: { fontSize: 15, fontWeight: "800", color: colors.ink },
  save: { fontSize: 11, color: colors.success, fontWeight: "700" },
});
