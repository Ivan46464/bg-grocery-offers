/**
 * Price-drop watchlist. Each watch is a SPECIFIC product (picked with a
 * picture; matched by barcode or strict name) plus an optional target price.
 * The backend re-checks after every scrape and pushes a notification (needs
 * FCM credentials on EAS; until then the app shows hits in-app and fires a
 * local notification when it opens and finds a new one).
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Image, Keyboard, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createWatch, deleteWatch, listWatches, registerPush } from "../api";
import EmptyState from "../components/EmptyState";
import OfferSheet from "../components/OfferSheet";
import ProductPicker from "../components/ProductPicker";
import ScreenHeader from "../components/ScreenHeader";
import StoreBadge from "../components/StoreBadge";
import { useToast } from "../components/Toast";
import { getDeviceToken, loadPushToken, savePushToken } from "../storage";
import { colors, money, radius, shadow } from "../theme";

/** Expo push token when possible, else a stable device id (in-app alerts only). */
async function resolveToken() {
  const cached = await loadPushToken();
  if (cached) return cached;
  let token = null;
  try {
    if (Device.isDevice) {
      const perm = await Notifications.getPermissionsAsync();
      const status = perm.granted ? "granted" : (await Notifications.requestPermissionsAsync()).status;
      if (status === "granted") {
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("deals", { name: "Оферти", importance: Notifications.AndroidImportance.DEFAULT });
        }
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      }
    }
  } catch {
    token = null; // no FCM credentials yet / Expo Go -> fall back to in-app alerts
  }
  if (!token) token = await getDeviceToken();
  await savePushToken(token);
  try {
    await registerPush(token);
  } catch {}
  return token;
}

const SEEN_KEY = "watch.seen.v1";
const priceOf = (o) => o.effective_price || o.discounted_price;

