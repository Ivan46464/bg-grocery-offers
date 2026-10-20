import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../theme";

/** iOS-style segmented control. options: [{ key, label, icon? }] */
export default function Segmented({ options, value, onChange, style }) {
  return (
    <View style={[styles.wrap, style]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[styles.seg, active && styles.segActive]}>
            {o.icon ? <Ionicons name={o.icon} size={15} color={active ? colors.ink : colors.ink3} /> : null}
            <Text style={[styles.label, active && styles.labelActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.md, padding: 3 },
  seg: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: radius.md - 2 },
  segActive: { backgroundColor: colors.surface },
  label: { fontSize: 13, fontWeight: "700", color: colors.headerInk2 },
  labelActive: { color: colors.ink },
});
