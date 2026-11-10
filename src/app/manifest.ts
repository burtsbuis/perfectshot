import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PerfectShot",
    short_name: "PerfectShot",
    description: "Plan portrait shoots around the light.",
    start_url: "/",
    display: "standalone",
    background_color: "#161d36",
    theme_color: "#161d36",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
