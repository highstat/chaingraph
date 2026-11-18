import { Easing, interpolate, useCurrentFrame } from "remotion";
import { body, RED } from "../theme";

/** Minimal annotation: a dot, a drawn leader line and a label. */
export const Marker: React.FC<{ text: string; delay: number; x: number; y: number; side?: "right" | "left" }> = ({ text, delay, x, y, side = "right" }) => {
  const frame = useCurrentFrame() - delay;
  const ease = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const, easing: Easing.bezier(0.22, 1, 0.36, 1) };
  const line = interpolate(frame, [4, 20], [0, 70], ease);
  return (
    <div style={{ position: "absolute", left: x, top: y, display: "flex", alignItems: "center", flexDirection: side === "right" ? "row" : "row-reverse", translate: side === "left" ? "calc(-100% + 6px) -50%" : "-6px -50%" }}>
      <div style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: RED, scale: `${interpolate(frame, [0, 10], [0, 1], ease)}`, boxShadow: "0 0 0 4px rgba(10,10,10,0.9)" }} />
      <div style={{ width: line, height: 1.5, backgroundColor: RED }} />
      <div
        style={{
          fontFamily: body,
          fontSize: 24,
          fontWeight: 500,
          color: "#fafafa",
          backgroundColor: "#0a0a0a",
          padding: "8px 14px",
          border: "1px solid #2a2a2a",
          borderRadius: 6,
          whiteSpace: "nowrap",
          opacity: interpolate(frame, [14, 24], [0, 1], ease),
        }}
      >
        {text}
      </div>
    </div>
  );
};
