/**
 * BG Оферти - search the weekly promotions of Lidl, Kaufland, Billa and Metro.
 *
 * Tabs:  Оферти (search)  ·  Количка (smart cart)  ·  Скенер (barcode)  ·  Наблюдение (price alerts)
 * Safe areas: every screen uses ScreenHeader (top inset) and the tab bar gets the
 * bottom inset from react-navigation + SafeAreaProvider, so nothing hides behind
 * the status bar or the Android navigation buttons.
 */
import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";

import { ToastProvider } from "./src/components/Toast";
import CartScreen from "./src/screens/CartScreen";
import ScannerScreen from "./src/screens/ScannerScreen";
import SearchScreen from "./src/screens/SearchScreen";
import WatchScreen from "./src/screens/WatchScreen";
import { colors } from "./src/theme";

// Show notifications even while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

const Tab = createBottomTabNavigator();

const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.surface, border: colors.border, primary: colors.primary } };

const ICONS = {
  Search: ["search", "search-outline"],
  Cart: ["basket", "basket-outline"],
  Scanner: ["barcode", "barcode-outline"],
  Watch: ["notifications", "notifications-outline"],
};

/**
 * Tab bar height = content + the bottom system inset (Android 3-button nav /
 * gesture bar). A fixed `height` would swallow that inset and put the bar
 * underneath the system buttons, so we add it explicitly here.
 */
function Tabs() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.ink3,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginBottom: 2 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 58 + bottom,
          paddingTop: 6,
          paddingBottom: bottom,
        },
        tabBarIcon: ({ focused, color, size }) => <Ionicons name={focused ? ICONS[route.name][0] : ICONS[route.name][1]} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Search" component={SearchScreen} options={{ title: "Оферти" }} />
      <Tab.Screen name="Cart" component={CartScreen} options={{ title: "Количка" }} />
      <Tab.Screen name="Scanner" component={ScannerScreen} options={{ title: "Скенер" }} />
      <Tab.Screen name="Watch" component={WatchScreen} options={{ title: "Наблюдение" }} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      <ToastProvider>
        <NavigationContainer theme={navTheme}>
          <Tabs />
        </NavigationContainer>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
