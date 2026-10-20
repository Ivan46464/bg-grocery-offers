import React from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadow } from "../theme";

/** Prominent search input with a clear (×) button. Fully controlled. */
export default function SearchBar({ value, onChangeText, onSubmit, placeholder = "Търси продукт… сирене, cheese, кафе", autoFocus = false }) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="search" size={20} color={colors.ink3} style={{ marginRight: 8 }} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        autoFocus={autoFocus}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText("")} hitSlop={10} style={styles.clear} accessibilityLabel="Изчисти">
          <Ionicons name="close" size={16} color={colors.ink2} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    height: 52,
    ...shadow.float,
  },
  input: { flex: 1, fontSize: 16, color: colors.ink, height: "100%" },
  clear: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" },
});
