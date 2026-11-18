import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { Section } from "../components/Section";
import { body, LINE } from "../theme";

const CHAINS: [string, string][] = [
  ["Bitcoin", "#f7931a"], ["Ethereum", "#8c8dfc"], ["Solana", "#14f195"], ["TRON", "#26c6a6"],
  ["TON", "#0098ea"], ["XRP Ledger", "#c7ccd6"], ["Stellar", "#7d8cff"], ["Litecoin", "#a6b8d4"],
  ["Dogecoin", "#c2a633"], ["Bitcoin Cash", "#4cc947"], ["Dash", "#1c75bc"], ["Zcash", "#ecb244"],
  ["Optimism", "#ff5a6a"], ["zkSync Era", "#8b8dfc"], ["Unichain", "#f50db4"], ["Rootstock", "#ff9931"],
  ["BNB Chain", "#f0b90b"], ["Polygon", "#8247e5"], ["Arbitrum", "#28a0f0"], ["Base", "#2f6bff"],
];

export const ChainsScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background index="04 / 07" />
      <Section n="04" label="Coverage" title="One graph for every network." style={{ position: "absolute", left: 110, top: 140 }} width={1100} />
      <div style={{ position: "absolute", left: 110, right: 110, top: 470, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderTop: `1px solid ${LINE}` }}>
        {CHAINS.map(([name, color], i) => (
          <div
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "20px 0",
              borderBottom: `1px solid ${LINE}`,
              fontFamily: body,
              fontSize: 32,
              color: "#e5e5e5",
              opacity: interpolate(frame, [16 + i * 2, 28 + i * 2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            <div style={{ width: 10, height: 10, backgroundColor: color }} />
            {name}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
