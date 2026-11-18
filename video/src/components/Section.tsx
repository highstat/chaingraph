import { Easing, interpolate, useCurrentFrame } from "remotion";
import { body, display, LINE, MUTED, mono, RED } from "../theme";
import { Reveal } from "./Reveal";

/** "01 — Label" eyebrow, a drawn hairline, and a large headline. */
export const Section: React.FC<{ n: string; label: string; title: string; text?: string; delay?: number; width?: number; style?: React.CSSProperties }> = ({ n, label, title, text, delay = 0, width = 760, style }) => {
  const frame = useCurrentFrame() - delay;
  return (
    <div style={{ width, ...style }}>
      <Reveal delay={delay}>
        <div style={{ fontFamily: mono, fontSize: 22, color: MUTED, display: "flex", gap: 16 }}>
          <span style={{ color: RED }}>{n}</span>
          <span>{label}</span>
        </div>
      </Reveal>
      <div
        style={{
          height: 1,
          backgroundColor: LINE,
          margin: "22px 0 30px",
          width: `${interpolate(frame, [4, 34], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.35, 1) })}%`,
        }}
      />
      <Reveal delay={delay + 6}>
        <div style={{ fontFamily: display, fontSize: 84, fontWeight: 600, lineHeight: 1.02, letterSpacing: "-0.035em", color: "#fafafa" }}>{title}</div>
      </Reveal>
      {text && (
        <div
          style={{
            fontFamily: body,
            fontSize: 30,
            lineHeight: 1.45,
            color: MUTED,
            marginTop: 26,
            opacity: interpolate(frame, [20, 36], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
};
