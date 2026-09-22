import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5173 is often taken by another Vite project; pin a dedicated port so
    // the dev URL is always the same.
    port: 5180,
    strictPort: true,
    // The API runs separately; proxying keeps the browser on one origin.
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
