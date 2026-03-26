// WPlus Build Script — compiles TypeScript source to injectable JS
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "fs";

// Build engine.js from src/
await build({
  entryPoints: ["src/engine.ts"],
  bundle: true,
  outfile: "dist/engine.js",
  format: "iife",
  target: "es2020",
  minify: false,
  sourcemap: false,
});

// Build ui.js from src/
await build({
  entryPoints: ["src/ui.ts"],
  bundle: true,
  outfile: "dist/ui.js",
  format: "iife",
  target: "es2020",
  minify: false,
  sourcemap: false,
});

console.log("Build complete → dist/engine.js + dist/ui.js");
