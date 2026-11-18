import { AbsoluteFill } from "remotion";
import { BG, LINE, MUTED, mono } from "../theme";

/** Flat canvas with a quiet editorial footer: product name left, section index right. */
export const Background: React.FC<{ index?: string }> = ({ index }) => (
  <AbsoluteFill style={{ backgroundColor: BG }}>
    <div style={{ position: "absolute", left: 110, right: 110, bottom: 64, height: 1, backgroundColor: LINE }} />
    <div style={{ position: "absolute", left: 110, bottom: 30, fontFamily: mono, fontSize: 18, color: MUTED, letterSpacing: "0.04em" }}>CHAINGRAPH</div>
    {index && <div style={{ position: "absolute", right: 110, bottom: 30, fontFamily: mono, fontSize: 18, color: MUTED }}>{index}</div>}
  </AbsoluteFill>
);
