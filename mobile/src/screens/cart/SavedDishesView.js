/**
 * "Запазени" - restaurant dishes you hearted in Ресторанти mode (Wolt / Glovo /
 * Bolt), so you don't forget them. Tick what you ordered and log it as an
 * order; the amount goes into Разходи → Ресторанти. Orders you placed without
 * saving anything can be logged by hand too.
 */
import React, { useState } from "react";
import { Image, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { KIND_LABEL, PLATFORMS, PlatformBadge } from "../FoodScreen";
import { colors, money, radius, shadow } from "../../theme";

const PLATFORM_CHOICES = ["Wolt", "Glovo", "Bolt", "Друго"];
const open = (url) => Linking.openURL(url).catch(() => {});

export default function SavedDishesView({ items, onChange, onLogOrder }) {
  const [picked, setPicked] = useState(() => new Set());
  const [modal, setModal] = useState(false);
  const [manual, setManual] = useState(false);
  const [platform, setPlatform] = useState("Wolt");
  const [restaurant, setRestaurant] = useState("");
  const [totalText, setTotalText] = useState("");
  const [note, setNote] = useState("");

  const toggle = (id) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  };
  const remove = (id) => {
    onChange(items.filter((it) => it.id !== id));
    if (picked.has(id)) toggle(id);
  };
  const chosen = items.filter((it) => picked.has(it.id));
  const chosenTotal = chosen.reduce((s, it) => s + (it.price || 0), 0);

  const openOrder = (fromPicked) => {
    setManual(!fromPicked);
    const list = fromPicked ? chosen : [];
    setPlatform(list[0]?.platform || "Wolt");
    setRestaurant(list[0]?.restaurant_name || "");
    setTotalText(list.length ? chosenTotal.toFixed(2) : "");
    setNote("");
    setModal(true);
  };
  const confirm = () => {
    const total = parseFloat(totalText.replace(",", "."));
    if (!Number.isFinite(total) || total <= 0) return;
    const list = manual ? [] : chosen;
    onLogOrder({
      platform,
      restaurant: restaurant.trim() || (manual ? "Ресторант" : list[0]?.restaurant_name || "Ресторант"),
      note: note.trim(),
      total: Math.round(total * 100) / 100,
      items: list.map(({ name, price }) => ({ name, qty: 1, price })),
    });
    setPicked(new Set());
    setModal(false);
  };

  const byRestaurant = items.reduce((acc, it) => {
    const k = `${it.restaurant_name}|${it.platform}`;
    (acc[k] = acc[k] || { restaurant: it.restaurant_name, platform: it.platform, url: it.restaurant_url, list: [] }).list.push(it);
    return acc;
  }, {});

  return (
    <View style={{ gap: 12 }}>
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="heart-outline" size={36} color={colors.ink3} />
          <Text style={styles.emptyTitle}>Нищо запазено още</Text>
          <Text style={styles.emptySub}>В „Ресторанти“ натисни сърцето до ястие, което ти харесва - то идва тук с цената и платформата, за да го поръчаш когато решиш. Отметни поръчаното и натисни „Поръчах“, за да влезе в разходите.</Text>
        </View>
      ) : (
        Object.values(byRestaurant).map((grp) => (
          <View key={`${grp.restaurant}|${grp.platform}`} style={styles.card}>
            <Pressable onPress={() => open(grp.url)} style={styles.groupHead}>
              <Text style={styles.groupName} numberOfLines={1}>
                {grp.restaurant}
              </Text>
              <PlatformBadge platform={grp.platform} />
              <Ionicons name="open-outline" size={16} color={colors.primary} />
            </Pressable>
            {grp.list.map((it) => {
              const on = picked.has(it.id);
              return (
                <View key={it.id} style={styles.row}>
                  <Pressable onPress={() => toggle(it.id)} hitSlop={8} style={{ padding: 2 }}>
                    <Ionicons name={on ? "checkbox" : "square-outline"} size={24} color={on ? colors.success : colors.ink3} />
                  </Pressable>
                  {it.image_url ? <Image source={{ uri: it.image_url }} style={styles.thumb} /> : <View style={[styles.thumb, { alignItems: "center", justifyContent: "center" }]}><Ionicons name="fast-food-outline" size={16} color={colors.ink3} /></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={2}>
                      {it.name}
                    </Text>
                    {it.kind && it.kind !== "main" ? <Text style={styles.kind}>{KIND_LABEL[it.kind]}</Text> : null}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.price}>{money(it.price)}</Text>
                    {it.original_price != null && <Text style={styles.old}>{money(it.original_price)}</Text>}
                  </View>
                  <Pressable onPress={() => remove(it.id)} hitSlop={8} style={{ padding: 2 }}>
                    <Ionicons name="close" size={18} color={colors.ink3} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))
      )}

      {chosen.length > 0 && (
        <Pressable onPress={() => openOrder(true)} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}>
          <Ionicons name="bag-check-outline" size={18} color="#fff" />
          <Text style={styles.ctaText}>
            Поръчах избраните · {chosen.length} · {money(chosenTotal)}
          </Text>
        </Pressable>
      )}
      <Pressable onPress={() => openOrder(false)} style={styles.secondary}>
        <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
        <Text style={styles.secondaryText}>Запиши поръчка ръчно</Text>
      </Pressable>

      <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModal(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Записваме поръчката</Text>
          {!manual && (
            <Text style={styles.sheetSub}>
              {chosen.length} {chosen.length === 1 ? "ястие" : "ястия"} · {money(chosenTotal)} · добави доставката в сумата, ако искаш
            </Text>
          )}
          <Text style={styles.label}>Платформа</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
            {PLATFORM_CHOICES.map((p) => {
              const active = platform === p;
              const brand = PLATFORMS[p];
              return (
                <Pressable key={p} onPress={() => setPlatform(p)} style={[styles.chip, active && { backgroundColor: brand?.bg || colors.ink, borderColor: brand?.bg || colors.ink }]}>
                  <Text style={[styles.chipText, active && { color: brand?.fg || "#fff" }]}>{p}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={styles.label}>Ресторант</Text>
          <TextInput style={styles.input} value={restaurant} onChangeText={setRestaurant} placeholder="напр. Небесна храна" placeholderTextColor={colors.ink3} />
          <Text style={styles.label}>Платена сума (€)</Text>
          <TextInput style={styles.input} value={totalText} onChangeText={setTotalText} placeholder="0.00" placeholderTextColor={colors.ink3} keyboardType="decimal-pad" />
          <Text style={styles.label}>Бележка (по желание)</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="напр. вечеря за двама" placeholderTextColor={colors.ink3} />
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              confirm();
            }}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="save-outline" size={18} color="#fff" />
            <Text style={styles.ctaText}>Запиши в разходите</Text>
          </Pressable>
          <Text style={styles.muted}>Запазените ястия остават тук, за да ги поръчаш пак; махни ги с „×“, когато не ти трябват.</Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: 8, paddingVertical: 36, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  emptySub: { fontSize: 13, color: colors.ink2, textAlign: "center", lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 12, paddingBottom: 4, ...shadow.card },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  groupName: { flex: 1, fontSize: 14, fontWeight: "800", color: colors.ink },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  thumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  name: { fontSize: 14, fontWeight: "600", color: colors.ink, lineHeight: 19 },
  kind: { fontSize: 11, color: colors.ink3, marginTop: 2 },
  price: { fontSize: 14, fontWeight: "800", color: colors.ink },
  old: { fontSize: 11, color: colors.ink3, textDecorationLine: "line-through" },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.ink, paddingVertical: 14, borderRadius: radius.lg },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  secondaryText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.45)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 10 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.ink },
  sheetSub: { fontSize: 13, color: colors.ink2 },
  label: { fontSize: 12, fontWeight: "700", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipText: { fontWeight: "700", color: colors.ink2, fontSize: 13 },
  input: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: 12, height: 44, color: colors.ink, borderWidth: 1, borderColor: colors.border },
  muted: { fontSize: 12, color: colors.ink3, lineHeight: 17 },
});
