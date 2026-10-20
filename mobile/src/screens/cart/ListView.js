/**
 * "Списък" - the user's own shopping list: free text or picked products,
 * check off while shopping, quantity, price you actually paid. Finishing a
 * trip moves the checked items into the expense log.
 */
import React, { useState } from "react";
import { Image, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { STORES, STORE_ORDER } from "../../config";
import { colors, money, radius, shadow } from "../../theme";

const STORE_CHOICES = [...STORE_ORDER, "Друг"];

export default function ListView({ items, onChange, onFinishTrip, onFillPrices, filling, onOpenPicker }) {
  const [text, setText] = useState("");
  const [finish, setFinish] = useState(false);
  const [store, setStore] = useState(STORE_ORDER[0]);
  const [note, setNote] = useState("");

  const update = (id, patch) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id) => onChange(items.filter((it) => it.id !== id));
  const addText = () => {
    const name = text.trim();
    if (!name) return;
    const id = name.toLowerCase();
    if (!items.some((it) => it.id === id)) onChange([...items, { id, name, exact: false, qty: 1, price: null, done: false }]);
    setText("");
  };

  const done = items.filter((it) => it.done);
  const lineTotal = (it) => (it.price != null ? it.price * (it.qty || 1) : 0);
  const total = items.reduce((s, it) => s + lineTotal(it), 0);
  const doneTotal = done.reduce((s, it) => s + lineTotal(it), 0);
  const toFinish = done.length ? done : items;

  const confirmFinish = () => {
    onFinishTrip({ store, note: note.trim(), items: toFinish });
    setFinish(false);
    setNote("");
  };

  return (
    <View style={{ gap: 12 }}>
      {/* add row */}
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          onSubmitEditing={addText}
          placeholder="Напиши продукт… напр. домати"
          placeholderTextColor={colors.ink3}
          returnKeyType="done"
          blurOnSubmit={false}
          autoCapitalize="none"
        />
        <Pressable onPress={addText} style={styles.iconBtn} hitSlop={6}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
        <Pressable onPress={onOpenPicker} style={[styles.iconBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]} hitSlop={6}>
          <Ionicons name="images-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="list-outline" size={36} color={colors.ink3} />
          <Text style={styles.emptyTitle}>Твоят списък за пазаруване</Text>
          <Text style={styles.emptySub}>Напиши каквото ти трябва или избери точен продукт със снимката (иконата вдясно). В магазина отмятай и записвай цените - така следиш разходите си.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          {items.map((it, idx) => (
            <View key={it.id} style={[styles.row, idx > 0 && styles.rowBorder, it.done && { opacity: 0.55 }]}>
              <Pressable onPress={() => update(it.id, { done: !it.done })} hitSlop={8} style={styles.check}>
                <Ionicons name={it.done ? "checkbox" : "square-outline"} size={24} color={it.done ? colors.success : colors.ink3} />
              </Pressable>
              {it.image_url ? <Image source={{ uri: it.image_url }} style={styles.thumb} resizeMode="contain" /> : null}
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, it.done && { textDecorationLine: "line-through" }]} numberOfLines={2}>
                  {it.name}
                </Text>
                <View style={styles.meta}>
                  <Pressable onPress={() => update(it.id, { qty: Math.max(1, (it.qty || 1) - 1) })} hitSlop={6} style={styles.qtyBtn}>
                    <Ionicons name="remove" size={14} color={colors.ink2} />
                  </Pressable>
                  <Text style={styles.qty}>{it.qty || 1} бр.</Text>
                  <Pressable onPress={() => update(it.id, { qty: (it.qty || 1) + 1 })} hitSlop={6} style={styles.qtyBtn}>
                    <Ionicons name="add" size={14} color={colors.ink2} />
                  </Pressable>
                  <View style={styles.priceBox}>
                    <TextInput
                      style={styles.priceInput}
                      value={it.price != null ? String(it.price) : ""}
                      onChangeText={(v) => {
                        const n = parseFloat(v.replace(",", "."));
                        update(it.id, { price: v === "" ? null : Number.isFinite(n) ? n : it.price, priceText: v });
                      }}
                      placeholder="цена"
                      placeholderTextColor={colors.ink3}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.euro}>€</Text>
                  </View>
                  {it.price != null && (it.qty || 1) > 1 && <Text style={styles.line}>= {money(lineTotal(it))}</Text>}
                </View>
              </View>
              <Pressable onPress={() => remove(it.id)} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="close" size={18} color={colors.ink3} />
              </Pressable>
            </View>
          ))}

          <View style={styles.totals}>
            <Text style={styles.totalLabel}>
              {done.length}/{items.length} отметнати
            </Text>
            <Text style={styles.totalValue}>{money(done.length ? doneTotal : total)}</Text>
          </View>
        </View>
      )}

      {items.length > 0 && (
        <View style={{ gap: 8 }}>
          <Pressable onPress={onFillPrices} disabled={filling} style={({ pressed }) => [styles.secondary, (pressed || filling) && { opacity: 0.7 }]}>
            <Ionicons name="pricetags-outline" size={16} color={colors.primary} />
            <Text style={styles.secondaryText}>{filling ? "Търсим цени…" : "Попълни цените от офертите"}</Text>
          </Pressable>
          <Pressable onPress={() => setFinish(true)} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}>
            <Ionicons name="checkmark-done" size={18} color="#fff" />
            <Text style={styles.ctaText}>Приключи пазаруването{done.length ? ` (${done.length})` : ""}</Text>
          </Pressable>
          <Pressable onPress={() => onChange([])} style={styles.clear}>
            <Text style={styles.clearText}>Изчисти списъка</Text>
          </Pressable>
        </View>
      )}

      {/* finish trip */}
      <Modal visible={finish} transparent animationType="fade" onRequestClose={() => setFinish(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFinish(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Записваме покупката</Text>
          <Text style={styles.sheetSub}>
            {toFinish.length} продукта · {money(toFinish.reduce((s, it) => s + lineTotal(it), 0))}
            {toFinish.some((it) => it.price == null) ? " · някои са без цена" : ""}
          </Text>
          <Text style={styles.label}>Магазин</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {STORE_CHOICES.map((s) => {
              const active = store === s;
              const brand = STORES[s];
              return (
                <Pressable key={s} onPress={() => setStore(s)} style={[styles.storeChip, active && { backgroundColor: brand?.bg || colors.ink, borderColor: brand?.bg || colors.ink }]}>
                  <Text style={[styles.storeChipText, active && { color: brand?.fg || "#fff" }]}>{s}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={styles.label}>Бележка (по желание)</Text>
          <TextInput style={styles.noteInput} value={note} onChangeText={setNote} placeholder="напр. седмично пазаруване" placeholderTextColor={colors.ink3} />
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              confirmFinish();
            }}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="save-outline" size={18} color="#fff" />
            <Text style={styles.ctaText}>Запиши в разходите</Text>
          </Pressable>
          <Text style={styles.muted}>Отметнатите продукти се записват и излизат от списъка; неотметнатите остават за следващия път.</Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, height: 46, color: colors.ink, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  iconBtn: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 36, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  emptySub: { fontSize: 13, color: colors.ink2, textAlign: "center", lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 12, ...shadow.card },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  check: { padding: 2 },
  thumb: { width: 36, height: 36, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  name: { fontSize: 14, fontWeight: "600", color: colors.ink, lineHeight: 19 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  qtyBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  qty: { fontSize: 12, color: colors.ink2, minWidth: 36, textAlign: "center" },
  priceBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 8, height: 28, marginLeft: 4 },
  priceInput: { width: 56, fontSize: 13, color: colors.ink, padding: 0, textAlign: "right" },
  euro: { fontSize: 12, color: colors.ink3, marginLeft: 3 },
  line: { fontSize: 12, color: colors.ink2, fontWeight: "600" },
  totals: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  totalLabel: { fontSize: 12, color: colors.ink3 },
  totalValue: { fontSize: 17, fontWeight: "900", color: colors.ink },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  secondaryText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.ink, paddingVertical: 14, borderRadius: radius.lg },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  clear: { alignItems: "center", paddingVertical: 6 },
  clearText: { color: colors.ink3, fontSize: 13, textDecorationLine: "underline" },
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.45)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 10 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.ink },
  sheetSub: { fontSize: 13, color: colors.ink2 },
  label: { fontSize: 12, fontWeight: "700", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6 },
  storeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  storeChipText: { fontWeight: "700", color: colors.ink2, fontSize: 13 },
  noteInput: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: 12, height: 44, color: colors.ink, borderWidth: 1, borderColor: colors.border },
  muted: { fontSize: 12, color: colors.ink3, lineHeight: 17 },
});
