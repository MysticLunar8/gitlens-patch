import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
  entryPoints: ["src/index.ts"],
  outfile: "bin/gitlens.mjs",
  bundle: true,
  minify: true,
  platform: "node",
  target: "node24",
  format: "esm",
  charset: "utf8",
  banner: { js: "#!/usr/bin/env node" },
});

console.log("构建完成: bin/gitlens.mjs");
