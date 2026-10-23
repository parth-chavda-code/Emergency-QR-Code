import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Browser API paths match Express online and are forwarded during local development.
// Backend secrets and the root .env are never loaded into the frontend.
const proxy = {
  "/e": {
    target: "http://127.0.0.1:3000",
    changeOrigin: true,
    // Browser navigation uses Vite's app shell; the public JSON fetch is proxied.
    bypass(req) {
      if (req.headers.accept?.includes("text/html")) return "/index.html";
    },
  },
  "/user": {
    target: "http://127.0.0.1:3000",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" } },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" } },
});
