import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
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
