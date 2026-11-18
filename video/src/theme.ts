import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadInterTight } from "@remotion/google-fonts/InterTight";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const { fontFamily: display } = loadInterTight("normal", { weights: ["500", "600", "700"], subsets: ["latin"] });
export const { fontFamily: body } = loadInter("normal", { weights: ["400", "500"], subsets: ["latin"] });
export const { fontFamily: mono } = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

export const RED = "#e5484d";
export const BG = "#0a0a0a";
export const LINE = "#232323";
export const MUTED = "#8b8b8b";
