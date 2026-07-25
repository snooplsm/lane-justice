import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const clientDir = resolve(projectRoot, "dist/client");
const outputDir = resolve(projectRoot, "dist/pages");
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("pages-export", `${Date.now()}`);

const { default: worker } = await import(workerUrl.href);
const response = await worker.fetch(
  new Request("https://game.rprtd.app/", {
    headers: {
      accept: "text/html",
      host: "game.rprtd.app",
      "x-forwarded-host": "game.rprtd.app",
      "x-forwarded-proto": "https",
    },
  }),
  { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  { waitUntil() {}, passThroughOnException() {} },
);

if (!response.ok) {
  throw new Error(`Static render failed with HTTP ${response.status}`);
}

const html = await response.text();
if (!html.includes("Lane Justice") || !html.includes("/assets/")) {
  throw new Error("Static render did not include the game shell and client assets");
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(clientDir, outputDir, { recursive: true });
await writeFile(resolve(outputDir, "index.html"), html);
await writeFile(resolve(outputDir, "404.html"), html);
await writeFile(resolve(outputDir, "CNAME"), "game.rprtd.app\n");
await writeFile(resolve(outputDir, ".nojekyll"), "");

process.stdout.write(`${outputDir}\n`);
