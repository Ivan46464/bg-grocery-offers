/**
 * BG Оферти - search the weekly promotions of Lidl, Kaufland, Billa and Metro.
 *
 * Screen layout
 *   header   : title + "data from N stores" hint
 *   SearchBar: debounced; every keystroke (after 400 ms idle) hits /api/search
 *   StoreFilter chips
 *   FlatList : OfferCard rows, cheapest first; first row is highlighted as best deal
 *
 * State lives in plain hooks - no external state library needed for this size.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";

import { getStores, listOffers, searchOffers } from "./src/api";
import EmptyState from "./src/components/EmptyState";
import OfferCard from "./src/components/OfferCard";
import SearchBar from "./src/components/SearchBar";
import StoreFilter from "./src/components/StoreFilter";
import { SEARCH_DEBOUNCE_MS } from "./src/config";

export default function App() {
  const [query, setQuery] = useState("");
  const [store, setStore] = useState(null); // null = all stores
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [storeStatus, setStoreStatus] = useState([]);

  // One in-flight request at a time: abort the previous when the input changes.
  const abortRef = useRef(null);

  const load = useCallback(async (q, s) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const trimmed = q.trim();
      const data = trimmed
        ? await searchOffers(trimmed, { store: s, signal: controller.signal })
        : await listOffers({ store: s, signal: controller.signal });
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

  // Debounce typing. Also re-run when the store filter changes.
  useEffect(() => {
    const t = setTimeout(() => load(query, store), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [query, store, load]);

  // Once on mount: which stores have data, and is any of it demo data?
  useEffect(() => {
    getStores().then(setStoreStatus).catch(() => {});
  }, []);

  const liveStores = storeStatus.filter((s) => s.offers > 0 && !s.is_mock).length;
  const mockStores = storeStatus.filter((s) => s.is_mock).map((s) => s.store);
  const isSearching = query.trim().length > 0;

  const renderItem = useCallback(
    ({ item, index }) => <OfferCard offer={item} isBest={isSearching && index === 0} />,
    [isSearching]
  );

  let content;
  if (loading && offers.length === 0) {
    content = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0F172A" />
        <Text style={styles.hint}>Търсим най-добрите оферти…</Text>
      </View>
    );
  } else if (error) {
    content = (
      <EmptyState emoji="⚠️" title="Няма връзка със сървъра" subtitle={error} actionLabel="Опитай пак" onAction={() => load(query, store)} />
    );
  } else if (offers.length === 0) {
    content = isSearching ? (
      <EmptyState title={`Нищо за „${query.trim()}“`} subtitle="Опитай с друга дума - например „сирене“, „кафе“ или на английски „cheese“." />
    ) : (
      <EmptyState emoji="🛒" title="Няма оферти" subtitle="Сървърът още зарежда данните. Опитай след малко." />
    );
  } else {
    content = (
      <FlatList
        data={offers}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        ListHeaderComponent={
          <Text style={styles.resultsLabel}>
            {isSearching ? `${offers.length} оферти за „${query.trim()}“ · най-евтино първо` : "Най-евтините оферти тази седмица"}
          </Text>
        }
        refreshing={loading}
        onRefresh={() => load(query, store)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <View style={styles.header}>
        <Text style={styles.title}>BG Оферти</Text>
        <Text style={styles.subtitle}>
          Lidl · Kaufland · Billa · Metro
          {storeStatus.length > 0 && ` · ${liveStores}/${storeStatus.length} с реални данни`}
        </Text>
        <SearchBar value={query} onChangeText={setQuery} onSubmit={Keyboard.dismiss} />
      </View>

      <View style={styles.filters}>
        <StoreFilter value={store} onChange={setStore} />
      </View>

      {mockStores.length > 0 && (
        <Text style={styles.mockBanner}>Демо данни за: {mockStores.join(", ")} (скрейперът още не е настроен)</Text>
      )}

      <View style={styles.content}>{content}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F1F5F9" },
  header: {
    backgroundColor: "#0F172A",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 26,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: "#94A3B8", fontSize: 13, marginTop: 2, marginBottom: 16 },
  filters: { paddingHorizontal: 16, paddingTop: 12 },
  mockBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    fontSize: 12,
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  content: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  resultsLabel: { fontSize: 13, color: "#64748B", marginBottom: 10, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  hint: { color: "#64748B" },
});
