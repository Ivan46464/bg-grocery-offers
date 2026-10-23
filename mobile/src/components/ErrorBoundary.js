/**
 * Crash guard. A JavaScript error while rendering used to close the whole app
 * (and, when the bad state was persisted, keep it from opening again). Now the
 * error is caught here, written to storage (so the next start can show it and
 * avoid the same path) and the user gets a screen with the message, "Опитай
 * пак" and "Нулирай настройките" instead of a dead app.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../theme";
import { saveCrash, resetRiskySettings } from "../storage";

export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    saveCrash({ message: String(error?.message || error), stack: String(error?.stack || "").slice(0, 1500), component: String(info?.componentStack || "").slice(0, 800), at: new Date().toISOString(), where: this.props.name || "app" });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    return (
      <View style={styles.wrap}>
        <Ionicons name="bug-outline" size={40} color={colors.danger} />
        <Text style={styles.title}>Нещо се счупи{this.props.name ? ` в „${this.props.name}“` : ""}</Text>
        <Text style={styles.sub}>Снимай този екран и ми го прати - така ще го оправя точно.</Text>
        <ScrollView style={styles.box} contentContainerStyle={{ padding: 10 }}>
          <Text style={styles.code}>{String(e?.message || e)}</Text>
          <Text style={[styles.code, { color: colors.ink3, marginTop: 6 }]}>{String(e?.stack || "").split("\n").slice(0, 6).join("\n")}</Text>
        </ScrollView>
        <Pressable onPress={this.reset} style={styles.btn}>
          <Text style={styles.btnText}>Опитай пак</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            await resetRiskySettings();
            this.reset();
          }}
          style={[styles.btn, { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }]}
        >
          <Text style={[styles.btnText, { color: colors.ink2 }]}>Нулирай настройките (адрес, профили)</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24, backgroundColor: colors.bg },
  title: { fontSize: 18, fontWeight: "800", color: colors.ink, textAlign: "center" },
  sub: { fontSize: 13, color: colors.ink2, textAlign: "center" },
  box: { maxHeight: 220, alignSelf: "stretch", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  code: { fontSize: 11, color: colors.danger, fontFamily: "monospace" },
  btn: { alignSelf: "stretch", alignItems: "center", paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.primary },
  btnText: { color: "#fff", fontWeight: "800" },
});
