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
