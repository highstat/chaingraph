import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { Frame } from "../components/Frame";
import { Section } from "../components/Section";
import { body, MUTED } from "../theme";

export const RiskScene: React.FC = () => {
  const frame = useCurrentFrame();
  const rise = (d: number) => ({
    opacity: interpolate(frame, [d, d + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    translate: `0px ${interpolate(frame, [d, d + 26], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.22, 1, 0.36, 1) })}px`,
  });
  return (
    <AbsoluteFill>
      <Background index="03 / 07" />
      <Section n="03" label="Explainable intelligence" title="Know why, not just what." text="Every risk point is itemized. Behavior reveals working hours and a likely time zone." style={{ position: "absolute", left: 110, top: 200 }} width={620} />
      <div style={{ position: "absolute", right: 110, top: 130, display: "flex", gap: 40 }}>
        <div style={rise(14)}>
          <Frame src="shots/inspector.png" width={480} crop={{ x: 1582, y: 44, w: 336, h: 560 }} />
          <div style={{ fontFamily: body, fontSize: 24, color: MUTED, marginTop: 16 }}>Risk score, exposure, attribution</div>
        </div>
        <div style={rise(28)}>
          <Frame src="shots/behavior.png" width={480} crop={{ x: 1582, y: 392, w: 336, h: 560 }} />
          <div style={{ fontFamily: body, fontSize: 24, color: MUTED, marginTop: 16 }}>Activity heatmap, time-zone estimate</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
