/**
 * App configuration.
 *
 * API_URL - where the FastAPI backend lives. ONE place to change.
 *
 *   Deployed:        "https://bg-grocery-offers-api.onrender.com"
 *   Local (emulator) "http://10.0.2.2:8000"      (Android emulator's alias for your PC)
 *   Local (phone)    "http://192.168.1.23:8000"  (your PC's LAN IP, same Wi-Fi)
 *
 * You can also set EXPO_PUBLIC_API_URL in a `.env` file instead of editing this.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://YOUR-SERVICE-NAME.onrender.com").replace(/\/$/, "");

/** How long to wait after the user stops typing before searching (ms). */
export const SEARCH_DEBOUNCE_MS = 400;

/** Brand colours used for the store badge. Add a `logo` (require('../assets/...')) to show an image instead. */
export const STORES = {
  Lidl: { bg: "#0050AA", fg: "#FFF000", short: "L", logo: null },
  Kaufland: { bg: "#E10915", fg: "#FFFFFF", short: "K", logo: null },
  Billa: { bg: "#FFD400", fg: "#D52B1E", short: "B", logo: null },
  Metro: { bg: "#003D8F", fg: "#FFD200", short: "M", logo: null },
};

export const STORE_ORDER = ["Lidl", "Kaufland", "Billa", "Metro"];

export const CURRENCY = "€";
