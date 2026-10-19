import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

/**
 * Prominent search input with a clear (×) button.
 * Fully controlled: parent owns `value`.
 */
export default function SearchBar({ value, onChangeText, onSubmit, autoFocus = false }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>⌕</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder="Търси продукт… (сирене, cheese, кафе)"
        placeholderTextColor="#94A3B8"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        autoFocus={autoFocus}
        clearButtonMode="never"
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText("")} hitSlop={10} style={styles.clear} accessibilityLabel="Clear search">
          <Text style={styles.clearText}>×</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 54,
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  icon: { fontSize: 22, color: "#64748B", marginRight: 8, marginTop: -2 },
  input: { flex: 1, fontSize: 17, color: "#0F172A", height: "100%" },
  clear: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: { fontSize: 18, lineHeight: 20, color: "#334155", fontWeight: "600" },
});
