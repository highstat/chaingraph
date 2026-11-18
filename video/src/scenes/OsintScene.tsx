import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { Frame } from "../components/Frame";
import { Section } from "../components/Section";
import { body, MUTED } from "../theme";

const CARDS: [string, string][] = [
  ["shots/osint-phone.png", "Phone number analysis"],
  ["shots/osint-username.png", "Username across 80+ sites"],
  ["shots/osint-geo.png", "GEOINT and chronolocation"],
];

export const OsintScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background index="05 / 07" />
      <Section n="05" label="OSINT toolkit" title="Beyond the blockchain." text="Phone, username, email, domain, IP, GEOINT and image forensics. Public sources only." style={{ position: "absolute", left: 110, top: 120 }} width={1100} />
      <div style={{ position: "absolute", left: 110, right: 110, top: 560, display: "flex", gap: 36 }}>
        {CARDS.map(([src, label], i) => (
          <div
            key={src}
            style={{
              opacity: interpolate(frame, [20 + i * 10, 34 + i * 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              translate: `0px ${interpolate(frame, [20 + i * 10, 46 + i * 10], [50, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.22, 1, 0.36, 1) })}px`,
            }}
          >
            <Frame src={src} width={542} crop={{ x: 244, y: 40, w: 1676, h: 942 }} />
            <div style={{ fontFamily: body, fontSize: 26, color: MUTED, marginTop: 16 }}>{label}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
