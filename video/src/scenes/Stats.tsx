import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { Reveal } from "../components/Reveal";
import { body, display, LINE, MUTED, RED } from "../theme";

const STATS: [number, string, string][] = [
  [24, "networks", "Bitcoin, Ethereum, Solana, TRON, TON, XRP and more"],
  [17, "laundering detectors", "Mixers, CoinJoin, peel chains, chain hopping"],
  [0, "API keys required", "Runs entirely in your browser"],
];

export const Stats: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background />
      <div style={{ position: "absolute", left: 110, right: 110, top: 300, display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
        {STATS.map(([value, label, sub], i) => {
          const d = i * 8;
          const count = Math.round(interpolate(frame, [d, d + 30], [0, value], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.22, 1, 0.36, 1) }));
          return (
            <div key={label} style={{ paddingLeft: i ? 48 : 0, borderLeft: i ? `1px solid ${LINE}` : undefined, height: 420 }}>
              <Reveal delay={d}>
                <div style={{ fontFamily: display, fontSize: 220, fontWeight: 600, letterSpacing: "-0.05em", color: RED, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{count}</div>
              </Reveal>
              <Reveal delay={d + 8} style={{ marginTop: 18 }}>
                <div style={{ fontFamily: display, fontSize: 52, fontWeight: 600, color: "#fafafa", letterSpacing: "-0.02em" }}>{label}</div>
              </Reveal>
              <div style={{ fontFamily: body, fontSize: 28, color: MUTED, marginTop: 16, lineHeight: 1.4, maxWidth: 480, opacity: interpolate(frame, [d + 18, d + 32], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{sub}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
