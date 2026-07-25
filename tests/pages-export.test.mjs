import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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
