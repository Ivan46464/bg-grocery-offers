/**
 * Design tokens. Every screen/component imports from here so the look stays consistent.
 */
export const colors = {
  bg: "#F3F5F9",          // app background
  surface: "#FFFFFF",
  surfaceAlt: "#F8FAFC",
  border: "#E6EAF0",
  ink: "#0B1220",         // primary text
  ink2: "#4B5563",        // secondary text
  ink3: "#9AA3B2",        // placeholders / meta
  primary: "#0F766E",     // teal - actions
  primarySoft: "#CCFBF1",
  accent: "#F59E0B",      // amber - highlights
  accentSoft: "#FEF3C7",
  success: "#16A34A",
  successSoft: "#DCFCE7",
  danger: "#DC2626",
  dangerSoft: "#FEE2E2",
  info: "#2563EB",
  infoSoft: "#DBEAFE",
  headerBg: "#0B1220",
  headerInk: "#FFFFFF",
  headerInk2: "#A3AEC2",
};

/** Colour per delivery platform (brand) and per cuisine chip (pastel bg + ink). */
export const platformColors = {
  Wolt: { bg: "#009DE0", fg: "#FFFFFF", soft: "#DDF3FF" },
  Glovo: { bg: "#FFC244", fg: "#1B1B1B", soft: "#FFF3D1" },
  Bolt: { bg: "#34D186", fg: "#0B1220", soft: "#DCF8EA" },
};
export const cuisineColors = {
  pizza: { bg: "#FFE4E1", ink: "#B91C1C" }, burger: { bg: "#FDE7C8", ink: "#9A3412" }, doner: { bg: "#FEF3C7", ink: "#92400E" }, sushi: { bg: "#FCE7F3", ink: "#9D174D" },
  asian: { bg: "#FEE2E2", ink: "#991B1B" }, italian: { bg: "#DCFCE7", ink: "#166534" }, grill: { bg: "#F3E8DD", ink: "#7C2D12" }, chicken: { bg: "#FEF9C3", ink: "#854D0E" },
  healthy: { bg: "#D1FAE5", ink: "#065F46" }, breakfast: { bg: "#FFEDD5", ink: "#9A3412" }, dessert: { bg: "#F3E8FF", ink: "#6B21A8" }, coffee: { bg: "#EFE4DA", ink: "#5B3A29" },
  bulgarian: { bg: "#E0F2FE", ink: "#075985" }, mexican: { bg: "#FFE4E6", ink: "#9F1239" }, seafood: { bg: "#CFFAFE", ink: "#155E75" }, sandwich: { bg: "#FEF3C7", ink: "#78350F" },
  turkish: { bg: "#FEE2E2", ink: "#7F1D1D" }, soup: { bg: "#FFEDD5", ink: "#7C2D12" },
};
export const targetColors = {
  restaurants: "#0F766E",   // teal
  dishes: "#D97706",        // amber
  deals: "#DB2777",         // pink
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };

export const shadow = {
  card: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  float: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
};

export const type = {
  h1: { fontSize: 28, fontWeight: "800", color: colors.ink, letterSpacing: -0.6 },
  h2: { fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: -0.3 },
  h3: { fontSize: 16, fontWeight: "700", color: colors.ink },
  body: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  small: { fontSize: 13, color: colors.ink2 },
  tiny: { fontSize: 11, color: colors.ink3, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
};

export const money = (n) => (n == null ? "" : `${Number(n).toFixed(2)} €`);
