import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // This directory also contains packaged branding and vendor assets.
    // Vite owns runtime.js only; the copy script refreshes the other runtime files.
    emptyOutDir: false,
    lib: {
      entry: "src/main.ts",
      formats: ["iife"],
      name: "MotorRuntime",
      fileName: () => "runtime.js",
    },
    minify: "esbuild",
    outDir: "../src/motor/static",
    sourcemap: false,
    target: "es2022",
  },
});
