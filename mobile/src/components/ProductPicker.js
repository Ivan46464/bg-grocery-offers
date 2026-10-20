import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { catalogSearch } from "../api";
import { SEARCH_DEBOUNCE_MS } from "../config";
import { colors, money, radius, shadow } from "../theme";
import StoreBadge from "./StoreBadge";

/**
 * Full-screen picker for a SPECIFIC product: type, see real products with
 * pictures (current offers first, then METRO's catalogue), tap one.
 * onPick({ name, barcode, image_url, exact: true, source, price, store })
 * `allowFreeText` adds a "use the word as typed" row at the bottom.
 */
export default function ProductPicker({ visible, onClose, onPick, title = "Избери продукт", allowFreeText = true }) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      setQ("");
      setItems([]);
      setError(null);
    }
  }, [visible]);

  useEffect(() => {
    abortRef.current?.abort();
    const term = q.trim();
    if (term.length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    const t = setTimeout(() => {
      catalogSearch(term, { signal: controller.signal })
        .then((res) => !controller.signal.aborted && (setItems(res), setError(null)))
        .catch((e) => !controller.signal.aborted && setError(e.message))
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q]);

  const pick = (item) => {
    Keyboard.dismiss();
    onPick({ name: item.name, barcode: item.barcode || null, image_url: item.image_url || null, exact: true, source: item.source, price: item.price, store: item.store });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
        <View style={styles.head}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
            <Ionicons name="chevron-down" size={24} color={colors.ink} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.ink3} />
          <TextInput
            style={styles.input}
            value={q}
            onChangeText={setQ}
            placeholder="напр. маджаров кашкавал, nescafe, milka"
            placeholderTextColor={colors.ink3}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
          />
          {loading && <ActivityIndicator size="small" color={colors.primary} />}
        </View>

        <FlatList
          data={items}
          keyExtractor={(it, i) => `${it.barcode || it.name}-${i}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          ListHeaderComponent={
            q.trim().length < 2 ? (
              <Text style={styles.hint}>Напиши поне 2 букви. Показваме точни продукти със снимки - първо тези на промоция, после от каталога.</Text>
            ) : error ? (
              <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text>
            ) : !loading && items.length === 0 ? (
              <Text style={styles.hint}>Няма такъв продукт в офертите и каталога.</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => pick(item)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
              <View style={styles.thumb}>
                {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.img} resizeMode="contain" /> : <Ionicons name="cube-outline" size={22} color={colors.ink3} />}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.name}
                </Text>
                <View style={styles.meta}>
                  {item.source === "offer" ? (
                    <>
                      <StoreBadge store={item.store} size="sm" />
                      <Text style={styles.promo}>на промоция · {money(item.price)}</Text>
                    </>
                  ) : (
                    <Text style={styles.catalog}>от каталога{item.price ? ` · ${money(item.price)} в Metro` : ""}</Text>
                  )}
                </View>
              </View>
              <Ionicons name="add-circle" size={26} color={colors.primary} />
            </Pressable>
          )}
          ListFooterComponent={
            allowFreeText && q.trim().length >= 2 ? (
              <Pressable onPress={() => onPick({ name: q.trim().toLowerCase(), barcode: null, image_url: null, exact: false })} style={styles.free}>
                <Ionicons name="text-outline" size={18} color={colors.ink2} />
                <Text style={styles.freeText}>
                  Използвай „{q.trim()}“ като общо търсене <Text style={{ color: colors.ink3 }}>(всякакъв {q.trim()})</Text>
                </Text>
              </Pressable>
            ) : null
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 6, marginBottom: 6 },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: colors.ink },
  search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14, height: 50, ...shadow.card },
  input: { flex: 1, fontSize: 16, color: colors.ink, height: "100%" },
  list: { padding: 16, gap: 8 },
  hint: { color: colors.ink2, fontSize: 13, textAlign: "center", paddingVertical: 20, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 10, ...shadow.card },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  img: { width: "100%", height: "100%" },
  name: { fontSize: 14, fontWeight: "600", color: colors.ink, lineHeight: 19 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8 },
  promo: { fontSize: 12, color: colors.success, fontWeight: "700" },
  catalog: { fontSize: 12, color: colors.ink3 },
  free: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, marginTop: 6, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" },
  freeText: { flex: 1, fontSize: 13, color: colors.ink2 },
});
