import { Easing, interpolate, useCurrentFrame } from "remotion";

const FACETS: [string, number, number, number][] = [
  // path, fill opacity, fly-in angle (deg), delay (frames)
  ["M12 12 12 1.8 20.8 6.9Z", 1, -90, 0],
  ["M12 12 20.8 6.9 20.8 17.1Z", 0.7, -30, 4],
  ["M12 12 20.8 17.1 12 22.2Z", 0.46, 30, 8],
  ["M12 12 12 22.2 3.2 17.1Z", 0.58, 90, 12],
  ["M12 12 3.2 17.1 3.2 6.9Z", 0.8, 150, 16],
  ["M12 12 3.2 6.9 12 1.8Z", 0.9, 210, 20],
];

/** The ChainGraph crystal: facets fly in from outside, then the hub lights up. */
export const LogoMark: React.FC<{ size: number; color?: string; start?: number }> = ({ size, color = "#e5484d", start = 0 }) => {
  const frame = useCurrentFrame() - start;
  const hub = interpolate(frame, [26, 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.34, 1.56, 0.64, 1) });
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ overflow: "visible" }}>
      {FACETS.map(([d, o, angle, delay]) => {
        const p = interpolate(frame, [delay, delay + 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) });
        const r = ((angle + 60) * Math.PI) / 180;
        return (
          <path
            key={d}
            d={d}
            fill={color}
            fillOpacity={o * p}
            stroke="#0a0a0a"
            strokeOpacity={p}
            strokeWidth={0.9}
            strokeLinejoin="round"
            style={{ translate: `${Math.cos(r) * 14 * (1 - p)}px ${Math.sin(r) * 14 * (1 - p)}px`, transformOrigin: "12px 12px", scale: `${0.6 + 0.4 * p}` }}
          />
        );
      })}
      <circle cx="12" cy="12" r={2.3 * hub} fill="#0a0a0a" />
      <circle cx="12" cy="12" r={1.15 * hub} fill={color} />
    </svg>
  );
};
