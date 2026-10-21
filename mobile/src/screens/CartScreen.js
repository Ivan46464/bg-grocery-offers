/**
 * Количка tab = one shopping list used three ways:
 *   Списък     - write / pick products, tick them off in the store, note prices
 *   Най-евтино - where to buy the list cheapest this week (single store vs split)
 *   Разходи    - what you actually spent, per month and per store
 */
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ackListInbox, getListInbox, optimizeCart } from "../api";
import OfferSheet from "../components/OfferSheet";
import ProductPicker from "../components/ProductPicker";
import ScreenHeader from "../components/ScreenHeader";
import Segmented from "../components/Segmented";
import { useToast } from "../components/Toast";
import { cartItemId, loadCart, loadTrips, newId, saveCart, saveTrips } from "../storage";
import { colors } from "../theme";
import ExpensesView from "./cart/ExpensesView";
import ListView from "./cart/ListView";
import OptimizeView from "./cart/OptimizeView";

const TABS = [
  { key: "list", label: "Списък", icon: "list" },
  { key: "best", label: "Най-евтино", icon: "sparkles" },
  { key: "spend", label: "Разходи", icon: "wallet" },
];

export default function CartScreen() {
  const toast = useToast();
  const [tab, setTab] = useState("list");
  const [items, setItems] = useState([]);
  const [trips, setTrips] = useState([]);
  const [picker, setPicker] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadTrips().then(setTrips);
      (async () => {
        const current = await loadCart();
        if (cancelled) return;
        setItems(current);
        // Items written in the LoveChat chat ("купи домати") wait in the server inbox - pull them in.
        try {
          const inbox = await getListInbox();
          if (cancelled || !inbox.length) return;
          const known = new Set(current.map((it) => it.id));
          const fresh = inbox.filter((row) => !known.has(row.item_name.toLowerCase().trim()));
          const next = [
            ...current,
            ...fresh.map((row) => ({ id: row.item_name.toLowerCase().trim(), name: row.item_name, exact: false, qty: 1, price: null, done: false, source: "chat" })),
          ];
          if (fresh.length) {
            setItems(next);
            await saveCart(next);
            toast(fresh.length === 1 ? `От чата: ${fresh[0].item_name}` : `От чата: ${fresh.length} продукта`, "chatbubble-ellipses");
          }
          await ackListInbox(inbox.map((row) => row.id));
        } catch {
          /* offline or server waking up - try again next time the tab opens */
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [toast])
  );

  const setList = (next) => {
    setItems(next);
    setResult(null);
    saveCart(next);
  };

  const addProduct = (p) => {
    const id = cartItemId(p);
    setPicker(false);
    if (items.some((x) => x.id === id)) return toast("Вече е в списъка", "cart");
    setList([...items, { ...p, id, qty: 1, price: p.price ?? null, done: false }]);
    toast(`Добавено: ${p.name.slice(0, 40)}`, "cart");
  };

  const payload = (list) => list.map(({ name, barcode, image_url, exact }) => ({ name, barcode, image_url, exact }));

  const runOptimize = async () => {
    const open = items.filter((it) => !it.done);
    const list = open.length ? open : items;
    setLoading(true);
    setError(null);
    try {
      setResult(await optimizeCart(payload(list)));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  /** Fill empty prices on the list from the cheapest offer for each item. */
  const fillPrices = async () => {
    setFilling(true);
    try {
      const res = await optimizeCart(payload(items));
      const best = {};
      for (const stop of res.best_split) for (const r of stop.items) if (r.offer) best[r.item] = r.offer.effective_price || r.offer.discounted_price;
      let n = 0;
      const next = items.map((it) => (it.price == null && best[it.name] != null ? (n++, { ...it, price: best[it.name], priceSource: "offer" }) : it));
      setItems(next);
      saveCart(next);
      toast(n ? `Попълнихме ${n} цени от офертите` : "Няма промоции за продуктите без цена", n ? "pricetags" : "information-circle");
    } catch (e) {
      toast(e.message, "alert-circle");
    } finally {
      setFilling(false);
    }
  };

  const finishTrip = ({ store, note, items: bought }) => {
    const total = bought.reduce((s, it) => s + (it.price != null ? it.price * (it.qty || 1) : 0), 0);
    const trip = { id: newId(), date: new Date().toISOString(), store, note, items: bought.map(({ name, qty, price }) => ({ name, qty: qty || 1, price })), total: Math.round(total * 100) / 100 };
    const nextTrips = [trip, ...trips];
    setTrips(nextTrips);
    saveTrips(nextTrips);
    const boughtIds = new Set(bought.map((b) => b.id));
    setList(items.filter((it) => !boughtIds.has(it.id)));
    toast(`Записано: ${store} · ${trip.total.toFixed(2)} €`, "wallet");
    setTab("spend");
  };

  const deleteTrip = (id) => {
    const next = trips.filter((t) => t.id !== id);
    setTrips(next);
    saveTrips(next);
  };

  const subtitle = tab === "list" ? "Напиши, отметни, запиши цените" : tab === "best" ? "Къде е най-евтино този списък" : "Колко харчиш за храна";

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Количка" subtitle={subtitle} icon="basket">
        <Segmented options={TABS} value={tab} onChange={setTab} />
      </ScreenHeader>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {tab === "list" && <ListView items={items} onChange={setList} onFinishTrip={finishTrip} onFillPrices={fillPrices} filling={filling} onOpenPicker={() => setPicker(true)} />}
        {tab === "best" && <OptimizeView items={items.filter((it) => !it.done).length ? items.filter((it) => !it.done) : items} result={result} loading={loading} error={error} onRun={runOptimize} onOpenOffer={setSelected} onGoToList={() => setTab("list")} />}
        {tab === "spend" && <ExpensesView trips={trips} onDelete={deleteTrip} />}
      </ScrollView>

      <ProductPicker visible={picker} onClose={() => setPicker(false)} onPick={addProduct} title="Добави в списъка" />
      <OfferSheet offer={selected} onClose={() => setSelected(null)} onAddToCart={(o) => { addProduct({ name: o.product_name, barcode: o.barcode || null, image_url: o.image_url || null, exact: true }); setSelected(null); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 32 },
});
