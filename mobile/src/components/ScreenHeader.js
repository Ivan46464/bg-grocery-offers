import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";

/**
 * Dark header that respects the status bar / notch (top safe-area inset).
 * Layout: [icon mark] Title            [right]
 *                     subtitle
 *         [children - e.g. the search bar]
 */
export default function ScreenHeader({ title, subtitle, icon = "pricetag", color, right, children }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
      <View style={styles.row}>
        <View style={[styles.mark, color ? { backgroundColor: color } : null]}>
          <Ionicons name={icon} size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
      {children ? <View style={styles.child}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  mark: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", transform: [{ rotate: "-12deg" }] },
  title: { color: colors.headerInk, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  subtitle: { color: colors.headerInk2, fontSize: 12, marginTop: 1 },
  child: { marginTop: 14 },
});
