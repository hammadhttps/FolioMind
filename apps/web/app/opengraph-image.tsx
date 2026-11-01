import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Default Open Graph image (blueprint Section 30): lavender hero gradient, tile
// mark, Source Serif 4 headline and Inter subline. Fonts are bundled in
// assets/fonts so rendering never fetches anything.
export const alt = "FolioMind — Your knowledge, connected.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const root = process.cwd();
const [serif, interMedium, interBold, tile] = await Promise.all([
  readFile(join(root, "assets/fonts/SourceSerif4-SemiBold.ttf")),
  readFile(join(root, "assets/fonts/Inter-Medium.ttf")),
  readFile(join(root, "assets/fonts/Inter-Bold.ttf")),
  readFile(join(root, "app/icon.svg"), "base64"),
]);

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 84px",
        background: "linear-gradient(135deg, #F0F0FE 0%, #F5F5FC 48%, #E9EAF9 100%)",
        position: "relative",
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          position: "absolute",
          right: -120,
          top: -90,
          width: 620,
          height: 620,
          borderRadius: 9999,
          border: "2px solid rgba(67, 56, 202, 0.10)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 10,
          top: 40,
          width: 360,
          height: 360,
          borderRadius: 9999,
          border: "2px solid rgba(67, 56, 202, 0.08)",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img */}
        <img src={`data:image/svg+xml;base64,${tile}`} width={76} height={76} alt="" />
        <div
          style={{
            fontFamily: "Inter",
            fontWeight: 700,
            fontSize: 44,
            letterSpacing: "-0.02em",
            color: "#20243E",
          }}
        >
          FolioMind
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{
            fontFamily: "Source Serif 4",
            fontWeight: 600,
            fontSize: 86,
            lineHeight: 1.05,
            letterSpacing: "-0.015em",
            color: "#20243E",
          }}
        >
          Your knowledge, connected.
        </div>
        <div style={{ fontFamily: "Inter", fontWeight: 500, fontSize: 32, color: "#5C627C" }}>
          Read deeply. Connect freely. Create thoughtfully.
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Source Serif 4", data: serif, weight: 600, style: "normal" },
        { name: "Inter", data: interMedium, weight: 500, style: "normal" },
        { name: "Inter", data: interBold, weight: 700, style: "normal" },
      ],
    },
  );
}