export default function WatchScreen() {
  const toast = useToast();
  const [token, setToken] = useState(null);
  const [watches, setWatches] = useState(null);
  const [error, setError] = useState(null);
  const [picker, setPicker] = useState(false);
  const [pending, setPending] = useState(null); // product picked, waiting for target price
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);

  const refresh = useCallback(async (tok) => {
    try {
      setError(null);
      const list = await listWatches(tok);
      setWatches(list);
      notifyNewHits(list);
    } catch (e) {
      setError(e.message);
      setWatches([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      resolveToken().then((tok) => {
        if (!alive) return;
        setToken(tok);
        refresh(tok);
      });
      return () => {
        alive = false;
      };
    }, [refresh])
  );

  /** Local notification for hits we haven't shown yet (covers the no-FCM case). */
  const notifyNewHits = async (list) => {
    try {
      const seen = JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) || "{}");
      const next = { ...seen };
      for (const w of list) {
        if (!w.hit || !w.current_best) continue;
        const stamp = `${w.current_best.id}:${priceOf(w.current_best)}`;
        if (seen[w.id] === stamp) continue;
        next[w.id] = stamp;
        if (seen[w.id] !== undefined) {
          await Notifications.scheduleNotificationAsync({
            content: { title: `${w.current_best.store}: ${w.current_best.product_name}`, body: `${money(priceOf(w.current_best))} · „${w.query}“` },
            trigger: null,
          });
        }
      }
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {}
  };

  const onPick = (p) => {
    setPicker(false);
    setPending(p);
    setTarget(p.price ? String(p.price) : "");
  };

  const save = async () => {
    if (!pending || !token) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      const price = target.trim() ? parseFloat(target.replace(",", ".")) : null;
      await createWatch(token, pending, Number.isFinite(price) ? price : null, null);
      setPending(null);
      setTarget("");
      await refresh(token);
      toast("Ще следим цената", "notifications");
    } catch (e) {
      toast(e.message, "alert-circle");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (w) => {
    setWatches((cur) => cur.filter((x) => x.id !== w.id));
    try {
      await deleteWatch(w.id, token);
    } catch {}
  };

  const pushCapable = token?.startsWith("ExponentPushToken");

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Наблюдение" color="#DB2777" subtitle="Кажи ни кой продукт чакаш да поевтинее" icon="notifications">
        <Pressable onPress={() => setPicker(true)} style={({ pressed }) => [styles.addBar, pressed && { opacity: 0.85 }]}>
          <Ionicons name="add-circle" size={22} color={colors.primary} />
          <Text style={styles.addBarText}>Следи продукт…</Text>
          <Ionicons name="images-outline" size={18} color={colors.ink3} />
        </Pressable>
      </ScreenHeader>

      {token && (
        <View style={styles.note}>
          <Ionicons name={pushCapable ? "notifications" : "information-circle-outline"} size={14} color={colors.ink2} />
          <Text style={styles.noteText}>
            {pushCapable ? "Ще получиш известие, когато се появи оферта." : "Известията се показват при отваряне на приложението (push изисква Firebase настройка)."}
          </Text>
        </View>
      )}

      {watches == null ? (
        <EmptyState loading title="Зареждане…" />
      ) : error ? (
        <EmptyState icon="warning-outline" title="Грешка" subtitle={error} actionLabel="Опитай пак" onAction={() => refresh(token)} />
      ) : watches.length === 0 ? (
        <EmptyState icon="notifications-off-outline" title="Нищо не следиш още" subtitle="Избери точен продукт отгоре или натисни „Следи цената“ в някоя оферта." actionLabel="Следи продукт" onAction={() => setPicker(true)} />
      ) : (
        <FlatList
          data={watches}
          keyExtractor={(w) => String(w.id)}
          contentContainerStyle={styles.list}
          onRefresh={() => refresh(token)}
          refreshing={false}
          renderItem={({ item: w }) => (
            <Pressable onPress={() => w.current_best && setSelected(w.current_best)} style={({ pressed }) => [styles.card, w.hit && styles.cardHit, pressed && { opacity: 0.85 }]}>
              <View style={styles.thumb}>
                {(w.image_url || w.current_best?.image_url) ? <Image source={{ uri: w.image_url || w.current_best.image_url }} style={styles.img} resizeMode="contain" /> : <Ionicons name={w.exact ? "cube-outline" : "text-outline"} size={20} color={colors.ink3} />}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.query} numberOfLines={2}>
                  {w.query}
                </Text>
                <View style={styles.rowTop}>
                  {w.target_price != null && <Text style={styles.target}>до {money(w.target_price)}</Text>}
                  {!w.exact && <Text style={styles.target}>общо търсене</Text>}
                  {w.hit && (
                    <View style={styles.hitPill}>
                      <Ionicons name="flash" size={11} color={colors.success} />
                      <Text style={styles.hitText}>ИМА ОФЕРТА</Text>
                    </View>
                  )}
                </View>
                {w.current_best ? (
                  <View style={styles.best}>
                    <StoreBadge store={w.current_best.store} size="sm" />
                    <Text style={styles.bestName} numberOfLines={1}>
                      {w.current_best.product_name}
                    </Text>
                    <Text style={styles.bestPrice}>{money(priceOf(w.current_best))}</Text>
                  </View>
                ) : (
                  <Text style={styles.muted}>Няма промоция тази седмица - проверяваме след всяко обновяване.</Text>
                )}
              </View>
              <Pressable onPress={() => remove(w)} hitSlop={10} style={styles.trash}>
                <Ionicons name="trash-outline" size={18} color={colors.ink3} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      <ProductPicker visible={picker} onClose={() => setPicker(false)} onPick={onPick} title="Следи продукт" />

      {/* target price step */}
      <Modal visible={!!pending} transparent animationType="fade" onRequestClose={() => setPending(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPending(null)} />
        <View style={styles.sheet}>
          <View style={styles.pendingRow}>
            <View style={styles.thumb}>{pending?.image_url ? <Image source={{ uri: pending.image_url }} style={styles.img} resizeMode="contain" /> : <Ionicons name="cube-outline" size={20} color={colors.ink3} />}</View>
            <Text style={styles.pendingName} numberOfLines={2}>
              {pending?.name}
            </Text>
          </View>
          <Text style={styles.label}>Извести ме при цена до (€) - по желание</Text>
          <TextInput style={styles.input} value={target} onChangeText={setTarget} placeholder={pending?.price ? String(pending.price) : "напр. 3.50"} placeholderTextColor={colors.ink3} keyboardType="decimal-pad" autoFocus />
          <Text style={styles.muted}>Без цена - известие при всяка промоция на продукта.</Text>
          <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.cta, (pressed || saving) && { opacity: 0.8 }]}>
            {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="notifications" size={18} color="#fff" />}
            <Text style={styles.ctaText}>Следи</Text>
          </Pressable>
        </View>
      </Modal>

      <OfferSheet offer={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  addBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14, height: 52, ...shadow.float },
  addBarText: { flex: 1, fontSize: 16, color: colors.ink2 },
  note: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  noteText: { fontSize: 12, color: colors.ink2, flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: "transparent", ...shadow.card },
  cardHit: { borderColor: colors.success },
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  img: { width: "100%", height: "100%" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  query: { fontSize: 14, fontWeight: "700", color: colors.ink, lineHeight: 19 },
  target: { fontSize: 11, color: colors.ink2, backgroundColor: colors.surfaceAlt, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  hitPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.successSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  hitText: { fontSize: 10, fontWeight: "800", color: colors.success },
  best: { flexDirection: "row", alignItems: "center", gap: 8 },
  bestName: { flex: 1, fontSize: 12, color: colors.ink2 },
  bestPrice: { fontWeight: "800", color: colors.ink },
  muted: { fontSize: 12, color: colors.ink3 },
  trash: { padding: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.45)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 10 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pendingName: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.ink },
  label: { fontSize: 13, fontWeight: "700", color: colors.ink2, marginTop: 6 },
  input: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: 14, height: 48, fontSize: 18, fontWeight: "700", color: colors.ink, borderWidth: 1, borderColor: colors.border },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.lg, marginTop: 6 },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
