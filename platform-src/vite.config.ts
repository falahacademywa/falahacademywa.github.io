import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Built output is committed to /platform so GitHub Pages serves it
// at <site>/platform/ regardless of whether the site lives at a domain
// root (falahacademywa.org) or a sub-path (github.io/falahacademywa-dev).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../platform",
    emptyOutDir: true,
  },
});
