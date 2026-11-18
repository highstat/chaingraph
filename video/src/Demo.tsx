import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { ChainsScene } from "./scenes/ChainsScene";
import { DemixScene } from "./scenes/DemixScene";
import { GeoScene } from "./scenes/GeoScene";
import { GraphScene } from "./scenes/GraphScene";
import { Intro } from "./scenes/Intro";
import { OsintScene } from "./scenes/OsintScene";
import { Outro } from "./scenes/Outro";
import { RiskScene } from "./scenes/RiskScene";
import { Stats } from "./scenes/Stats";
import { WorkspaceScene } from "./scenes/WorkspaceScene";

/** ChainGraph product demo: minimal editorial style, 10 scenes joined by short fades. */
export const Demo: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence name="Intro" durationInFrames={110}>
      <Intro />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="Stats" durationInFrames={110}>
      <Stats />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="Graph" durationInFrames={170}>
      <GraphScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="Demixing" durationInFrames={170}>
      <DemixScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="Risk & behavior" durationInFrames={140}>
      <RiskScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="Chains" durationInFrames={120}>
      <ChainsScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="OSINT" durationInFrames={140}>
      <OsintScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="GEOINT" durationInFrames={130}>
      <GeoScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
    <TransitionSeries.Sequence name="Workspace" durationInFrames={170}>
      <WorkspaceScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
    <TransitionSeries.Sequence name="Outro" durationInFrames={140}>
      <Outro />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
