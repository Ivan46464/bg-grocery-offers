/**
 * Price-drop watchlist. Each watch is a search term + optional target price.
 * The backend re-checks them after every scrape and pushes a notification
 * (needs FCM credentials on EAS; until then the app shows hits in-app and
 * fires a local notification when it opens and finds a new one).
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createWatch, deleteWatch, listWatches, registerPush } from "../api";
import EmptyState from "../components/EmptyState";
import OfferSheet from "../components/OfferSheet";
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

export default function WatchScreen() {
  const toast = useToast();
  const [token, setToken] = useState(null);
  const [watches, setWatches] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
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
        const stamp = `${w.current_best.id}:${w.current_best.effective_price || w.current_best.discounted_price}`;
        if (seen[w.id] === stamp) continue;
        next[w.id] = stamp;
        if (seen[w.id] !== undefined) {
          await Notifications.scheduleNotificationAsync({
            content: { title: `${w.current_best.store}: ${w.current_best.product_name}`, body: `${money(w.current_best.effective_price || w.current_best.discounted_price)} · „${w.query}“` },
            trigger: null,
          });
        }
      }
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {}
  };

  const add = async () => {
    const q = query.trim();
    if (!q || !token) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      const price = target.trim() ? parseFloat(target.replace(",", ".")) : null;
      await createWatch(token, q, Number.isFinite(price) ? price : null, null);
      setQuery("");
      setTarget("");
      await refresh(token);
      toast("Добавено в наблюдение", "notifications");
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
      <ScreenHeader title="Наблюдение" subtitle="Кажи ни какво чакаш да поевтинее">
        <View style={styles.form}>
          <TextInput style={[styles.input, { flex: 2 }]} value={query} onChangeText={setQuery} placeholder="продукт, напр. кафе lavazza" placeholderTextColor={colors.ink3} autoCapitalize="none" />
          <TextInput style={[styles.input, { flex: 1 }]} value={target} onChangeText={setTarget} placeholder="до € (по желание)" placeholderTextColor={colors.ink3} keyboardType="decimal-pad" />
          <Pressable onPress={add} disabled={saving || !query.trim()} style={[styles.addBtn, (!query.trim() || saving) && { opacity: 0.5 }]}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add" size={22} color="#fff" />}
          </Pressable>
        </View>
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
        <EmptyState icon="notifications-off-outline" title="Нищо не следиш още" subtitle="Добави продукт отгоре или натисни „Следи цената“ в някоя оферта." />
      ) : (
        <FlatList
          data={watches}
          keyExtractor={(w) => String(w.id)}
          contentContainerStyle={styles.list}
          onRefresh={() => refresh(token)}
          refreshing={false}
          renderItem={({ item: w }) => (
            <Pressable onPress={() => w.current_best && setSelected(w.current_best)} style={({ pressed }) => [styles.card, w.hit && styles.cardHit, pressed && { opacity: 0.85 }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.query}>{w.query}</Text>
                  {w.target_price != null && <Text style={styles.target}>до {money(w.target_price)}</Text>}
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
                    <Text style={styles.bestPrice}>{money(w.current_best.effective_price || w.current_best.discounted_price)}</Text>
                  </View>
                ) : (
                  <Text style={styles.muted}>Няма промоция тази седмица - ще проверяваме всяка седмица.</Text>
                )}
              </View>
              <Pressable onPress={() => remove(w)} hitSlop={10} style={styles.trash}>
                <Ionicons name="trash-outline" size={18} color={colors.ink3} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      <OfferSheet offer={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  form: { flexDirection: "row", gap: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 12, height: 48, color: colors.ink, fontSize: 15, ...shadow.float },
  addBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  note: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  noteText: { fontSize: 12, color: colors.ink2, flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: "transparent", ...shadow.card },
  cardHit: { borderColor: colors.success },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  query: { fontSize: 16, fontWeight: "700", color: colors.ink },
  target: { fontSize: 12, color: colors.ink2, backgroundColor: colors.surfaceAlt, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  hitPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.successSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  hitText: { fontSize: 10, fontWeight: "800", color: colors.success },
  best: { flexDirection: "row", alignItems: "center", gap: 8 },
  bestName: { flex: 1, fontSize: 13, color: colors.ink2 },
  bestPrice: { fontWeight: "800", color: colors.ink },
  muted: { fontSize: 12, color: colors.ink3 },
  trash: { padding: 6 },
});
