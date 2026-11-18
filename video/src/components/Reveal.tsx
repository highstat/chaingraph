import { Easing, interpolate, useCurrentFrame } from "remotion";

/** Text line that rises out of a mask. */
export const Reveal: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay = 0, children, style }) => {
  const frame = useCurrentFrame() - delay;
  return (
    <div style={{ overflow: "hidden", paddingBottom: "0.08em", ...style }}>
      <div
        style={{
          translate: `0px ${interpolate(frame, [0, 22], [110, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.22, 1, 0.36, 1) })}%`,
        }}
      >
        {children}
      </div>
    </div>
  );
};
