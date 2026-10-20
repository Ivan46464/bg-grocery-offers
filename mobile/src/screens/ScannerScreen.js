/**
 * In-store barcode scanner: point the camera at an EAN-13 and see whether the
 * product is on promotion anywhere (exact barcode match) or cheaper elsewhere
 * (fuzzy match by the product's name).
 */
import React, { useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useIsFocused } from "@react-navigation/native";
import { lookupBarcode } from "../api";
import EmptyState from "../components/EmptyState";
import OfferCard from "../components/OfferCard";
import OfferSheet from "../components/OfferSheet";
import ScreenHeader from "../components/ScreenHeader";
import { useToast } from "../components/Toast";
import { addOfferToCart } from "../storage";
import { colors, radius, shadow } from "../theme";

const TYPES = ["ean13", "ean8", "upc_a", "upc_e"];

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const focused = useIsFocused();
  const [code, setCode] = useState(null);
  const [manual, setManual] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const busy = useRef(false);
  const toast = useToast();
  const addToCart = async (o) => {
    const added = await addOfferToCart(o);
    setSelected(null);
    toast(added ? "Добавено в списъка · виж Количка" : "Вече е в списъка", added ? "basket" : "checkmark-circle");
  };

  const lookup = async (value) => {
    const c = String(value).replace(/\D/g, "");
    if (!c || busy.current) return;
    busy.current = true;
    Keyboard.dismiss();
    setCode(c);
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      setResult(await lookupBarcode(c));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      busy.current = false;
    }
  };

  const reset = () => {
    setCode(null);
    setResult(null);
    setError(null);
  };

  const scanning = focused && !code;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Скенер" subtitle="Сканирай баркод в магазина - по-евтино ли е другаде?" />

      <View style={styles.cameraWrap}>
        {!permission ? null : !permission.granted ? (
          <View style={styles.permBox}>
            <Ionicons name="camera-outline" size={36} color={colors.headerInk2} />
            <Text style={styles.permText}>Нужен е достъп до камерата, за да четем баркодове.</Text>
            <Pressable onPress={requestPermission} style={styles.permBtn}>
              <Text style={styles.permBtnText}>Разреши камерата</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {scanning ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: TYPES }}
                onBarcodeScanned={({ data }) => lookup(data)}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.headerBg }]} />
            )}
            <View style={styles.frame} pointerEvents="none">
              <View style={[styles.corner, styles.tl]} />
              <View style={[styles.corner, styles.tr]} />
              <View style={[styles.corner, styles.bl]} />
              <View style={[styles.corner, styles.br]} />
            </View>
            {code && (
              <Pressable onPress={reset} style={styles.rescan}>
                <Ionicons name="scan-outline" size={16} color="#fff" />
                <Text style={styles.rescanText}>Сканирай отново</Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.manual}>
          <TextInput
            style={styles.manualInput}
            value={manual}
            onChangeText={setManual}
            placeholder="или въведи баркода ръчно"
            placeholderTextColor={colors.ink3}
            keyboardType="number-pad"
            onSubmitEditing={() => lookup(manual)}
          />
          <Pressable onPress={() => lookup(manual)} style={styles.manualBtn}>
            <Ionicons name="search" size={18} color="#fff" />
          </Pressable>
        </View>

        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Проверяваме {code}…</Text>
          </View>
        )}
        {error && <EmptyState icon="warning-outline" title="Грешка" subtitle={error} actionLabel="Опитай пак" onAction={() => lookup(code)} />}

        {result && (
          <View style={{ gap: 10 }}>
            <View style={styles.resultHead}>
              <Text style={styles.code}>{result.barcode}</Text>
              <Text style={styles.productName}>{result.product_name || "Непознат продукт"}</Text>
              {result.source === "openfoodfacts" && <Text style={styles.muted}>името е от Open Food Facts</Text>}
            </View>

            {result.exact.length > 0 && (
              <>
                <Text style={styles.section}>На промоция сега</Text>
                {result.exact.map((o, i) => (
                  <OfferCard key={o.id} offer={o} isBest={i === 0} onPress={setSelected} onAdd={addToCart} />
                ))}
              </>
            )}
            {result.similar.length > 0 && (
              <>
                <Text style={styles.section}>{result.exact.length ? "Подобни продукти" : "Подобни продукти на промоция"}</Text>
                {result.similar.map((o, i) => (
                  <OfferCard key={o.id} offer={o} isBest={!result.exact.length && i === 0} onPress={setSelected} onAdd={addToCart} />
                ))}
              </>
            )}
            {!result.exact.length && !result.similar.length && (
              <EmptyState
                icon="pricetag-outline"
                title={result.product_name ? "Не е на промоция тази седмица" : "Не разпознаваме този баркод"}
                subtitle={result.product_name ? "В нито един от 4-те магазина няма оферта за този продукт." : "Опитай да потърсиш продукта по име в „Оферти“."}
              />
            )}
          </View>
        )}
      </ScrollView>

      <OfferSheet offer={selected} onClose={() => setSelected(null)} onAddToCart={addToCart} />
    </View>
  );
}

const C = 26;
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  cameraWrap: { height: 230, backgroundColor: colors.headerBg, overflow: "hidden" },
  frame: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  corner: { position: "absolute", width: C, height: C, borderColor: "#fff", borderWidth: 3 },
  tl: { top: 48, left: 70, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  tr: { top: 48, right: 70, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  bl: { bottom: 48, left: 70, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  br: { bottom: 48, right: 70, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  rescan: { position: "absolute", bottom: 12, alignSelf: "center", flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill },
  rescanText: { color: "#fff", fontWeight: "700" },
  permBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  permText: { color: colors.headerInk2, textAlign: "center" },
  permBtn: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md },
  permBtnText: { color: "#fff", fontWeight: "700" },
  body: { padding: 16, paddingBottom: 32, gap: 12 },
  manual: { flexDirection: "row", gap: 8 },
  manualInput: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, height: 46, color: colors.ink, borderWidth: 1, borderColor: colors.border },
  manualBtn: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  center: { alignItems: "center", gap: 8, paddingVertical: 20 },
  muted: { color: colors.ink3, fontSize: 12 },
  resultHead: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, ...shadow.card },
  code: { fontSize: 12, color: colors.ink3, fontWeight: "700", letterSpacing: 1 },
  productName: { fontSize: 17, fontWeight: "700", color: colors.ink, marginTop: 2 },
  section: { fontSize: 12, fontWeight: "800", color: colors.ink2, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 },
});
