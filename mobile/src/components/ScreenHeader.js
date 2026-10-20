import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";

/**
 * Dark header that respects the status bar / notch (top safe-area inset).
 * `children` is rendered below the title (e.g. the search bar) and overlaps the
 * rounded bottom edge slightly for a floating look.
 */
export default function ScreenHeader({ title, subtitle, right, children }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
    paddingBottom: 18,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: colors.headerInk, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: colors.headerInk2, fontSize: 13, marginTop: 2 },
  child: { marginTop: 14 },
});
