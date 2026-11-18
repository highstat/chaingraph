import { AbsoluteFill, Easing, interpolate, Interactive, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { LogoMark } from "../components/LogoMark";
import { Reveal } from "../components/Reveal";
import { body, display, MUTED, mono, RED } from "../theme";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
        <LogoMark size={110} />
        <Reveal delay={24} style={{ marginTop: 36 }}>
          <Interactive.Div name="Outro title" style={{ fontFamily: display, fontSize: 104, fontWeight: 600, letterSpacing: "-0.045em", color: "#fafafa", lineHeight: 1 }}>
            ChainGraph
          </Interactive.Div>
        </Reveal>
        <Reveal delay={36} style={{ marginTop: 34 }}>
          <Interactive.Div name="Repository URL" style={{ fontFamily: mono, fontSize: 40, color: "#fafafa" }}>
            github.com/highstat/chaingraph
          </Interactive.Div>
        </Reveal>
        <div
          style={{
            height: 2,
            backgroundColor: RED,
            marginTop: 14,
            width: interpolate(frame, [50, 76], [0, 720], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.35, 1) }),
          }}
        />
        <Interactive.Div
          name="Outro facts"
          style={{ fontFamily: body, fontSize: 28, color: MUTED, marginTop: 36, opacity: interpolate(frame, [70, 86], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}
        >
          Free and open source · MIT license · No API keys
        </Interactive.Div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
