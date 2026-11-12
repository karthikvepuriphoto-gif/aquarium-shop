import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/aquarium-shop/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", ".nojekyll"],
      manifest: {
        name: "Aquarium Shop",
        short_name: "Aquarium",
        description: "Billing, stock and GST helper for a small ornamental fish shop.",
        start_url: "/aquarium-shop/",
        scope: "/aquarium-shop/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#F4F1EA",
        theme_color: "#0E5C55",
        lang: "en",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/aquarium-shop/index.html",
        globPatterns: ["**/*.{js,css,html,png,svg,woff2,ico,webmanifest}"],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
