import { Composition } from "remotion";
import { Demo } from "./Demo";

// Total = scenes (1400) − transitions (8 × 12 + 15 = 111) = 1289 frames ≈ 43 s
export const RemotionRoot: React.FC = () => (
  <Composition id="ChainGraphDemo" component={Demo} durationInFrames={1289} fps={30} width={1920} height={1080} />
);
