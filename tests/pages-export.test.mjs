import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

test("exports a self-contained custom-domain GitHub Pages site", async () => {
  const html = await readFile("dist/pages/index.html", "utf8");
  const cname = await readFile("dist/pages/CNAME", "utf8");

  assert.equal(cname.trim(), "game.rprtd.app");
  assert.match(html, /https:\/\/game\.rprtd\.app\/og\.png/i);
  assert.doesNotMatch(html, /localhost:3000/i);

  const head = html.slice(0, html.indexOf("</head>"));
  const assets = [...head.matchAll(/["(](\/assets\/[^"')\s]+)/g)].map((match) => match[1]);
  assert.ok(assets.length > 0, "expected the page to reference built assets");
  await Promise.all([...new Set(assets)].map((asset) => access(`dist/pages${asset}`)));
});

test("exports optimized realistic passenger and service vehicle models", async () => {
  const models = [
    "realistic-usps-step-van.glb",
    "realistic-box-truck.glb",
    "realistic-passenger-fleet.glb",
  ];

  for (const model of models) {
    const path = `dist/pages/models/${model}`;
    const [contents, metadata] = await Promise.all([readFile(path), stat(path)]);
    assert.equal(contents.subarray(0, 4).toString("ascii"), "glTF", `${model} must be a binary glTF`);
    assert.ok(metadata.size > 50_000, `${model} must contain real model data`);
    assert.ok(metadata.size < 3_000_000, `${model} must stay within the mobile asset budget`);
  }

  const scripts = (await readdir("dist/pages/assets")).filter((file) => file.endsWith(".js"));
  const javascript = (await Promise.all(scripts.map((file) => readFile(`dist/pages/assets/${file}`, "utf8")))).join("\n");
  assert.match(javascript, /realistic-usps-step-van\.glb/);
  assert.match(javascript, /realistic-box-truck\.glb/);
  assert.match(javascript, /realistic-passenger-fleet\.glb/);
});
