import type { MetadataRoute } from "next";

// Web app manifest (blueprint Section 30).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FolioMind",
    short_name: "FolioMind",
    description: "Your knowledge, connected.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#4338CA",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
