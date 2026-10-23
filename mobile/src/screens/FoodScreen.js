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
import AccountConnect, { ACCOUNTS, ACCOUNT_ORDER, HiddenRefresh } from "../components/AccountConnect";
import EmptyState from "../components/EmptyState";
import { useToast } from "../components/Toast";
import { SEARCH_DEBOUNCE_MS } from "../config";
import { clearAccountDeals, loadAllAccountDeals, loadFoodLocation, loadSavedDishes, onSavedDishesChange, saveFoodLocation, toggleSavedDish } from "../storage";
import { colors, cuisineColors, money, radius, shadow, targetColors } from "../theme";

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
  const [connect, setConnect] = useState(null); // platform whose sign-in sheet is open
  const [accounts, setAccounts] = useState({}); // { Wolt: {...}, Glovo: {...}, Bolt: {...} } captured from the user's own sessions
  const [refreshing, setRefreshing] = useState([]); // platforms being refreshed invisibly
  const refreshedRef = useRef(new Set());
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
    loadAllAccountDeals().then((a) => a && setAccounts(a));
  }, []);

  // connected platforms refresh by themselves (invisible WebView, cookies kept) when Промоции opens, at most once per app session per platform
  useEffect(() => {
    if (target !== "deals") return;
    const due = ACCOUNT_ORDER.filter((p) => accounts[p]?.authed && !refreshedRef.current.has(p));
    if (!due.length) return;
    due.forEach((p) => refreshedRef.current.add(p));
    setRefreshing((r) => [...new Set([...r, ...due])]);
  }, [target, accounts]);
  const onAccountUpdate = useCallback((p, data) => setAccounts((a) => ({ ...a, [p]: data })), []);
  const onRefreshDone = useCallback((p) => setRefreshing((r) => r.filter((x) => x !== p)), []);

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
            <Pressable key={t.key} onPress={() => onTarget?.(t.key)} style={[styles.targetBtn, active && { backgroundColor: targetColors[t.key], borderColor: targetColors[t.key] }]}>
              <Ionicons name={active ? t.icon : `${t.icon}-outline`} size={14} color={active ? "#fff" : targetColors[t.key]} />
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
          const cc = k ? cuisineColors[k] : null;
          return (
            <Pressable key={String(k)} onPress={() => setCuisine(active && k ? null : k)} style={[styles.chip, cc && { backgroundColor: cc.bg, borderColor: cc.bg }, active && (cc ? { backgroundColor: cc.ink, borderColor: cc.ink } : styles.chipActive)]}>
              <Text style={[styles.chipText, cc && { color: cc.ink }, active && { color: "#fff" }]}>
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

  // your own deals (signed-in sessions) sit on top of the public deals list
  const showAccounts = target === "deals";
  const ql = q.toLowerCase();
  const accountRows = showAccounts
    ? ACCOUNT_ORDER.filter((p) => !platform || platform === p).flatMap((p) => {
        const rec = accounts[p];
        if (!rec) return [];
        return [
          ...(rec.dishes || []).filter((d) => !ql || d.name.toLowerCase().includes(ql) || (d.restaurant || "").toLowerCase().includes(ql)).map((d) => ({ type: "accdish", p, d })),
          ...(rec.providers || []).filter((x) => !ql || x.name.toLowerCase().includes(ql)).map((x) => ({ type: "accprov", p, x })),
        ];
      })
    : [];
  const data = [
    ...(showAccounts ? [{ type: "accounts" }, { type: "analysis" }] : []),
    ...accountRows,
    ...(target === "restaurants" ? visibleRestaurants.map((g) => ({ type: "group", g })) : visibleDishes.map((d) => ({ type: "dish", d }))),
  ];

  return (
    <View style={{ flex: 1 }}>
      {toolbar}
      {body || (
        <FlatList
          data={data}
          keyExtractor={(it) => (it.type === "dish" ? `d${it.d.id}` : it.type === "group" ? `g${it.g.group_key}` : it.type === "accdish" ? `ad${it.p}${it.d.id}` : it.type === "accprov" ? `ap${it.p}${it.x.id}` : it.type)}
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
              <EmptyState icon="pricetag-outline" title="Няма публични намаления тук" subtitle="Свържи профила си от картата горе - платформите показват най-добрите си отстъпки само на влезли потребители." />
            ) : (
              <EmptyState icon="restaurant-outline" title="Нищо намерено" subtitle={location ? `Няма такива ресторанти, които доставят до ${location.label}.` : "Опитай друга дума или категория."} />
            )
          }
          renderItem={({ item }) => {
            if (item.type === "accounts")
              return (
                <AccountsCard
                  accounts={accounts}
                  refreshing={refreshing}
                  platform={platform}
                  onConnect={setConnect}
                  onRefresh={(p) => { refreshedRef.current.add(p); setRefreshing((r) => [...new Set([...r, p])]); }}
                  onClear={async (p) => { await clearAccountDeals(p); setAccounts((a) => { const n = { ...a }; delete n[p]; return n; }); }}
                />
              );
            if (item.type === "analysis") return <AnalysisCard accounts={accounts} deals={visibleDishes} nearby={nearby} location={location} platform={platform} />;
            if (item.type === "accprov") return <AccountProviderRow platform={item.p} p={item.x} />;
            if (item.type === "accdish") return <AccountDishRow platform={item.p} d={item.d} />;
            if (item.type === "dish") return <DishRow d={item.d} saved={saved} at={atPoint(nearby, item.d.platform, item.d.restaurant_external_id)} onOpen={() => open(item.d.restaurant_url)} onCompare={() => setCompare(item.d)} />;
            return <RestaurantCard g={item.g} nearby={nearby} onPress={() => setSelected(item.g.group_key)} />;
          }}
        />
      )}
      <RestaurantSheet groupKey={selected} onClose={() => setSelected(null)} platform={platform} saved={saved} nearby={nearby} />
      <CompareSheet dish={compare} onClose={() => setCompare(null)} saved={saved} />
      <LocationSheet visible={locPicker} current={location} onClose={() => setLocPicker(false)} onPick={pickLocation} />
      <AccountConnect platform={connect} visible={!!connect} location={location} onClose={() => setConnect(null)} onUpdate={onAccountUpdate} />
      {refreshing.map((p) => (
        <HiddenRefresh key={p} platform={p} location={location} onUpdate={onAccountUpdate} onDone={onRefreshDone} />
      ))}
    </View>
  );
}

