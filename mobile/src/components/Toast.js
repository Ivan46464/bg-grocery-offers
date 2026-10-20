import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow } from "../theme";

const ToastContext = createContext(() => {});

/** useToast() -> show("Добавено в количката") */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const timer = useRef(null);

  const show = useCallback(
    (text, icon = "checkmark-circle") => {
      setMsg({ text, icon });
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setMsg(null));
      }, 2200);
    },
    [opacity]
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <Animated.View pointerEvents="none" style={[styles.toast, { opacity, bottom: insets.bottom + 76 }]}>
          <Ionicons name={msg.icon} size={18} color={colors.successSoft} />
          <Text style={styles.text}>{msg.text}</Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.pill,
    ...shadow.float,
  },
  text: { color: "#fff", fontWeight: "600", fontSize: 14 },
});
