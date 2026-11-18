import { AbsoluteFill, interpolate, Interactive, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { LogoMark } from "../components/LogoMark";
import { Reveal } from "../components/Reveal";
import { body, display } from "../theme";

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
        <LogoMark size={150} />
        <Reveal delay={30} style={{ marginTop: 44 }}>
          <Interactive.Div name="Product name" style={{ fontFamily: display, fontSize: 132, fontWeight: 600, letterSpacing: "-0.045em", color: "#fafafa", lineHeight: 1 }}>
            ChainGraph
          </Interactive.Div>
        </Reveal>
        <Interactive.Div
          name="Tagline"
          style={{
            fontFamily: body,
            fontSize: 36,
            color: "#8b8b8b",
            marginTop: 26,
            opacity: interpolate(frame, [50, 68], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          Crypto forensics and OSINT, in one open-source workspace.
        </Interactive.Div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
