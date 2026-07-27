import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Lane Justice game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Lane Justice/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/i);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/i);
  assert.match(html, /Lane[\s\S]*Justice/i);
  assert.match(html, /Start riding/i);
  assert.match(html, /Urban cycling/i);
  assert.match(html, /Crosswalk violations are worth triple/i);
  assert.match(html, /F to rip mirror/i);
  assert.doesNotMatch(html, /Rip off nearby mirror/i);
  assert.match(html, /Drag to steer[^<]*swipe up\/down for phone[^<]*two-finger slide for speed[^<]*tap to rip or snap/i);
  assert.doesNotMatch(html, /aria-label="Touch controls"|aria-label="Pedal faster"|aria-label="Steer left"/i);
  assert.doesNotMatch(html, /Best played in landscape/i);
  assert.match(html, /Sound on/i);
  assert.match(html, /Mute sound/i);
  assert.match(html, /license plate[\s\S]*ALPR/i);
  assert.match(html, /Another victim of drivers in the bike lane/i);
  assert.match(html, /Enable motion aim/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});