const fmtWhen = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const orderUrl = (platform, p) => (ACCOUNTS[platform].order || "").replace("{id}", p.id || "").replace("{slug}", p.slug || "");

/** One card per platform: connect / refresh / clear, with what the account sees. */
function AccountsCard({ accounts, refreshing, platform, onConnect, onRefresh, onClear }) {
  return (
    <View style={[styles.card, { flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="person-circle" size={20} color={targetColors.deals} />
        <Text style={[styles.name, { flex: 1 }]}>Твоите профили</Text>
      </View>
      <Text style={styles.meta}>Платформите показват най-добрите си отстъпки (Wolt+, Glovo Prime, Bolt Plus, лични кампании) само на влезли потребители. Влез веднъж във всяка - после отстъпките се обновяват сами, без да цъкаш.</Text>
      {ACCOUNT_ORDER.filter((p) => !platform || platform === p).map((p) => {
        const rec = accounts[p];
        const n = rec ? (rec.providers || []).length + (rec.dishes || []).length : 0;
        const busy = refreshing.includes(p);
        const c = PLATFORMS[p];
        return (
          <View key={p} style={[styles.accRow, { borderColor: c.bg }]}>
            <PlatformBadge platform={p} size="lg" />
            <View style={{ flex: 1 }}>
              <Text style={styles.accTitle}>{rec?.authed ? (n ? `${n} промо за теб` : "влязъл · няма промо в момента") : "не е свързан"}</Text>
              <Text style={styles.meta}>{busy ? "обновяваме…" : rec?.capturedAt ? `обновено ${fmtWhen(rec.capturedAt)}` : "влез, за да виждаш отстъпките си"}</Text>
            </View>
            {busy ? <ActivityIndicator size="small" color={c.bg} /> : null}
            <Pressable onPress={() => (rec?.authed ? onRefresh(p) : onConnect(p))} style={[styles.accBtn, { backgroundColor: c.bg }]}>
              <Text style={[styles.accBtnText, { color: c.fg }]}>{rec?.authed ? "Обнови" : "Влез"}</Text>
            </Pressable>
            {rec ? (
              <Pressable onPress={() => onClear(p)} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="close-circle-outline" size={20} color={colors.ink3} />
              </Pressable>
            ) : null}
            {rec?.authed ? (
              <Pressable onPress={() => onConnect(p)} hitSlop={8} style={{ padding: 4 }} accessibilityLabel="Отвори профила">
                <Ionicons name="open-outline" size={18} color={colors.ink3} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Short, concrete feedback from everything we know: who has the most / biggest deals, cheapest delivery to you, where you save. */
function AnalysisCard({ accounts, deals, nearby, location, platform }) {
  const lines = [];
  const plats = ACCOUNT_ORDER.filter((p) => !platform || platform === p);
  // public deals per platform
  const pub = {};
  for (const d of deals) {
    const b = (pub[d.platform] = pub[d.platform] || { n: 0, best: null });
    b.n += 1;
    if (!b.best || (d.discount_pct || 0) > (b.best.discount_pct || 0)) b.best = d;
  }
  // account deals per platform
  const acc = {};
  for (const p of plats) {
    const rec = accounts[p];
    if (!rec?.authed) continue;
    const ds = rec.dishes || [];
    const best = ds.reduce((a, d) => (d.original && d.price && (!a || 1 - d.price / d.original > 1 - a.price / a.original) ? d : a), null);
    acc[p] = { n: (rec.providers || []).length + ds.length, best };
  }
  const all = plats.map((p) => ({ p, n: (pub[p]?.n || 0) + (acc[p]?.n || 0) })).sort((a, b) => b.n - a.n);
  if (all[0]?.n) lines.push(`Най-много промоции сега: ${all.map((x) => `${x.p} ${x.n}`).join(" · ")}.`);
  for (const p of plats) {
    const b = acc[p]?.best || pub[p]?.best;
    if (b) {
      const pct = b.discount_pct || (b.original && b.price ? Math.round((1 - b.price / b.original) * 100) : null);
      lines.push(`${p}: най-голяма отстъпка ${pct ? `-${pct}% ` : ""}„${b.name.slice(0, 32)}“${b.restaurant_name || b.restaurant ? ` в ${b.restaurant_name || b.restaurant}` : ""} за ${money(b.price)}.`);
    }
  }
  if (nearby && location) {
    const fees = {};
    for (const p of ["Wolt", "Bolt"]) {
      const vals = Object.values(nearby[p] || {}).filter((v) => v.delivers && v.fee != null).map((v) => v.fee);
      if (vals.length) fees[p] = { avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length };
    }
    const ks = Object.keys(fees);
    if (ks.length) lines.push(`Доставка до ${location.label}: ${ks.map((p) => `${p} средно ${money(fees[p].avg)} (${fees[p].n} места)`).join(" · ")}${ks.length > 1 ? ` → по-евтино с ${ks.sort((a, b) => fees[a].avg - fees[b].avg)[0]}.` : "."}`);
  }
  const missing = plats.filter((p) => !accounts[p]?.authed);
  if (missing.length) lines.push(`Свържи ${missing.join(", ")} - тогава виждаме и личните ти отстъпки там.`);
  if (!lines.length) return null;
  return (
    <View style={[styles.card, { flexDirection: "column", alignItems: "stretch", gap: 6, backgroundColor: "#FDF2F8", borderWidth: 1, borderColor: "#FBCFE8" }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="analytics" size={18} color={targetColors.deals} />
        <Text style={[styles.name, { flex: 1, color: targetColors.deals }]}>Анализ за теб</Text>
      </View>
      {lines.map((l, i) => (
        <Text key={i} style={[styles.meta, { color: colors.ink2, lineHeight: 17 }]}>
          • {l}
        </Text>
      ))}
    </View>
  );
}

function AccountProviderRow({ platform, p }) {
  const c = PLATFORMS[platform];
  return (
    <Pressable onPress={() => open(orderUrl(platform, p))} style={({ pressed }) => [styles.card, { borderLeftWidth: 4, borderLeftColor: c.bg }, pressed && { opacity: 0.85 }]}>
      <View style={styles.thumb}>{p.image_url ? <Image source={{ uri: p.image_url }} style={styles.img} /> : <Ionicons name="restaurant-outline" size={22} color={colors.ink3} />}</View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.name} numberOfLines={1}>
          {p.name}
        </Text>
        <Text style={[styles.meta, { color: colors.success, fontWeight: "700" }]} numberOfLines={2}>
          {p.label || "промоция"}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <PlatformBadge platform={platform} />
          <Text style={styles.kindTag}>от профила ти</Text>
          <Text style={styles.meta}>
            {p.minutes ? `${p.minutes} мин` : ""}
            {p.fee != null ? ` · доставка ${money(p.fee)}` : ""}
          </Text>
        </View>
      </View>
      <View style={[styles.orderBtn, { backgroundColor: c.bg }]}>
        <Text style={[styles.orderText, { color: c.fg }]}>Поръчай</Text>
      </View>
    </Pressable>
  );
}

function AccountDishRow({ platform, d }) {
  const c = PLATFORMS[platform];
  const pct = d.original && d.price ? Math.round((1 - d.price / d.original) * 100) : null;
  return (
    <Pressable onPress={() => open(orderUrl(platform, { id: d.provider_id, slug: d.slug || d.provider_id }))} style={({ pressed }) => [styles.card, { borderLeftWidth: 4, borderLeftColor: c.bg }, pressed && { opacity: 0.85 }]}>
      <View style={styles.thumb}>{d.image_url ? <Image source={{ uri: d.image_url }} style={styles.img} /> : <Ionicons name="fast-food-outline" size={22} color={colors.ink3} />}</View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.name} numberOfLines={2}>
          {d.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {d.restaurant || ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <PlatformBadge platform={platform} />
          {pct ? (
            <View style={styles.discount}>
              <Text style={styles.discountText}>-{pct}%</Text>
            </View>
          ) : null}
          {d.promo ? <Text style={[styles.kindTag, { color: colors.success }]}>{d.promo}</Text> : null}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <Text style={[styles.price, { color: colors.success }]}>{money(d.price)}</Text>
        {d.original != null && <Text style={styles.old}>{money(d.original)}</Text>}
        <View style={[styles.orderBtn, { backgroundColor: c.bg }]}>
          <Text style={[styles.orderText, { color: c.fg }]}>Поръчай</Text>
        </View>
      </View>
    </Pressable>
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
    <Pressable onPress={onCompare} style={({ pressed }) => [styles.card, { borderLeftWidth: 4, borderLeftColor: (PLATFORMS[d.platform] || { bg: colors.border }).bg }, pressed && { opacity: 0.85 }]}>
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
  const listings = detail?.group ? detail.group.listings.filter((l) => !platform || l.platform === platform) : [];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.handle} />
        {!detail ? (
          <EmptyState loading title="Зареждаме менюто…" />
        ) : detail.error ? (
          <EmptyState icon="warning-outline" title="Не успяхме да заредим менюто" />
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle} numberOfLines={2}>
                  {detail.group.name}
                </Text>
                {(detail.group.cuisines || []).length ? <Text style={styles.dishDesc}>{detail.group.cuisines.map((c) => CUISINE_LABEL[c] || c).join("  ")}</Text> : null}
              </View>
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color={colors.ink2} />
              </Pressable>
            </View>
            {/* one row per platform: rating, delivery at your point, open in the app */}
            <View style={styles.listings}>
              {listings.map((l) => {
                const at = atPoint(nearby, l.platform, l.external_id);
                const no = at && !at.delivers;
                return (
                  <Pressable key={`${l.platform}-${l.id}`} onPress={() => open(l.url)} style={[styles.listingRow, no && { opacity: 0.5 }]}>
                    <PlatformBadge platform={l.platform} size="lg" />
                    <Text style={[styles.platformMeta, { flex: 1 }]} numberOfLines={1}>
                      {l.rating ? `★ ${l.rating}` : ""}
                      {no ? " · не доставя до теб" : deliveryText(at, l.delivery_minutes, l.delivery_fee)}
                    </Text>
                    <Text style={styles.openText}>Отвори</Text>
                    <Ionicons name="open-outline" size={14} color={colors.primary} />
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.chipBlock}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
                {KINDS.filter((k) => !k.key || kindsPresent.has(k.key)).map((k) => (
                  <Pressable key={String(k.key)} onPress={() => setKind(k.key)} style={[styles.catChip, kind === k.key && styles.catChipActive]}>
                    <Text style={[styles.catText, kind === k.key && { color: "#fff" }]}>{k.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {detail.categories.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0, marginTop: 6 }}>
                  {[null, ...detail.categories].map((c) => (
                    <Pressable key={String(c)} onPress={() => setCat(c)} style={[styles.catChip, styles.catChipSoft, cat === c && styles.catChipActive]}>
                      <Text style={[styles.catText, cat === c && { color: "#fff" }]}>{c || "Всички секции"}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
            <FlatList
              style={{ flex: 1 }}
              data={dishes}
              keyExtractor={(d, i) => d.name + i}
              ListHeaderComponent={<Text style={[styles.label, { marginTop: 8, marginBottom: 4 }]}>{dishes.length} ястия{listings.length > 1 ? " · цена във всяка платформа, най-евтината в зелено" : ""}</Text>}
              ListEmptyComponent={<EmptyState icon="fast-food-outline" title="Нищо в тази категория" />}
              renderItem={({ item: d }) => (
                <View style={styles.menuRow}>
                  <Text style={styles.dishName}>{d.name}</Text>
                  {d.offers[0].description ? (
                    <Text style={styles.dishDesc} numberOfLines={2}>
                      {d.offers[0].description}
                    </Text>
                  ) : null}
                  <View style={styles.offerWrap}>
                    {d.offers.map((o) => {
                      const best = o.platform === d.cheapest_platform && d.offers.length > 1;
                      return (
                        <View key={o.id} style={[styles.offerPill, best && styles.offerPillBest]}>
                          <Pressable onPress={() => open(o.restaurant_url)} style={styles.priceLine}>
                            <PlatformBadge platform={o.platform} />
                            {o.discount_pct ? <DiscountTag d={o} /> : null}
                            <Text style={[styles.dishPrice, best && { color: colors.success }]}>{money(o.price)}</Text>
                            {o.original_price != null ? <Text style={styles.old}>{money(o.original_price)}</Text> : null}
                          </Pressable>
                          <SaveDishButton dish={o} saved={saved} size={16} />
                        </View>
                      );
                    })}
                    {d.offers.length > 1 && d.savings > 0 ? <Text style={styles.save}>спестяваш {money(d.savings)} в {d.cheapest_platform}</Text> : null}
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
  accRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: radius.md, borderWidth: 1, backgroundColor: colors.surfaceAlt },
  accTitle: { fontSize: 13, fontWeight: "700", color: colors.ink },
  accBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  accBtnText: { fontSize: 12, fontWeight: "800" },
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
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  listings: { gap: 6, marginTop: 8 },
  listingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  platformMeta: { fontSize: 12, color: colors.ink2 },
  openText: { fontSize: 12, fontWeight: "700", color: colors.primary },
  chipBlock: { marginTop: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  catChipSoft: { backgroundColor: colors.surface },
  menuRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  offerWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 4 },
  offerPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 4, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  offerPillBest: { backgroundColor: colors.successSoft, borderColor: colors.successSoft },
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
