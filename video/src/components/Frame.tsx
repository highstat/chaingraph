import { Img, staticFile } from "remotion";
import { LINE } from "../theme";

/** Flat screenshot with a hairline border. Optional crop region (capture pixels). */
export const Frame: React.FC<{
  src: string;
  width: number;
  crop?: { x: number; y: number; w: number; h: number };
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ src, width, crop = { x: 0, y: 0, w: 1920, h: 1080 }, style, children }) => {
  const s = width / crop.w;
  return (
    <div style={{ position: "relative", width, height: crop.h * s, overflow: "hidden", borderRadius: 10, border: `1px solid ${LINE}`, backgroundColor: "#000", ...style }}>
      <Img src={staticFile(src)} style={{ position: "absolute", left: -crop.x * s, top: -crop.y * s, width: 1920 * s, height: 1080 * s }} />
      {children}
    </div>
  );
};
