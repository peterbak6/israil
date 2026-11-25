import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// The Cloudflare plugin builds the Worker (worker/index.ts) and serves the React app as static assets.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
