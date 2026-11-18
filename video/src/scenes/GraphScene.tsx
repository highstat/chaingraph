import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { Frame } from "../components/Frame";
import { Marker } from "../components/Marker";
import { Section } from "../components/Section";

// Crop to the graph canvas area of the capture (x 304–1580).
const CROP = { x: 304, y: 84, w: 1276, h: 980 };
const W = 1000;
const S = W / CROP.w;

export const GraphScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background index="01 / 07" />
      <Section n="01" label="Investigation graph" title="Every hop, every chain." text="Paste an address and follow the money. Auto-trace walks the largest flows, chronologically, until funds reach an exchange or a mixer." style={{ position: "absolute", left: 110, top: 200 }} width={640} />
      <div
        style={{
          position: "absolute",
          right: 110,
          top: 120,
          opacity: interpolate(frame, [6, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: `0px ${interpolate(frame, [6, 30], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.22, 1, 0.36, 1) })}px`,
        }}
      >
        <Frame src="shots/graph.png" width={W} crop={CROP}>
          <Marker text="Auto-traced flows" delay={45} x={(905 - CROP.x) * S} y={(345 - CROP.y) * S} />
          <Marker text="Common-input clusters" delay={65} x={(1122 - CROP.x) * S} y={(838 - CROP.y) * S} side="left" />
          <Marker text="Solana in the same case" delay={85} x={(630 - CROP.x) * S} y={(918 - CROP.y) * S} />
        </Frame>
      </div>
    </AbsoluteFill>
  );
};
