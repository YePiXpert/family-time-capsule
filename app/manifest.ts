import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "家庭时间胶囊 · Family Time Capsule",
    short_name: "时间胶囊",
    description:
      "私人、自托管的家庭成长记忆档案。随处记录，统一归档。",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f4",
    theme_color: "#faf8f4",
    lang: "zh-CN",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
