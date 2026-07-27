import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

test("exports a self-contained custom-domain GitHub Pages site", async () => {
  const html = await readFile("dist/pages/index.html", "utf8");
  const cname = await readFile("dist/pages/CNAME", "utf8");

  assert.equal(cname.trim(), "game.rprtd.app");
  assert.match(html, /https:\/\/game\.rprtd\.app\/og\.png/i);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/i);
  assert.doesNotMatch(html, /localhost:3000/i);

  await Promise.all([
    access("dist/pages/manifest.webmanifest"),
    access("dist/pages/icons/icon-192.png"),
    access("dist/pages/icons/icon-512.png"),
    access("dist/pages/icons/apple-touch-icon.png"),
  ]);

  const head = html.slice(0, html.indexOf("</head>"));
  const assets = [...head.matchAll(/["(](\/assets\/[^"')\s]+)/g)].map((match) => match[1]);
  assert.ok(assets.length > 0, "expected the page to reference built assets");
  await Promise.all([...new Set(assets)].map((asset) => access(`dist/pages${asset}`)));
});

test("exports optimized realistic vehicle and streetscape models", async () => {
  const models = [
    "realistic-usps-step-van.glb",
    "realistic-box-truck.glb",
    "realistic-passenger-fleet.glb",
    "realistic-street-trees.glb",
    "realistic-nyc-buildings.glb",
    "realistic-city-bicycle.glb",
    "realistic-transit-bus.glb",
    "realistic-tow-truck.glb",
  ];

  for (const model of models) {
    const path = `dist/pages/models/${model}`;
    const [contents, metadata] = await Promise.all([readFile(path), stat(path)]);
    assert.equal(contents.subarray(0, 4).toString("ascii"), "glTF", `${model} must be a binary glTF`);
    assert.ok(metadata.size > 50_000, `${model} must contain real model data`);
    assert.ok(metadata.size < 3_000_000, `${model} must stay within the mobile asset budget`);
  }

  const streetTrees = await readFile("dist/pages/models/realistic-street-trees.glb");
  assert.ok(streetTrees.includes(Buffer.from("StreetTreeA")), "street-tree model must retain variant A");
  assert.ok(streetTrees.includes(Buffer.from("StreetTreeB")), "street-tree model must retain variant B");

  const cityBuildings = await readFile("dist/pages/models/realistic-nyc-buildings.glb");
  for (const letter of ["A", "B", "C", "D", "E", "F"]) {
    assert.ok(cityBuildings.includes(Buffer.from(`NYCBuilding${letter}`)), `building model must retain variant ${letter}`);
  }

  const cityBicycle = await readFile("dist/pages/models/realistic-city-bicycle.glb");
  for (const part of ["RealisticCityBicycle", "FrontWheel", "RearWheel", "Pedalier"]) {
    assert.ok(cityBicycle.includes(Buffer.from(part)), `bicycle model must retain ${part}`);
  }

  const transitBus = await readFile("dist/pages/models/realistic-transit-bus.glb");
  assert.ok(transitBus.includes(Buffer.from("RealisticTransitBus")), "transit-bus model must retain its asset root");

  const towTruck = await readFile("dist/pages/models/realistic-tow-truck.glb");
  assert.ok(towTruck.includes(Buffer.from("RealisticTowTruck")), "tow-truck model must retain its asset root");
  assert.ok(towTruck.includes(Buffer.from("UTLTRUCK90_WheelStock_FL")), "tow-truck model must retain detailed wheel geometry");

  const scripts = (await readdir("dist/pages/assets")).filter((file) => file.endsWith(".js"));
  const javascript = (await Promise.all(scripts.map((file) => readFile(`dist/pages/assets/${file}`, "utf8")))).join("\n");
  assert.match(javascript, /realistic-usps-step-van\.glb/);
  assert.match(javascript, /realistic-box-truck\.glb/);
  assert.match(javascript, /realistic-passenger-fleet\.glb/);
  assert.doesNotMatch(javascript, /realistic-street-trees\.glb/, "retired tree pack should not be loaded at runtime");
  assert.match(javascript, /realistic-nyc-buildings\.glb/);
  assert.match(javascript, /realistic-city-bicycle\.glb/);
  assert.match(javascript, /realistic-transit-bus\.glb/);
  assert.match(javascript, /realistic-tow-truck\.glb/);
});

test("uses the U-Haul model's native mirrors instead of adding duplicates", async () => {
  const source = await readFile("app/BikeGame.tsx", "utf8");
  const loaderStart = source.indexOf("function loadRealisticBoxFleet");
  const loaderEnd = source.indexOf("function loadRealisticGarbageFleet", loaderStart);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, "expected the realistic U-Haul loader");

  const boxTruckLoader = source.slice(loaderStart, loaderEnd);
  assert.match(boxTruckLoader, /extractNativeMirrorMeshes\(/);
  assert.doesNotMatch(boxTruckLoader, /addSideMirrors\(/);
});

test("clones the rigged garbage truck with its own skeleton", async () => {
  const source = await readFile("app/BikeGame.tsx", "utf8");
  const loaderStart = source.indexOf("function loadRealisticGarbageFleet");
  const loaderEnd = source.indexOf("function loadRealisticTransitBusFleet", loaderStart);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, "expected the realistic garbage-truck loader");

  const garbageTruckLoader = source.slice(loaderStart, loaderEnd);
  assert.match(garbageTruckLoader, /cloneSkinnedModel\(template\)/);
  assert.doesNotMatch(garbageTruckLoader, /template\.clone\(true\)/);
});

test("keeps imported passenger cars upright while changing their heading", async () => {
  const source = await readFile("app/BikeGame.tsx", "utf8");
  const loaderStart = source.indexOf("function loadRealisticPassengerFleet");
  const loaderEnd = source.indexOf("function addPoliceCruiserMarkings", loaderStart);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, "expected the realistic passenger-car loader");

  const passengerLoader = source.slice(loaderStart, loaderEnd);
  assert.match(passengerLoader, /const template = new THREE\.Group\(\);[\s\S]*template\.add\(source\.clone\(true\)\);[\s\S]*template\.rotation\.y = Math\.PI;/);
  assert.doesNotMatch(passengerLoader, /source\.rotation\.y\s*[+]=/);
});

test("hides the bottom gameplay prompt on mobile", async () => {
  const css = await readFile("app/globals.css", "utf8");
  const mobileStart = css.indexOf("@media (pointer: coarse), (max-width: 820px)");
  const mobileEnd = css.indexOf("@media (max-width: 560px)", mobileStart);
  assert.ok(mobileStart >= 0 && mobileEnd > mobileStart, "expected the primary mobile rules");
  assert.match(css.slice(mobileStart, mobileEnd), /\.prompt\s*{\s*display:\s*none;\s*}/);
});

test("unlocks Web Audio from mobile gestures before starting music", async () => {
  const source = await readFile("app/BikeGame.tsx", "utf8");
  assert.match(source, /const resumeAudio = useCallback\(async \(\) =>[\s\S]*await audio\.context\.resume\(\)/);
  assert.match(source, /const begin = async \(\) =>[\s\S]*await resumeAudio\(\);[\s\S]*startMusic\(\)/);
  assert.match(source, /onPointerDownCapture={unlockAudioFromTouch}/);
});
