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
import { getDeviceToken, loadCart, saveCart } from "../storage";
import { colors } from "../theme";
import { shortQuery } from "../utils";

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
  const abortRef = useRef(null);

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

  const addToCart = async (offer) => {
    const items = await loadCart();
    const q = shortQuery(offer.product_name);
    if (!items.includes(q)) await saveCart([...items, q]);
    setSelected(null);
    toast(`„${q}“ е в количката`, "cart");
  };

  const watchOffer = async (offer) => {
    try {
      const token = await getDeviceToken();
      await createWatch(token, shortQuery(offer.product_name), offer.discounted_price, null);
      setSelected(null);
      toast("Ще следим цената", "notifications");
    } catch (e) {
      toast(e.message, "alert-circle");
    }
  };

  const isSearching = query.trim().length > 0;
  const liveStores = status?.stores?.filter((s) => s.offers > 0 && !s.is_mock).length ?? 0;

  const tagItems = [{ key: null, label: "Всички" }, ...tags.map((t) => ({ key: t.tag, label: t.label, count: t.count, color: colors.primary }))];
  const storeItems = [{ key: null, label: "Всички магазини" }, ...STORE_ORDER.map((s) => ({ key: s, label: s, color: STORES[s].bg, fg: STORES[s].fg }))];

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
        renderItem={({ item, index }) => <OfferCard offer={item} isBest={isSearching && sort === "price" && index === 0} onPress={setSelected} />}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        initialNumToRender={8}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.resultsLabel}>
              {isSearching ? `${offers.length} оферти за „${query.trim()}“` : tag ? `${offers.length} оферти` : "Най-евтините оферти тази седмица"}
            </Text>
            <Pressable onPress={() => setSort(sort === "price" ? "discount" : "price")} style={styles.sortBtn} hitSlop={8}>
              <Ionicons name="swap-vertical" size={14} color={colors.primary} />
              <Text style={styles.sortText}>{sort === "price" ? "по цена" : "по отстъпка"}</Text>
            </Pressable>
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
        title="Оферти"
        subtitle={status ? `${status.total_offers} промоции · ${liveStores}/4 магазина с реални данни` : "Lidl · Kaufland · Billa · Metro"}
        right={
          <Pressable onPress={() => navigation.navigate("Scanner")} style={styles.scanBtn} hitSlop={8}>
            <Ionicons name="barcode-outline" size={22} color={colors.headerInk} />
          </Pressable>
        }
      >
        <SearchBar value={query} onChangeText={setQuery} onSubmit={Keyboard.dismiss} />
      </ScreenHeader>

      {ready && (
        <View style={styles.filters}>
          <Chips items={tagItems} value={tag} onChange={setTag} />
          <Chips items={storeItems} value={store} onChange={setStore} style={{ paddingTop: 0 }} />
        </View>
      )}

      <View style={styles.content}>{content}</View>

      <OfferSheet offer={selected} onClose={() => setSelected(null)} onAddToCart={addToCart} onWatch={watchOffer} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  filters: { paddingTop: 10 },
  content: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, marginTop: 4 },
  resultsLabel: { fontSize: 13, color: colors.ink2, flex: 1 },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.primarySoft },
  sortText: { fontSize: 12, fontWeight: "700", color: colors.primary },
  scanBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
});
