import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { Marker } from "../components/Marker";
import { Section } from "../components/Section";

/** Split layout: copy on the left, full-height satellite map on the right. */
export const GeoScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background index="06 / 07" />
      <div style={{ position: "absolute", left: 900, top: 0, width: 1020, height: 980, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            width: 1920,
            height: 1080,
            left: -395,
            top: -85,
            transformOrigin: "905px 575px",
            scale: `${interpolate(frame, [0, 120], [1.25, 1.6], { easing: Easing.bezier(0.33, 1, 0.68, 1) })}`,
          }}
        >
          <Img src={staticFile("shots/osint-geo.png")} style={{ width: 1920, height: 1080 }} />
        </div>
        <Marker text="Computed shadow at 13:00 local" delay={30} x={520} y={250} />
      </div>
      <Section n="06" label="GEOINT" title="When was this photo taken?" text="Measure a shadow, get the time. Sun position, coordinates in any format, and what is around a point." style={{ position: "absolute", left: 110, top: 220 }} width={680} />
    </AbsoluteFill>
  );
};
