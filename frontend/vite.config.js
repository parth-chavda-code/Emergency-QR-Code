import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The browser uses /api; Vite forwards it to Express during local development.
// Backend secrets and the root .env are never loaded into the frontend.
const proxy = {
  "/api": {
    target: "http://127.0.0.1:3000",
    changeOrigin: true,
    rewrite: path => path.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
});
