import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { Frame } from "../components/Frame";
import { Section } from "../components/Section";
import { body, MUTED } from "../theme";

export const WorkspaceScene: React.FC = () => {
  const frame = useCurrentFrame();
  const a = interpolate(frame, [60, 72], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const b = interpolate(frame, [110, 122], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Background index="07 / 07" />
      <Section n="07" label="Workspace" title="Built for long investigations." text="Command palette, nine themes, cases as a vault, Markdown notes, exports to Obsidian." style={{ position: "absolute", left: 110, top: 200 }} width={620} />
      <div
        style={{
          position: "absolute",
          right: 110,
          top: 180,
          opacity: interpolate(frame, [6, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: `0px ${interpolate(frame, [6, 30], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.22, 1, 0.36, 1) })}px`,
        }}
      >
        <div style={{ position: "relative" }}>
          <Frame src="shots/palette.png" width={1000} />
          <div style={{ position: "absolute", inset: 0, opacity: a * (1 - b) }}>
            <Frame src="shots/themes.png" width={1000} />
          </div>
          <div style={{ position: "absolute", inset: 0, opacity: b }}>
            <Frame src="shots/obsidian-theme.png" width={1000} />
          </div>
        </div>
        <div style={{ fontFamily: body, fontSize: 24, color: MUTED, marginTop: 16 }}>
          {b > 0.5 ? "Obsidian-style graph controls" : a > 0.5 ? "Themes and accent colors" : "Command palette  ⌘P"}
        </div>
      </div>
    </AbsoluteFill>
  );
};
