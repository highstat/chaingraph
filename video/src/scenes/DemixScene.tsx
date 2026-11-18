import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { Section } from "../components/Section";
import { body, MUTED, mono, RED } from "../theme";

const TECHNIQUES = ["Tornado Cash demixing", "CoinJoin detection", "Peel chains", "Chain hopping", "Structuring", "Pass-through wallets", "Address poisoning", "Instant exchangers"];

export const DemixScene: React.FC = () => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [10, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.35, 1) });
  return (
    <AbsoluteFill>
      <Background index="02 / 07" />
      {/* Right half: the demix finding, zoomed from the full screenshot */}
      <div style={{ position: "absolute", left: 960, top: 0, width: 960, height: 980, overflow: "hidden" }}>
        <div style={{ position: "absolute", width: 1920, height: 1080, left: -960, top: 0, transformOrigin: "1750px 560px", scale: `${1 + zoom * 1.05}`, translate: `${-zoom * 300}px ${-zoom * 40}px` }}>
          <Img src={staticFile("shots/demix.png")} style={{ width: 1920, height: 1080 }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 960, top: 0, width: 1, height: 980, backgroundColor: "#232323" }} />
      <Section n="02" label="Obfuscation analysis" title="Mixers leave patterns." style={{ position: "absolute", left: 110, top: 160 }} width={740} delay={8} />
      <div style={{ position: "absolute", left: 110, top: 470, display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 40, rowGap: 22, width: 760 }}>
        {TECHNIQUES.map((t, i) => (
          <div key={t} style={{ display: "flex", gap: 14, alignItems: "baseline", opacity: interpolate(frame, [40 + i * 5, 52 + i * 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), translate: `0px ${interpolate(frame, [40 + i * 5, 58 + i * 5], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.22, 1, 0.36, 1) })}px` }}>
            <span style={{ fontFamily: mono, fontSize: 20, color: RED }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ fontFamily: body, fontSize: 30, color: "#e5e5e5" }}>{t}</span>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 110, top: 800, fontFamily: body, fontSize: 26, color: MUTED, width: 760, lineHeight: 1.5, opacity: interpolate(frame, [95, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        A 100,000 DAI deposit matched to a 99,606 DAI withdrawal six minutes later. Anonymity set: two.
      </div>
    </AbsoluteFill>
  );
};
