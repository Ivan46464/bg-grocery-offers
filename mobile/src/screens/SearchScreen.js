/**
 * Search tab: search bar, quick-filter chips (tags), store chips, sort toggle,
 * results list. Handles the cold start of the free backend gracefully.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, createWatch, getTags, listOffers, searchOffers } from "../api";
import Chips from "../components/Chips";
import EmptyState from "../components/EmptyState";
import OfferCard from "../components/OfferCard";
import OfferSheet from "../components/OfferSheet";
import ScreenHeader from "../components/ScreenHeader";
import SearchBar from "../components/SearchBar";
import ServerWaking from "../components/ServerWaking";
import { useToast } from "../components/Toast";
import { SEARCH_DEBOUNCE_MS, STORES, STORE_ORDER } from "../config";
import useColdStart from "../hooks/useColdStart";
import HowItWorks from "../components/HowItWorks";
import { addOfferToCart, cartItemId, getDeviceToken, loadCart, loadPushToken, onCartChange } from "../storage";
import { colors, radius } from "../theme";

const POPULAR = ["сирене", "кашкавал", "кафе", "вода", "мляко", "яйца", "пиле", "бира", "шоколад", "хляб"];

export default function SearchScreen({ navigation }) {
  const { ready, status, seconds, error: coldError, retry } = useColdStart();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [tag, setTag] = useState(null);
  const [store, setStore] = useState(null);
  const [sort, setSort] = useState("price"); // price | discount
  const [tags, setTags] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [cartIds, setCartIds] = useState(new Set());
  const abortRef = useRef(null);

  // Which offers are already on the shopping list (for the green check on cards).
  useEffect(() => {
    loadCart().then((items) => setCartIds(new Set(items.map((i) => i.id))));
    return onCartChange((items) => setCartIds(new Set(items.map((i) => i.id))));
  }, []);

  const load = useCallback(async (q, s, t, srt) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const trimmed = q.trim();
      const data = trimmed
        ? await searchOffers(trimmed, { store: s, tag: t, sort: srt, signal: controller.signal })
        : await listOffers({ store: s, tag: t, sort: srt, signal: controller.signal });
      if (!controller.signal.aborted) setOffers(data);
    } catch (err) {
      if (!controller.signal.aborted) {
        setOffers([]);
        setError(err.message);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Tags once the backend is up.
  useEffect(() => {
    if (ready) getTags().then(setTags).catch(() => {});
  }, [ready]);

  // Debounced loading on every input change.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => load(query, store, tag, sort), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [ready, query, store, tag, sort, load]);

  // Both actions store the SPECIFIC product (name + barcode + picture), not a loose word.
  const asProduct = (offer) => ({ name: offer.product_name, barcode: offer.barcode || null, image_url: offer.image_url || null, exact: true });

  const addToCart = async (offer) => {
    const added = await addOfferToCart(offer);
    setSelected(null);
    toast(added ? "Добавено в списъка · виж Количка" : "Вече е в списъка", added ? "basket" : "checkmark-circle");
  };
  const inCart = (offer) => cartIds.has(cartItemId(asProduct(offer)));

  const watchOffer = async (offer) => {
    try {
      const token = (await loadPushToken()) || (await getDeviceToken());
      await createWatch(token, asProduct(offer), offer.effective_price || offer.discounted_price, null);
      setSelected(null);
      toast("Ще следим цената на този продукт", "notifications");
    } catch (e) {
      toast(e.message, "alert-circle");
    }
  };

  const isSearching = query.trim().length > 0;
  const liveStores = status?.stores?.filter((s) => s.offers > 0 && !s.is_mock).length ?? 0;

  const tagItems = [{ key: null, label: "Всички" }, ...tags.map((t) => ({ key: t.tag, label: t.label, count: t.count, color: colors.primary }))];

  let content;
  if (!ready) {
    content = coldError ? (
      <EmptyState icon="cloud-offline-outline" title="Сървърът не отговаря" subtitle={coldError} actionLabel="Опитай пак" onAction={retry} />
    ) : (
      <ServerWaking status={status} seconds={seconds} />
    );
  } else if (loading && offers.length === 0) {
    content = <EmptyState loading title="Търсим най-добрите оферти…" />;
  } else if (error) {
    content = <EmptyState icon="warning-outline" title="Грешка при зареждане" subtitle={error} actionLabel="Опитай пак" onAction={() => load(query, store, tag, sort)} />;
  } else if (offers.length === 0) {
    content = isSearching ? (
      <EmptyState title={`Нищо за „${query.trim()}“`} subtitle="Опитай с друга дума - „сирене“, „кафе“, на латиница „sirene“ или на английски „cheese“." />
    ) : (
      <EmptyState icon="cart-outline" title="Няма оферти за този филтър" subtitle="Смени категорията или магазина." />
    );
  } else {
    content = (
      <FlatList
        data={offers}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => <OfferCard offer={item} isBest={isSearching && sort === "price" && index === 0} onPress={setSelected} onAdd={addToCart} inCart={inCart(item)} />}
        extraData={cartIds}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        initialNumToRender={8}
        ListHeaderComponent={
          <View>
            {!isSearching && !tag && <HowItWorks />}
            {!isSearching && (
              <View style={styles.popular}>
                <Text style={styles.popularLabel}>Бързо търсене:</Text>
                {POPULAR.map((p) => (
                  <Pressable key={p} onPress={() => setQuery(p)} style={styles.popularChip}>
                    <Text style={styles.popularText}>{p}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={styles.resultsLabel}>
              {isSearching ? `${offers.length} оферти за „${query.trim()}“ · натисни картата за детайли` : tag ? `${offers.length} оферти` : sort === "price" ? "Най-евтините оферти тази седмица" : "Най-големите отстъпки тази седмица"}
            </Text>
          </View>
        }
        refreshing={loading}
        onRefresh={() => load(query, store, tag, sort)}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="BG Оферти"
        subtitle={status ? `${status.total_offers} промоции тази седмица · ${liveStores}/4 магазина` : "Lidl · Kaufland · Billa · Metro"}
        right={
          <Pressable onPress={() => navigation.navigate("Scanner")} style={styles.scanBtn} hitSlop={8}>
            <Ionicons name="barcode-outline" size={22} color={colors.headerInk} />
          </Pressable>
        }
      >
        <SearchBar value={query} onChangeText={setQuery} onSubmit={Keyboard.dismiss} />
      </ScreenHeader>

      {ready && (
        <View style={styles.toolbar}>
          {/* store toggles: coloured circles with the store initial */}
          <View style={styles.storeRow}>
            {STORE_ORDER.map((s) => {
              const active = store === s;
              const dim = store && !active;
              return (
                <Pressable key={s} onPress={() => setStore(active ? null : s)} style={[styles.storeChip, { backgroundColor: STORES[s].bg, opacity: dim ? 0.35 : 1 }, active && styles.storeChipActive]} hitSlop={4}>
                  <Text style={[styles.storeChipText, { color: STORES[s].fg }]}>{STORES[s].short}</Text>
                </Pressable>
              );
            })}
            <Text style={styles.storeLabel} numberOfLines={1}>
              {store ? `само ${store}` : "всички магазини"}
            </Text>
            <Pressable onPress={() => setSort(sort === "price" ? "discount" : "price")} style={styles.sortBtn} hitSlop={8}>
              <Ionicons name="swap-vertical" size={14} color={colors.primary} />
              <Text style={styles.sortText}>{sort === "price" ? "по цена" : "по отстъпка"}</Text>
            </Pressable>
          </View>
          <Chips items={tagItems} value={tag} onChange={setTag} style={{ paddingVertical: 8 }} />
        </View>
      )}

      <View style={styles.content}>{content}</View>

      <OfferSheet offer={selected} onClose={() => setSelected(null)} onAddToCart={addToCart} onWatch={watchOffer} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  toolbar: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingTop: 10 },
  storeRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16 },
  storeChip: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  storeChipActive: { borderWidth: 2.5, borderColor: colors.ink },
  storeChipText: { fontWeight: "900", fontSize: 13 },
  storeLabel: { flex: 1, fontSize: 12, color: colors.ink3, marginLeft: 4 },
  content: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 },
  resultsLabel: { fontSize: 13, color: colors.ink2, marginBottom: 10 },
  popular: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 12 },
  popularLabel: { fontSize: 12, color: colors.ink3, marginRight: 2 },
  popularChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  popularText: { fontSize: 12, color: colors.ink2, fontWeight: "600" },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  sortText: { fontSize: 12, fontWeight: "700", color: colors.primary },
  scanBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
});
