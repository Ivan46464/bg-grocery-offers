import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { colors, money } from "../theme";

/**
 * Tiny price trend line. `points` = [{ seen_at, price }] oldest first.
 * With fewer than 2 points we show a note instead of a misleading flat line.
 */
export default function Sparkline({ points = [], width = 300, height = 70, current }) {
  if (points.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {points.length === 1 ? "Първо наблюдение - историята се трупа с всяка седмица." : "Още няма ценова история за този продукт."}
        </Text>
      </View>
    );
  }
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = 8;
  const span = max - min || 1;
  const x = (i) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (p) => pad + (1 - (p - min) / span) * (height - pad * 2);
  const coords = prices.map((p, i) => `${x(i)},${y(p)}`).join(" ");
  const last = prices[prices.length - 1];
  const isLow = last <= min + 0.005;

  return (
    <View>
      <Svg width={width} height={height}>
        <Line x1={pad} y1={y(min)} x2={width - pad} y2={y(min)} stroke={colors.successSoft} strokeWidth={2} strokeDasharray="4 4" />
        <Polyline points={coords} fill="none" stroke={isLow ? colors.success : colors.accent} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={x(points.length - 1)} cy={y(last)} r={4.5} fill={isLow ? colors.success : colors.accent} stroke="#fff" strokeWidth={2} />
      </Svg>
      <View style={styles.legend}>
        <Text style={styles.legendText}>мин. {money(min)}</Text>
        <Text style={styles.legendText}>макс. {money(max)}</Text>
        <Text style={styles.legendText}>{points.length} наблюдения</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: 14, paddingHorizontal: 12, backgroundColor: colors.surfaceAlt, borderRadius: 10 },
  emptyText: { fontSize: 13, color: colors.ink2, textAlign: "center" },
  legend: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  legendText: { fontSize: 11, color: colors.ink3, fontWeight: "600" },
});
