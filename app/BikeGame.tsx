"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

type Resolution = "BOOM!" | "VANISHED!" | "TICKETED!" | "TOWED!";
type ReportStatus = "reading" | "preparing" | "submitted";
type EvidenceReport = {
  caseId: string;
  confidence: number;
  photo: string;
  plate: string;
  status: ReportStatus;
  violation: string;
};
type Obstacle = {
  group: THREE.Group;
  z: number;
  kind: "bike-lane" | "crosswalk";
  plate: string;
  plates: THREE.Object3D[];
  active: boolean;
  resolving: boolean;
  resolution?: Resolution;
  timer: number;
  baseScale: number;
  helpers: THREE.Object3D[];
};

type FrameAssessment = {
  obstacle: Obstacle;
  plateInFrame: boolean;
  plateScore: number;
  vehicleInFrame: boolean;
};

type PedalRig = {
  leftCrank: THREE.Mesh;
  leftLower: THREE.Mesh;
  leftShoe: THREE.Mesh;
  leftUpper: THREE.Mesh;
  rightCrank: THREE.Mesh;
  rightLower: THREE.Mesh;
  rightShoe: THREE.Mesh;
  rightUpper: THREE.Mesh;
};

const LANE_X = 4.7;
const colors = {
  ink: 0x111820,
  mint: 0x397f68,
  coral: 0x8f3d38,
  cream: 0xd9d7cf,
  sky: 0x74818b,
  yellow: 0xd29a46,
  road: 0x262b2e,
};

const plateNumbers = [
  "A12-CYC",
  "B74-LNE",
  "C31-RDE",
  "D88-BKE",
  "E52-PDL",
  "F19-CAR",
  "G63-RDY",
  "H27-LAW",
  "J44-XWK",
  "K90-GRN",
  "L16-CAM",
  "M73-NYC",
  "N25-JST",
  "P48-RED",
  "R61-TKT",
  "S33-TOW",
];

function makeSurfaceTexture(
  base: string,
  flecks: string[],
  size = 512,
  repeats = new THREE.Vector2(2, 8),
) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);
  let seed = 7291;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 9000; i++) {
    const shade = flecks[Math.floor(random() * flecks.length)];
    const radius = 0.35 + random() * 1.7;
    context.globalAlpha = 0.18 + random() * 0.35;
    context.fillStyle = shade;
    context.beginPath();
    context.arc(random() * size, random() * size, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  for (let i = 0; i < 9; i++) {
    context.strokeStyle = i % 2 ? "rgba(10,12,13,.17)" : "rgba(255,255,255,.035)";
    context.lineWidth = 0.6 + random() * 1.3;
    context.beginPath();
    const x = random() * size;
    context.moveTo(x, -20);
    context.bezierCurveTo(x + 20, size * .3, x - 16, size * .65, x + 8, size + 20);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.copy(repeats);
  texture.anisotropy = 8;
  return texture;
}

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(
  radius: number,
  length: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 20),
    new THREE.MeshStandardMaterial({ color, roughness: 0.76 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function makePlateTexture(plateNumber: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 208;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#f4df71";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#151b20";
  context.lineWidth = 15;
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.fillStyle = "#172027";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "700 34px Arial, sans-serif";
  context.fillText("NEW JERSEY", canvas.width / 2, 43);
  context.font = "900 102px Arial, sans-serif";
  context.fillText(plateNumber, canvas.width / 2, 128);
  context.font = "700 23px Arial, sans-serif";
  context.fillText("GARDEN STATE", canvas.width / 2, 184);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeLicensePlate(plateNumber: string, z: number, facesRear: boolean) {
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.35),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x3c3619,
      emissiveIntensity: 0.16,
      map: makePlateTexture(plateNumber),
      roughness: 0.55,
      metalness: 0.02,
    }),
  );
  plate.position.set(0, 0.69, z);
  plate.rotation.y = facesRear ? 0 : Math.PI;
  plate.userData.isLicensePlate = true;
  plate.userData.plateNumber = plateNumber;
  return plate;
}

function alignSegment(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3) {
  const direction = end.clone().sub(start);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.set(1, direction.length(), 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

function makeBike() {
  const bike = new THREE.Group();
  const frame = new THREE.MeshPhysicalMaterial({ color: 0x273239, roughness: 0.24, metalness: 0.82, clearcoat: 0.48 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xa2a8aa, roughness: 0.3, metalness: 0.88 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x090b0c, roughness: 0.86 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9b694f, roughness: 0.78 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x293940, roughness: 0.88 });
  const denim = new THREE.MeshStandardMaterial({ color: 0x24384a, roughness: 0.92 });
  const shoeMaterial = new THREE.MeshStandardMaterial({ color: 0x171a1c, roughness: 0.8 });
  const helmetMaterial = new THREE.MeshPhysicalMaterial({ color: 0x121719, roughness: 0.32, metalness: 0.38, clearcoat: 0.5 });
  const up = new THREE.Vector3(0, 1, 0);

  const segment = (radius: number, material: THREE.Material, radialSegments = 10) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, radialSegments), material);
    mesh.castShadow = true;
    return mesh;
  };
  const tube = (parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) => {
    const mesh = segment(radius, material, radius < 0.01 ? 6 : 12);
    alignSegment(mesh, a, b);
    parent.add(mesh);
    return mesh;
  };

  const wheelCenters = [new THREE.Vector3(0, 0.54, -0.84), new THREE.Vector3(0, 0.54, 0.84)];
  for (const center of wheelCenters) {
    const wheel = new THREE.Group();
    wheel.position.copy(center);
    wheel.userData.isBikeWheel = true;
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.042, 12, 48), rubber);
    tire.rotation.y = Math.PI / 2;
    tire.castShadow = true;
    wheel.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.012, 8, 48), alloy);
    rim.rotation.y = Math.PI / 2;
    wheel.add(rim);
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const spokeEnd = new THREE.Vector3(0, Math.cos(angle) * 0.475, Math.sin(angle) * 0.475);
      tube(wheel, new THREE.Vector3(0, 0, 0), spokeEnd, 0.0045, alloy);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.19, 12), alloy);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    bike.add(wheel);
  }

  const rear = wheelCenters[1];
  const front = wheelCenters[0];
  const crank = new THREE.Vector3(0, 0.64, 0.19);
  const seatJoint = new THREE.Vector3(0, 1.05, 0.28);
  const headTop = new THREE.Vector3(0, 1.12, -0.55);
  const headBottom = new THREE.Vector3(0, 0.88, -0.47);
  tube(bike, rear, crank, 0.032, frame);
  tube(bike, rear, seatJoint, 0.029, frame);
  tube(bike, crank, seatJoint, 0.04, frame);
  tube(bike, seatJoint, headTop, 0.034, frame);
  tube(bike, crank, headBottom, 0.038, frame);
  tube(bike, headBottom, headTop, 0.043, frame);
  for (const x of [-0.048, 0.048]) tube(bike, new THREE.Vector3(x, 1.02, -0.51), new THREE.Vector3(x, 0.54, -0.84), 0.018, alloy);

  tube(bike, seatJoint, new THREE.Vector3(0, 1.2, 0.3), 0.024, alloy);
  const saddle = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.055, 0.39, 3, 0.045), rubber);
  saddle.position.set(0, 1.22, 0.34);
  saddle.rotation.x = -0.05;
  bike.add(saddle);
  tube(bike, headTop, new THREE.Vector3(0, 1.25, -0.61), 0.021, alloy);
  const handlebar = tube(bike, new THREE.Vector3(-0.36, 1.25, -0.66), new THREE.Vector3(0.36, 1.25, -0.66), 0.018, alloy);
  handlebar.castShadow = true;
  for (const x of [-0.36, 0.36]) {
    tube(bike, new THREE.Vector3(x, 1.25, -0.66), new THREE.Vector3(x, 1.2, -0.73), 0.022, rubber);
    const brake = box(0.035, 0.09, 0.018, 0x33383a, x, 1.2, -0.73);
    brake.rotation.x = -0.3;
    bike.add(brake);
  }

  const chainring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.011, 8, 32), alloy);
  chainring.position.copy(crank).setX(-0.055);
  chainring.rotation.y = Math.PI / 2;
  bike.add(chainring);
  const rearCog = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 8, 24), alloy);
  rearCog.position.copy(rear).setX(-0.06);
  rearCog.rotation.y = Math.PI / 2;
  bike.add(rearCog);
  tube(bike, new THREE.Vector3(-0.065, 0.77, 0.2), new THREE.Vector3(-0.065, 0.6, 0.84), 0.006, rubber);
  tube(bike, new THREE.Vector3(-0.065, 0.51, 0.2), new THREE.Vector3(-0.065, 0.48, 0.84), 0.006, rubber);

  const pelvis = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.22, 0.25, 4, 0.08), denim);
  pelvis.position.set(0, 1.27, 0.22);
  pelvis.rotation.x = 0.18;
  pelvis.castShadow = true;
  bike.add(pelvis);
  const hip = new THREE.Vector3(0, 1.3, 0.2);
  const shoulder = new THREE.Vector3(0, 1.82, -0.22);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.28, 8, 18), jacket);
  torso.position.copy(hip).add(shoulder).multiplyScalar(0.5);
  torso.quaternion.setFromUnitVectors(up, shoulder.clone().sub(hip).normalize());
  torso.scale.set(1, 1, 0.82);
  torso.castShadow = true;
  bike.add(torso);
  const shoulderLine = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.32, 6, 12), jacket);
  shoulderLine.position.copy(shoulder);
  shoulderLine.rotation.z = Math.PI / 2;
  bike.add(shoulderLine);
  tube(bike, new THREE.Vector3(0, 1.82, -0.23), new THREE.Vector3(0, 1.94, -0.28), 0.075, skin);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 28, 20), skin);
  head.scale.set(0.9, 1.08, 0.96);
  head.position.set(0, 2.06, -0.31);
  head.castShadow = true;
  bike.add(head);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), skin);
  nose.scale.set(0.72, 0.82, 1.15);
  nose.position.set(0, 2.065, -0.49);
  bike.add(nose);
  for (const x of [-0.073, 0.073]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), skin);
    ear.scale.set(0.45, 0.9, 0.75);
    ear.position.set(x < 0 ? -0.178 : 0.178, 2.065, -0.31);
    bike.add(ear);
  }
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.215, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), helmetMaterial);
  helmet.scale.set(0.94, 0.73, 1.06);
  helmet.position.set(0, 2.145, -0.31);
  helmet.rotation.x = -0.08;
  helmet.castShadow = true;
  bike.add(helmet);
  for (const x of [-0.095, 0, 0.095]) {
    const vent = new THREE.Mesh(new RoundedBoxGeometry(0.025, 0.018, 0.13, 2, 0.008), rubber);
    vent.position.set(x, 2.255 - Math.abs(x) * 0.2, -0.34);
    vent.rotation.x = -0.17;
    bike.add(vent);
  }

  const backpack = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.49, 0.18, 4, 0.075), new THREE.MeshStandardMaterial({ color: 0x171d20, roughness: 0.94 }));
  backpack.position.set(0, 1.58, 0.08);
  backpack.rotation.x = -0.66;
  backpack.castShadow = true;
  bike.add(backpack);
  for (const x of [-0.15, 0.15]) tube(bike, new THREE.Vector3(x, 1.76, -0.08), new THREE.Vector3(x, 1.39, 0.12), 0.018, rubber);

  const makeArm = (side: -1 | 1, raised = false) => {
    const armGroup = new THREE.Group();
    const shoulderPoint = new THREE.Vector3(side * 0.22, 1.78, -0.2);
    const elbowPoint = raised
      ? new THREE.Vector3(side * 0.34, 1.9, -0.38)
      : new THREE.Vector3(side * 0.3, 1.5, -0.43);
    const handPoint = raised
      ? new THREE.Vector3(side * 0.36, 2.03, -0.56)
      : new THREE.Vector3(side * 0.35, 1.24, -0.68);
    tube(armGroup, shoulderPoint, elbowPoint, 0.065, jacket);
    tube(armGroup, elbowPoint, handPoint, 0.052, skin);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10), skin);
    elbow.position.copy(elbowPoint);
    armGroup.add(elbow);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.061, 14, 10), skin);
    hand.scale.set(0.82, 0.72, 1.18);
    hand.position.copy(handPoint);
    armGroup.add(hand);
    return armGroup;
  };
  bike.add(makeArm(-1));
  const restingPhoneArm = makeArm(1);
  restingPhoneArm.userData.restingPhoneArm = true;
  bike.add(restingPhoneArm);

  const leftUpper = segment(0.075, denim, 14);
  const leftLower = segment(0.064, skin, 14);
  const rightUpper = segment(0.075, denim, 14);
  const rightLower = segment(0.064, skin, 14);
  const leftShoe = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.09, 0.29, 3, 0.045), shoeMaterial);
  const rightShoe = leftShoe.clone();
  [leftUpper, leftLower, rightUpper, rightLower, leftShoe, rightShoe].forEach((part) => {
    part.castShadow = true;
    bike.add(part);
  });
  const leftCrank = segment(0.012, alloy, 8);
  const rightCrank = segment(0.012, alloy, 8);
  bike.add(leftCrank, rightCrank);
  bike.userData.pedalRig = { leftCrank, leftLower, leftShoe, leftUpper, rightCrank, rightLower, rightShoe, rightUpper } satisfies PedalRig;

  const phoneRig = makeArm(1, true);
  const phoneBody = new THREE.Mesh(
    new RoundedBoxGeometry(0.16, 0.29, 0.025, 3, 0.025),
    new THREE.MeshPhysicalMaterial({ color: 0x090c0e, roughness: 0.2, metalness: 0.78 }),
  );
  phoneBody.position.set(0.38, 2.07, -0.59);
  phoneBody.rotation.set(-0.12, 0.1, -0.08);
  phoneRig.add(phoneBody);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 16), new THREE.MeshStandardMaterial({ color: 0x14222a, metalness: 0.8, roughness: 0.12 }));
  lens.position.set(0.34, 2.14, -0.606);
  lens.rotation.x = Math.PI / 2;
  phoneRig.add(lens);
  phoneRig.visible = false;
  phoneRig.scale.setScalar(0.001);
  bike.add(phoneRig);
  bike.userData.phoneRig = phoneRig;

  bike.position.set(LANE_X, 0, 4.45);
  bike.rotation.y = 0;
  bike.scale.setScalar(1.02);
  bike.traverse((object) => { object.userData.isBike = true; });
  return bike;
}

function makeCar(color = colors.coral, plateNumber = "A12-CYC") {
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.62, clearcoat: 0.55, clearcoatRoughness: 0.22 });
  const lower = new THREE.Mesh(new RoundedBoxGeometry(1.92, 0.58, 4.12, 5, 0.17), paint);
  lower.position.set(0, 0.74, 0);
  lower.castShadow = true;
  car.add(lower);
  const hood = new THREE.Mesh(new RoundedBoxGeometry(1.82, 0.3, 1.18, 4, 0.12), paint);
  hood.position.set(0, 1.03, -1.49);
  hood.rotation.x = -0.045;
  car.add(hood);
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.58, 0.72, 2.02, 5, 0.16), paint);
  cabin.position.set(0, 1.27, 0.12);
  cabin.scale.set(0.96, 1, 1);
  cabin.castShadow = true;
  car.add(cabin);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x263841, roughness: 0.18, metalness: 0.05, transmission: 0.05, transparent: true, opacity: 0.9 });
  const windshield = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.43, 0.055, 3, 0.03), glass);
  windshield.position.set(0, 1.39, -0.94);
  windshield.rotation.x = -0.38;
  car.add(windshield);
  const rearGlass = windshield.clone();
  rearGlass.position.z = 1.16;
  rearGlass.rotation.x = 0.32;
  car.add(rearGlass);
  for (const x of [-0.805, 0.805]) {
    const sideWindow = new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.39, 1.25, 2, 0.02), glass);
    sideWindow.position.set(x, 1.4, 0.1);
    car.add(sideWindow);
  }
  for (const x of [-0.91, 0.91]) {
    for (const z of [-1.32, 1.32]) {
      const wheel = cylinder(0.31, 0.2, 0x090a0b, x, 0.48, z);
      wheel.rotation.z = Math.PI / 2;
      car.add(wheel);
      const rim = cylinder(0.17, 0.205, 0x777d80, x, 0.48, z);
      rim.rotation.z = Math.PI / 2;
      car.add(rim);
    }
  }
  for (const x of [-0.62, 0.62]) {
    const headlight = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.16, 0.055, 2, 0.025), new THREE.MeshStandardMaterial({ color: 0xe3e0c9, emissive: 0xb89b65, emissiveIntensity: 0.35 }));
    headlight.position.set(x, 0.83, -2.08);
    car.add(headlight);
    const tail = headlight.clone();
    (tail.material as THREE.MeshStandardMaterial).color.setHex(0x7c1d1d);
    (tail.material as THREE.MeshStandardMaterial).emissive.setHex(0x611010);
    tail.position.z = 2.08;
    car.add(tail);
  }
  const frontPlateBacking = box(0.94, 0.43, 0.035, 0x171b1d, 0, 0.69, -2.105);
  const rearPlateBacking = box(0.94, 0.43, 0.035, 0x171b1d, 0, 0.69, 2.105);
  car.add(frontPlateBacking, rearPlateBacking);
  const frontPlate = makeLicensePlate(plateNumber, -2.126, false);
  const rearPlate = makeLicensePlate(plateNumber, 2.126, true);
  car.add(frontPlate, rearPlate);
  car.userData.plateNumber = plateNumber;
  car.userData.plateMeshes = [frontPlate, rearPlate];
  car.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return car;
}

type FleetKind = "amazon" | "usps" | "box";

function makeFleetPanelTexture(kind: FleetKind) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 220;
  const ctx = canvas.getContext("2d")!;
  if (kind === "amazon") {
    ctx.fillStyle = "#182735";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#63bde6";
    ctx.font = "700 96px Arial";
    ctx.textAlign = "center";
    ctx.fillText("prime", 384, 122);
    ctx.strokeStyle = "#f2a12b";
    ctx.lineWidth = 15;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(285, 155);
    ctx.quadraticCurveTo(395, 205, 505, 151);
    ctx.stroke();
  } else if (kind === "usps") {
    ctx.fillStyle = "#f3f4f1";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#24528a";
    ctx.fillRect(0, 28, canvas.width, 48);
    ctx.fillStyle = "#bd2d38";
    ctx.fillRect(0, 82, canvas.width, 14);
    ctx.fillStyle = "#173e72";
    ctx.font = "800 76px Arial";
    ctx.textAlign = "center";
    ctx.fillText("USPS", 384, 181);
  } else {
    ctx.fillStyle = "#e7e3d9";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#26333a";
    ctx.font = "800 68px Arial";
    ctx.textAlign = "center";
    ctx.fillText("CITY FREIGHT", 384, 103);
    ctx.font = "600 35px Arial";
    ctx.fillText("LOCAL DELIVERY", 384, 163);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function addCommercialWheels(vehicle: THREE.Group, wheelZ: number[]) {
  for (const x of [-1.03, 1.03]) for (const z of wheelZ) {
    const tire = cylinder(0.36, 0.22, 0x090b0c, x, 0.47, z);
    tire.rotation.z = Math.PI / 2;
    vehicle.add(tire);
    const rim = cylinder(0.19, 0.225, 0x8b9294, x, 0.47, z);
    rim.rotation.z = Math.PI / 2;
    vehicle.add(rim);
  }
}

function addFleetPanels(vehicle: THREE.Group, kind: FleetKind, y: number, z: number, width: number, height: number, sideX: number) {
  const texture = makeFleetPanelTexture(kind);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72, metalness: 0.02 });
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    panel.position.set(side * sideX, y, z);
    panel.rotation.y = side * Math.PI / 2;
    vehicle.add(panel);
  }
}

function makeDeliveryVan(kind: "amazon" | "usps", plateNumber: string) {
  const van = new THREE.Group();
  const isAmazon = kind === "amazon";
  const bodyColor = isAmazon ? 0x172633 : 0xefefeb;
  const paint = new THREE.MeshPhysicalMaterial({ color: bodyColor, roughness: 0.4, metalness: 0.35, clearcoat: 0.25 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(2.08, isAmazon ? 1.96 : 1.62, 4.62, 5, isAmazon ? 0.24 : 0.17), paint);
  body.position.set(0, isAmazon ? 1.36 : 1.2, 0);
  body.castShadow = true;
  van.add(body);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(2.02, 0.18, 4.25, 3, 0.08), paint);
  roof.position.set(0, isAmazon ? 2.39 : 2.08, 0.05);
  van.add(roof);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x29434e, roughness: 0.16, metalness: 0.08, transparent: true, opacity: 0.92 });
  const windshield = new THREE.Mesh(new RoundedBoxGeometry(1.72, isAmazon ? 0.82 : 0.66, 0.06, 3, 0.035), glass);
  windshield.position.set(0, isAmazon ? 1.82 : 1.62, -2.31);
  windshield.rotation.x = -0.08;
  van.add(windshield);
  for (const side of [-1, 1]) {
    const sideWindow = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.58, 0.83, 3, 0.035), glass);
    sideWindow.position.set(side * 1.045, isAmazon ? 1.82 : 1.63, -1.47);
    van.add(sideWindow);
  }
  addFleetPanels(van, kind, isAmazon ? 1.55 : 1.38, 0.52, 2.45, isAmazon ? 0.88 : 0.72, 1.046);
  addCommercialWheels(van, [-1.45, 1.45]);
  for (const x of [-0.73, 0.73]) {
    const light = new THREE.Mesh(
      new RoundedBoxGeometry(isAmazon ? 0.13 : 0.34, isAmazon ? 0.64 : 0.16, 0.05, 2, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xf1eee0, emissive: 0xc9b98d, emissiveIntensity: 0.52 }),
    );
    light.position.set(x, isAmazon ? 1.02 : 0.83, -2.33);
    van.add(light);
  }
  const frontPlate = makeLicensePlate(plateNumber, -2.355, false);
  frontPlate.position.y = 0.68;
  const rearPlate = makeLicensePlate(plateNumber, 2.355, true);
  rearPlate.position.y = 0.68;
  van.add(frontPlate, rearPlate);
  van.userData.plateNumber = plateNumber;
  van.userData.plateMeshes = [frontPlate, rearPlate];
  return van;
}

function makeBoxTruck(plateNumber: string) {
  const truck = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xe1ddd2, roughness: 0.68, metalness: 0.18 });
  const cab = new THREE.Mesh(new RoundedBoxGeometry(2.12, 1.48, 1.85, 4, 0.13), new THREE.MeshPhysicalMaterial({ color: 0xd7d8d4, roughness: 0.42, metalness: 0.32 }));
  cab.position.set(0, 1.13, -1.72);
  cab.castShadow = true;
  truck.add(cab);
  const cargo = new THREE.Mesh(new RoundedBoxGeometry(2.18, 2.28, 3.5, 3, 0.08), white);
  cargo.position.set(0, 1.55, 0.88);
  cargo.castShadow = true;
  truck.add(cargo);
  const windshield = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.61, 0.06, 3, 0.03), new THREE.MeshPhysicalMaterial({ color: 0x29414a, roughness: 0.18, transparent: true, opacity: 0.92 }));
  windshield.position.set(0, 1.54, -2.67);
  windshield.rotation.x = -0.1;
  truck.add(windshield);
  addFleetPanels(truck, "box", 1.65, 0.87, 2.7, 0.86, 1.096);
  addCommercialWheels(truck, [-1.78, 1.18]);
  const frontPlate = makeLicensePlate(plateNumber, -2.705, false);
  frontPlate.position.y = 0.67;
  const rearPlate = makeLicensePlate(plateNumber, 2.66, true);
  rearPlate.position.y = 0.67;
  truck.add(frontPlate, rearPlate);
  truck.userData.plateNumber = plateNumber;
  truck.userData.plateMeshes = [frontPlate, rearPlate];
  return truck;
}

function makeWorld(scene: THREE.Scene) {
  const movers: THREE.Group[] = [];
  const asphalt = makeSurfaceTexture("#292d2f", ["#121516", "#6b6a64", "#414547", "#88857d"], 512, new THREE.Vector2(2.2, 9));
  const laneTexture = makeSurfaceTexture("#39755f", ["#245343", "#82988b", "#172d27", "#547f6e"], 512, new THREE.Vector2(1.2, 10));
  const concrete = makeSurfaceTexture("#8e8e88", ["#575b5a", "#c5c2b9", "#6c6d68"], 512, new THREE.Vector2(1, 8));
  const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, bumpMap: asphalt, bumpScale: 0.035, color: 0x808080, roughness: 0.94 });
  const laneMat = new THREE.MeshStandardMaterial({ map: laneTexture, bumpMap: laneTexture, bumpScale: 0.015, color: 0x8e9d96, roughness: 0.91 });
  const curbMat = new THREE.MeshStandardMaterial({ map: concrete, bumpMap: concrete, bumpScale: 0.025, color: 0xd0cdc5, roughness: 0.96 });
  const facadeColors = [0x6f6259, 0x7c5145, 0x5f686b, 0x81786d, 0x4e595f, 0x755e50];
  const windowMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x25343c, roughness: 0.24, metalness: 0.38 }),
    new THREE.MeshStandardMaterial({ color: 0xb6854d, emissive: 0x8a5724, emissiveIntensity: 0.45, roughness: 0.35 }),
  ];

  for (let i = 0; i < 10; i++) {
    const segment = new THREE.Group();
    segment.position.z = -i * 38;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(17, 38), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0;
    road.receiveShadow = true;
    segment.add(road);
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 38), laneMat);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(LANE_X, 0.012, 0);
    lane.receiveShadow = true;
    segment.add(lane);
    for (const x of [3.1, 6.3]) {
      const line = box(0.095, 0.024, 38, 0xc9c4b8, x, 0.035, 0);
      (line.material as THREE.MeshStandardMaterial).roughness = 0.92;
      segment.add(line);
    }
    for (let z = -14; z <= 14; z += 9) segment.add(box(0.11, 0.028, 3.7, 0xb8b5ad, 0, 0.04, z));
    for (const x of [-9.8, 9.8]) {
      const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.24, 38), curbMat);
      sidewalk.position.set(x, 0.11, 0);
      sidewalk.receiveShadow = true;
      segment.add(sidewalk);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.4, 38), curbMat);
      curb.position.set(x > 0 ? 8.48 : -8.48, 0.2, 0);
      curb.receiveShadow = true;
      segment.add(curb);
    }

    for (const side of [-1, 1]) {
      for (let b = 0; b < 3; b++) {
        const width = 4.5 + ((i + b) % 3) * 0.9;
        const height = 7 + ((i * 7 + b * 5) % 10);
        const z = -13 + b * 13;
        const x = side * (12 + (b % 2) * 1.1);
        const facade = facadeColors[(i + b + (side > 0 ? 2 : 0)) % facadeColors.length];
        const building = box(width, height, 9.2, facade, x, height / 2, z);
        (building.material as THREE.MeshStandardMaterial).roughness = 0.9;
        segment.add(building);
        const frontZ = z + (side < 0 ? 4.64 : -4.64);
        for (let wy = 1.65; wy < height - 0.7; wy += 1.75) {
          for (const wx of [-1.35, 0, 1.35]) {
            const lit = (i + b + Math.round(wy) + (wx === 0 ? 1 : 0)) % 4 === 0;
            const window = new THREE.Mesh(new RoundedBoxGeometry(0.64, 0.82, 0.06, 2, 0.025), windowMaterials[lit ? 1 : 0]);
            window.position.set(x + wx, wy, frontZ);
            segment.add(window);
          }
        }
        const cornice = box(width + 0.15, 0.18, 9.35, 0x4a4c4b, x, height + 0.05, z);
        segment.add(cornice);
        if ((i + b) % 3 === 0) {
          const fireEscape = box(width * 0.63, 0.045, 0.55, 0x252b2e, x, 4.3, frontZ + (side < 0 ? 0.34 : -0.34));
          segment.add(fireEscape);
        }
      }
      for (const tz of [-14, 2, 16]) {
        const trunk = cylinder(0.095, 1.7, 0x4c382c, side * 9.05, 0.96, tz);
        segment.add(trunk);
        const crown = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.82, 2),
          new THREE.MeshStandardMaterial({ color: 0x364d3f, roughness: 0.98 }),
        );
        crown.scale.set(1, 1.25, 1);
        crown.position.set(side * 9.05, 2.18, tz);
        crown.castShadow = true;
        segment.add(crown);
      }
      for (const lz of [-9, 11]) {
        const pole = cylinder(0.045, 4.7, 0x303638, side * 8.85, 2.45, lz);
        segment.add(pole);
        const arm = cylinder(0.035, 1.2, 0x303638, side * 8.35, 4.72, lz);
        arm.rotation.z = Math.PI / 2;
        segment.add(arm);
        const lamp = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.12, 0.22, 2, 0.04), new THREE.MeshStandardMaterial({ color: 0x464b4c, emissive: 0xd8a45d, emissiveIntensity: 0.85 }));
        lamp.position.set(side * 7.8, 4.68, lz);
        segment.add(lamp);
      }
    }
    if (i === 3 || i === 7) {
      segment.userData.isIntersection = true;
      for (let x = -7.4; x <= 7.4; x += 1.05) {
        const stripe = box(0.62, 0.032, 2.35, 0xc9c7bf, x, 0.045, 0);
        (stripe.material as THREE.MeshStandardMaterial).roughness = 0.96;
        segment.add(stripe);
      }
      segment.add(box(16.1, 0.034, 0.22, 0xd8d5cc, 0, 0.048, 3.65));
      for (const side of [-1, 1]) {
        const signal = new THREE.Group();
        signal.position.set(side * 7.45, 0, 4.2);
        signal.add(cylinder(0.065, 4.9, 0x262c2f, 0, 2.48, 0));
        const signalArm = cylinder(0.055, 3.35, 0x262c2f, -side * 1.55, 4.85, 0);
        signalArm.rotation.z = Math.PI / 2;
        signal.add(signalArm);
        const housing = new THREE.Mesh(new RoundedBoxGeometry(0.42, 1.05, 0.35, 3, 0.07), new THREE.MeshStandardMaterial({ color: 0x151a1c, roughness: 0.72 }));
        housing.position.set(-side * 3.1, 4.34, 0);
        signal.add(housing);
        for (const [name, y, color] of [["red", 4.63, 0x551313], ["amber", 4.34, 0x5f4918], ["green", 4.05, 0x173d2b]] as const) {
          const lamp = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 20, 14),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.12 }),
          );
          lamp.position.set(-side * 3.1, y, -0.18);
          lamp.userData.signal = name;
          signal.add(lamp);
        }
        segment.add(signal);
      }
    }
    if (i % 2 === 0 && i !== 3 && i !== 7) {
      const parked = makeCar(i % 4 === 0 ? 0x3c454a : 0x665d55, plateNumbers[(i + 11) % plateNumbers.length]);
      parked.scale.setScalar(0.92);
      parked.position.set(-6.7, 0.02, -6 + (i % 3) * 6);
      segment.add(parked);
    }
    scene.add(segment);
    movers.push(segment);
  }

  return movers;
}

function makeObstacle(z: number, index: number, kind: Obstacle["kind"] = "bike-lane"): Obstacle {
  const plate = kind === "crosswalk" ? "X31-WLK" : plateNumbers[index % plateNumbers.length];
  const group = makeCar([0x6a2626, 0x756d61, 0x2f4857, 0x4e4f51][index % 4], plate);
  group.position.set(kind === "bike-lane" ? LANE_X + (index % 2 ? -0.22 : 0.18) : 1.2, 0, z);
  group.rotation.y = Math.PI;
  group.visible = kind === "bike-lane";
  return {
    group,
    z,
    kind,
    plate,
    plates: group.userData.plateMeshes as THREE.Object3D[],
    active: kind === "bike-lane",
    resolving: false,
    timer: 0,
    baseScale: 1,
    helpers: [],
  };
}

type TrafficCar = { group: THREE.Group; z: number; speed: number; direction: 1 | -1; halfLength: number; lane: number };

function makeTraffic(scene: THREE.Scene) {
  const lanes = [-5.1, -2.0, 1.2];
  const traffic: TrafficCar[] = [];
  const fleet: Array<"car" | "box" | "amazon" | "usps"> = ["car", "car", "box", "car", "amazon", "car", "usps", "car", "box", "amazon", "usps"];
  for (let i = 0; i < 11; i++) {
    const direction: 1 | -1 = i % 4 === 0 ? -1 : 1;
    const lane = lanes[i % lanes.length];
    const kind = fleet[i];
    const plate = plateNumbers[(i + 5) % plateNumbers.length];
    const group = kind === "box"
      ? makeBoxTruck(plate)
      : kind === "amazon" || kind === "usps"
        ? makeDeliveryVan(kind, plate)
        : makeCar([0x24282a, 0x5f6364, 0x394b56, 0x70685c, 0x5a2f2d][i % 5], plate);
    const halfLength = kind === "box" ? 2.75 : kind === "amazon" || kind === "usps" ? 2.35 : 2.05;
    if (kind === "car") group.scale.setScalar(0.9 + (i % 3) * 0.025);
    group.position.set(lane, 0, -22 - i * 27);
    group.rotation.y = direction === 1 ? Math.PI : 0;
    scene.add(group);
    const speed = kind === "box" ? 3.85 : kind === "amazon" || kind === "usps" ? 4.35 : 4.8 + (i % 3) * 0.62;
    traffic.push({ group, z: group.position.z, speed, direction, halfLength, lane });
  }
  return traffic;
}

function makeTowTruck() {
  const truck = new THREE.Group();
  truck.add(new THREE.Mesh(new RoundedBoxGeometry(2.25, 0.78, 3.3, 4, 0.12), new THREE.MeshPhysicalMaterial({ color: 0x9a6c2f, roughness: 0.4, metalness: 0.38 })));
  truck.children[0].position.set(0, 0.75, 0);
  truck.add(new THREE.Mesh(new RoundedBoxGeometry(2.08, 1.14, 1.35, 4, 0.1), new THREE.MeshStandardMaterial({ color: 0xc0beb7, roughness: 0.58 })));
  truck.children[1].position.set(0, 1.38, -0.9);
  const boom = box(0.13, 0.13, 3.2, 0x252a2c, 0, 1.55, 0.7);
  boom.rotation.x = -0.42;
  truck.add(boom);
  for (const x of [-1.04, 1.04]) for (const z of [-1.1, 1.1]) {
    const wheel = cylinder(0.31, 0.2, colors.ink, x, 0.42, z);
    wheel.rotation.z = Math.PI / 2;
    truck.add(wheel);
  }
  return truck;
}

function makeSkyDome() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x718da1) },
      horizonColor: { value: new THREE.Color(0xd2bba5) },
      bottomColor: { value: new THREE.Color(0x98a4aa) },
    },
    vertexShader: `varying vec3 vPosition; void main(){ vPosition = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vPosition; uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 bottomColor; void main(){ float h=normalize(vPosition).y; vec3 c=h>0.0?mix(horizonColor,topColor,smoothstep(0.0,.72,h)):mix(horizonColor,bottomColor,smoothstep(0.0,-.35,h)); gl_FragColor=vec4(c,1.0); }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(220, 32, 16), material);
}

function BikeGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const phoneMountRef = useRef<HTMLDivElement>(null);
  const phonePanRef = useRef({ yaw: 0, pitch: 0 });
  const phoneDragRef = useRef({ active: false, x: 0, y: 0 });
  const motionAimRef = useRef({
    enabled: false,
    baseBeta: null as number | null,
    baseGamma: null as number | null,
    lastBeta: null as number | null,
    lastGamma: null as number | null,
    anchorYaw: 0,
    anchorPitch: 0,
  });
  const runtimeRef = useRef<{
    started: boolean;
    phone: boolean;
    keys: Set<string>;
    snap: () => void;
    togglePhone: () => void;
    resetRide: () => void;
  } | null>(null);
  const [started, setStarted] = useState(false);
  const [phone, setPhone] = useState(false);
  const [locked, setLocked] = useState(false);
  const [vehicleFramed, setVehicleFramed] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [streak, setStreak] = useState(0);
  const [prompt, setPrompt] = useState("RIDE THE BIKE LANE");
  const [feed, setFeed] = useState<{ title: string; text: string } | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [report, setReport] = useState<EvidenceReport | null>(null);
  const [crashed, setCrashed] = useState(false);
  const [motionAim, setMotionAim] = useState<"off" | "on" | "denied" | "unsupported">("off");

  const beep = useCallback((frequency = 620, length = 0.08) => {
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioCtx();
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.035, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + length);
      osc.connect(gain).connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + length);
    } catch { /* sound is optional */ }
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    const phoneMount = phoneMountRef.current;
    if (!mount || !phoneMount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x94a5af);
    scene.fog = new THREE.Fog(0x8999a2, 58, 165);
    scene.add(makeSkyDome());
    const camera = new THREE.PerspectiveCamera(64, mount.clientWidth / mount.clientHeight, 0.1, 260);
    camera.position.set(LANE_X + 0.4, 3.35, 8.8);
    camera.lookAt(LANE_X, 1.15, -15);
    const phoneCamera = new THREE.PerspectiveCamera(
      62,
      Math.max(phoneMount.clientWidth, 1) / Math.max(phoneMount.clientHeight, 1),
      0.1,
      180,
    );
    phoneCamera.position.set(LANE_X + 0.34, 2.14, 3.84);
    phoneCamera.rotation.order = "YXZ";
    phoneCamera.rotation.set(-0.046, 0.0095, 0);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const phoneRenderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    phoneRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    phoneRenderer.setSize(Math.max(phoneMount.clientWidth, 1), Math.max(phoneMount.clientHeight, 1));
    phoneRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    phoneRenderer.toneMappingExposure = 1.2;
    phoneRenderer.outputColorSpace = THREE.SRGBColorSpace;
    phoneMount.appendChild(phoneRenderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe6eef1, 0x4c5354, 2.1));
    scene.add(new THREE.AmbientLight(0xdde5e8, 0.28));
    const sun = new THREE.DirectionalLight(0xffe2bc, 3.05);
    sun.position.set(-22, 28, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -10;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc8deee, 0.82);
    fill.position.set(16, 14, 10);
    scene.add(fill);

    const world = makeWorld(scene);
    const intersections = world.filter((segment) => segment.userData.isIntersection);
    const signalLamps: THREE.Mesh[] = [];
    intersections.forEach((segment) => segment.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.signal) signalLamps.push(object);
    }));
    const bike = makeBike();
    scene.add(bike);
    const pedalRig = bike.userData.pedalRig as PedalRig;
    const updatePedaling = (angle: number) => {
      const crankCenter = new THREE.Vector3(0, 0.64, 0.19);
      const placeLeg = (side: -1 | 1, phase: number, upper: THREE.Mesh, lower: THREE.Mesh, shoe: THREE.Mesh, crankArm: THREE.Mesh) => {
        const hip = new THREE.Vector3(side * 0.13, 1.3, 0.2);
        const pedal = new THREE.Vector3(
          side * 0.17,
          crankCenter.y + Math.cos(phase) * 0.17,
          crankCenter.z + Math.sin(phase) * 0.17,
        );
        const knee = hip.clone().lerp(pedal, 0.5);
        knee.y += 0.12;
        knee.z -= 0.17;
        alignSegment(upper, hip, knee);
        alignSegment(lower, knee, pedal);
        alignSegment(crankArm, new THREE.Vector3(side * 0.055, crankCenter.y, crankCenter.z), pedal);
        shoe.position.copy(pedal).add(new THREE.Vector3(0, 0.015, -0.055));
        shoe.rotation.set(-0.08 + Math.sin(phase) * 0.1, 0, 0);
      };
      placeLeg(-1, angle, pedalRig.leftUpper, pedalRig.leftLower, pedalRig.leftShoe, pedalRig.leftCrank);
      placeLeg(1, angle + Math.PI, pedalRig.rightUpper, pedalRig.rightLower, pedalRig.rightShoe, pedalRig.rightCrank);
    };
    let pedalPhase = 0;
    updatePedaling(pedalPhase);
    const renderPhoneCamera = () => {
      const bikeWasVisible = bike.visible;
      bike.visible = false;
      phoneRenderer.render(scene, phoneCamera);
      bike.visible = bikeWasVisible;
    };
    const traffic = makeTraffic(scene);
    const obstacles: Obstacle[] = [0, 1, 2, 3, 4].map((_, i) => makeObstacle(-46 - i * 63, i));
    const crosswalkViolation = makeObstacle(-114, 7, "crosswalk");
    obstacles.push(crosswalkViolation);
    obstacles.forEach((o) => scene.add(o.group));
    const keys = new Set<string>();
    let desiredSpeed = 8.2;
    let actualSpeed = 0;
    let meters = 0;
    let scoreStreak = 0;
    let lastUi = 0;
    let bikeX = LANE_X;
    let nearest: Obstacle | null = null;
    let currentAssessment: FrameAssessment | null = null;
    let phoneOpen = false;
    let running = false;
    let signalRed = true;
    let crosswalkCooldown = 3;
    let flashTimer = 0;
    const clock = new THREE.Clock();
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
    const reportTimers: number[] = [];

    const resetMotionBaseline = () => {
      const motion = motionAimRef.current;
      motion.baseBeta = null;
      motion.baseGamma = null;
      motion.anchorYaw = phonePanRef.current.yaw;
      motion.anchorPitch = phonePanRef.current.pitch;
    };

    const deviceOrientation = (event: DeviceOrientationEvent) => {
      const motion = motionAimRef.current;
      if (!motion.enabled || event.beta === null || event.gamma === null) return;
      motion.lastBeta = event.beta;
      motion.lastGamma = event.gamma;
      if (motion.baseBeta === null || motion.baseGamma === null) {
        motion.baseBeta = event.beta;
        motion.baseGamma = event.gamma;
        motion.anchorYaw = phonePanRef.current.yaw;
        motion.anchorPitch = phonePanRef.current.pitch;
        return;
      }
      if (phoneDragRef.current.active) return;
      const angleDelta = (value: number, baseline: number) => ((value - baseline + 540) % 360) - 180;
      phonePanRef.current.yaw = THREE.MathUtils.clamp(
        motion.anchorYaw + THREE.MathUtils.degToRad(angleDelta(event.gamma, motion.baseGamma)) * 0.82,
        -0.62,
        0.62,
      );
      phonePanRef.current.pitch = THREE.MathUtils.clamp(
        motion.anchorPitch + THREE.MathUtils.degToRad(angleDelta(event.beta, motion.baseBeta)) * 0.68,
        -0.38,
        0.38,
      );
    };
    window.addEventListener("deviceorientation", deviceOrientation, true);

    const addBurst = (origin: THREE.Vector3) => {
      for (let i = 0; i < 24; i++) {
        const mesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.11 + Math.random() * 0.2, 0),
          new THREE.MeshBasicMaterial({ color: [colors.yellow, colors.coral, colors.cream][i % 3] }),
        );
        mesh.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + Math.random(), (Math.random() - 0.5) * 1.2));
        scene.add(mesh);
        particles.push({
          mesh,
          velocity: new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6),
          life: 1 + Math.random() * 0.7,
        });
      }
    };

    const assessObstacle = (obstacle: Obstacle): FrameAssessment => {
      const center = obstacle.group.getWorldPosition(new THREE.Vector3()).project(phoneCamera);
      const vehicleInFrame = center.z > -1 && center.z < 1
        && Math.abs(center.x) < 0.92
        && Math.abs(center.y) < 0.72;
      let plateInFrame = false;
      let plateScore = Number.POSITIVE_INFINITY;

      for (const plateMesh of obstacle.plates) {
        plateMesh.updateWorldMatrix(true, false);
        const plateWorld = plateMesh.getWorldPosition(new THREE.Vector3());
        const plateNdc = plateWorld.clone().project(phoneCamera);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
          plateMesh.getWorldQuaternion(new THREE.Quaternion()),
        );
        const towardCamera = phoneCamera.position.clone().sub(plateWorld).normalize();
        const facingCamera = normal.dot(towardCamera) > 0.08;
        const leftEdge = new THREE.Vector3(-0.43, 0, 0).applyMatrix4(plateMesh.matrixWorld).project(phoneCamera);
        const rightEdge = new THREE.Vector3(0.43, 0, 0).applyMatrix4(plateMesh.matrixWorld).project(phoneCamera);
        const projectedWidth = Math.abs(rightEdge.x - leftEdge.x);
        const inPhoto = facingCamera
          && plateNdc.z > -1 && plateNdc.z < 1
          && Math.abs(plateNdc.x) < 0.88
          && Math.abs(plateNdc.y) < 0.74;
        if (!inPhoto) continue;

        const score = plateNdc.x * plateNdc.x + plateNdc.y * plateNdc.y;
        plateScore = Math.min(plateScore, score);
        if (
          Math.abs(plateNdc.x) < 0.39
          && Math.abs(plateNdc.y) < 0.34
          && projectedWidth > 0.012
          && plateWorld.distanceTo(phoneCamera.position) < 42
        ) {
          plateInFrame = true;
        }
      }

      if (!Number.isFinite(plateScore)) {
        plateScore = 2 + center.x * center.x + center.y * center.y;
      }
      return { obstacle, plateInFrame, plateScore, vehicleInFrame };
    };

    const getTargetAssessment = () => {
      scene.updateMatrixWorld(true);
      phoneCamera.updateMatrixWorld(true);
      const assessments = obstacles
        .filter((obstacle) => obstacle.active && obstacle.z > -40 && obstacle.z < 3)
        .map(assessObstacle)
        .filter((assessment) => assessment.vehicleInFrame || assessment.plateScore < 2);
      const crosswalkReady = assessments.find(
        (assessment) => assessment.obstacle.kind === "crosswalk" && assessment.plateInFrame,
      );
      if (crosswalkReady) return crosswalkReady;
      return assessments.sort((a, b) => {
        if (a.plateInFrame !== b.plateInFrame) return a.plateInFrame ? -1 : 1;
        return a.plateScore - b.plateScore;
      })[0] ?? null;
    };

    const resolveObstacle = (obstacle: Obstacle) => {
      const options: Resolution[] = obstacle.kind === "crosswalk"
        ? ["TICKETED!", "TOWED!"]
        : ["BOOM!", "VANISHED!", "TICKETED!", "TOWED!"];
      const resolution = options[Math.floor(Math.random() * options.length)];
      obstacle.resolution = resolution;
      obstacle.resolving = true;
      obstacle.active = false;
      obstacle.timer = 0;
      const points = obstacle.kind === "crosswalk" ? 3 : 1;
      scoreStreak += points;
      setStreak(scoreStreak);
      if (obstacle.kind === "crosswalk") crosswalkCooldown = 18;
      setFeed({
        title: obstacle.kind === "crosswalk" ? `CROSSWALK +${points}` : resolution,
        text: obstacle.kind === "crosswalk" ? "RED LIGHT. VEHICLE PAST THE STOP LINE."
          : resolution === "BOOM!" ? "OBSTRUCTION CLEARED."
          : resolution === "VANISHED!" ? "VEHICLE REMOVED FROM THE LANE."
          : resolution === "TICKETED!" ? "CITATION ISSUED. BIKE LANE CLEAR."
          : "TOW DISPATCHED. CONTINUE WHEN CLEAR.",
      });
      setTimeout(() => setFeed(null), 2600);
      addBurst(obstacle.group.position.clone());

      if (resolution === "TICKETED!") {
        const cop = new THREE.Group();
        cop.add(cylinder(0.28, 0.75, 0x2854a4, 0, 0.75, 0));
        cop.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: 0x9a5f42 })));
        cop.children[1].position.set(0, 1.25, 0);
        cop.add(box(0.65, 0.07, 0.9, colors.cream, 0, 0.42, 0));
        cop.position.copy(obstacle.group.position).add(new THREE.Vector3(-6, 0, 0));
        scene.add(cop);
        obstacle.helpers.push(cop);
        const ticket = box(0.42, 0.03, 0.62, colors.yellow, 0, 1.36, -1.94);
        ticket.visible = false;
        obstacle.group.add(ticket);
        obstacle.helpers.push(ticket);
      }
      if (resolution === "TOWED!") {
        const tow = makeTowTruck();
        tow.position.copy(obstacle.group.position).add(new THREE.Vector3(-8, 0, 1.2));
        scene.add(tow);
        obstacle.helpers.push(tow);
      }
    };

    const beginAutoReport = (obstacle: Obstacle) => {
      obstacle.active = false;
      obstacle.resolving = true;
      obstacle.timer = 0;
      renderPhoneCamera();
      let photo = "";
      try {
        photo = phoneRenderer.domElement.toDataURL("image/jpeg", 0.88);
      } catch { /* evidence thumbnail is optional if canvas export is unavailable */ }
      const violation = obstacle.kind === "crosswalk"
        ? "Vehicle beyond stop line in crosswalk during red"
        : "Vehicle obstructing marked bicycle lane";
      const caseId = `LJ-${Date.now().toString().slice(-7)}`;
      setReport({
        caseId,
        confidence: 0,
        photo,
        plate: "SCANNING…",
        status: "reading",
        violation,
      });
      setFeed({ title: "ALPR SCANNING", text: "READING THE PLATE FROM YOUR PHOTO." });

      reportTimers.push(window.setTimeout(() => {
        setReport((current) => current ? {
          ...current,
          confidence: 94 + Math.floor(Math.random() * 5),
          plate: obstacle.plate,
          status: "preparing",
        } : current);
        setFeed({ title: `PLATE ${obstacle.plate}`, text: "REPORT FORM COMPLETED. AUTO-SUBMITTING…" });
      }, 680));

      reportTimers.push(window.setTimeout(() => {
        setReport((current) => current ? { ...current, status: "submitted" } : current);
        resolveObstacle(obstacle);
      }, 1450));

      reportTimers.push(window.setTimeout(() => setReport(null), 5200));
    };

    const snap = () => {
      if (!running) return;
      if (!phoneOpen) {
        phoneOpen = true;
        phonePanRef.current = { yaw: 0, pitch: 0 };
        resetMotionBaseline();
        setPhone(true);
        beep(410, 0.07);
        return;
      }
      setFlashing(true);
      window.setTimeout(() => setFlashing(false), 430);
      beep(980, 0.1);
      const assessment = getTargetAssessment();
      const target = assessment?.obstacle ?? null;
      if (target && assessment?.plateInFrame) {
        beginAutoReport(target);
        phoneOpen = false;
        setPhone(false);
        setLocked(false);
        setVehicleFramed(false);
        setPrompt("EVIDENCE CAPTURED — ALPR RUNNING");
      } else if (target && assessment?.vehicleInFrame) {
        setFeed({
          title: "PLATE NOT READABLE",
          text: "MAKE SURE THE LICENSE PLATE IS INSIDE THE FOCUS BOX.",
        });
        setPrompt("CENTER THE LICENSE PLATE — THEN SNAP AGAIN");
        beep(220, 0.12);
        setTimeout(() => setFeed(null), 1800);
      } else {
        setFeed({ title: "NO CASE", text: "GET THE VEHICLE AND ITS PLATE INSIDE THE FRAME." });
        setTimeout(() => setFeed(null), 1300);
      }
    };

    const togglePhone = () => {
      if (!running) return;
      phoneOpen = !phoneOpen;
      if (phoneOpen) {
        phonePanRef.current = { yaw: 0, pitch: 0 };
        resetMotionBaseline();
      }
      setPhone(phoneOpen);
      beep(phoneOpen ? 440 : 280, 0.06);
    };

    const crashRide = () => {
      if (!running) return;
      running = false;
      actualSpeed = 0;
      phoneOpen = false;
      bike.rotation.z = -1.18;
      setPhone(false);
      setLocked(false);
      setVehicleFramed(false);
      setCrashed(true);
      setFeed(null);
      setPrompt("RIDE ENDED");
      if (runtimeRef.current) runtimeRef.current.started = false;
      beep(105, 0.45);
    };

    const resetRide = () => {
      bikeX = LANE_X;
      bike.position.x = LANE_X;
      bike.rotation.z = 0;
      desiredSpeed = 8.2;
      actualSpeed = 0;
      scoreStreak = 0;
      setStreak(0);
      setCrashed(false);
      setReport(null);
      setPrompt("RIDE THE BIKE LANE");
      running = true;
      if (runtimeRef.current) runtimeRef.current.started = true;
      beep(520, 0.12);
    };

    runtimeRef.current = { started: running, phone: phoneOpen, keys, snap, togglePhone, resetRide };

    const keydown = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
      keys.add(event.key.toLowerCase());
      if (event.repeat) return;
      if (event.key.toLowerCase() === "e") togglePhone();
      if (event.code === "Space") snap();
    };
    const keyup = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);

    const resize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      phoneCamera.aspect = Math.max(phoneMount.clientWidth, 1) / Math.max(phoneMount.clientHeight, 1);
      phoneCamera.updateProjectionMatrix();
      phoneRenderer.setSize(Math.max(phoneMount.clientWidth, 1), Math.max(phoneMount.clientHeight, 1));
    };
    window.addEventListener("resize", resize);

    const animate = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      const phase = elapsed % 18;
      signalRed = phase < 7;
      const signalAmber = phase >= 15.5;
      signalLamps.forEach((lamp) => {
        const name = lamp.userData.signal as string;
        const on = (name === "red" && signalRed) || (name === "green" && !signalRed && !signalAmber) || (name === "amber" && signalAmber);
        const material = lamp.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = on ? 3.8 : 0.08;
        material.color.multiplyScalar(1);
      });
      running = runtimeRef.current?.started ?? false;
      if (runtimeRef.current) {
        runtimeRef.current.phone = phoneOpen;
        runtimeRef.current.snap = snap;
        runtimeRef.current.togglePhone = togglePhone;
        runtimeRef.current.resetRide = resetRide;
      }

      if (running) {
        if (keys.has("arrowup") || keys.has("w")) desiredSpeed = Math.min(11.6, desiredSpeed + dt * 3.5);
        if (keys.has("arrowdown") || keys.has("s")) desiredSpeed = Math.max(3.8, desiredSpeed - dt * 4.5);
        const steer = (keys.has("arrowleft") || keys.has("a") ? -1 : 0) + (keys.has("arrowright") || keys.has("d") ? 1 : 0);
        bikeX = THREE.MathUtils.clamp(bikeX + steer * dt * 4.4, -6.45, 5.98);
        bike.position.x = THREE.MathUtils.lerp(bike.position.x, bikeX, dt * 8);
        bike.rotation.z = THREE.MathUtils.lerp(bike.rotation.z, -steer * 0.13, dt * 7);
        const pan = phonePanRef.current;
        if (phoneOpen) {
          const horizontalKeys = (keys.has("l") ? 1 : 0) - (keys.has("j") ? 1 : 0);
          const verticalKeys = (keys.has("i") ? 1 : 0) - (keys.has("k") ? 1 : 0);
          pan.yaw = THREE.MathUtils.clamp(pan.yaw + horizontalKeys * dt * 0.7, -0.62, 0.62);
          pan.pitch = THREE.MathUtils.clamp(pan.pitch + verticalKeys * dt * 0.55, -0.38, 0.38);
          if ((horizontalKeys || verticalKeys) && motionAimRef.current.enabled) resetMotionBaseline();
        }
        phoneCamera.position.set(bike.position.x + 0.34, 2.14, 3.84);
        phoneCamera.rotation.set(-0.046 + pan.pitch, 0.0095 - pan.yaw, 0);
        phoneCamera.updateMatrixWorld(true);

        const blocked = obstacles.some((obstacle) => obstacle.kind === "bike-lane"
          && obstacle.active
          && obstacle.z > -7.3
          && obstacle.z < 2
          && Math.abs(obstacle.group.position.x - bikeX) < 1.65);
        const targetSpeed = blocked ? 0 : desiredSpeed;
        actualSpeed = THREE.MathUtils.lerp(actualSpeed, targetSpeed, dt * (blocked ? 8 : 1.9));
        const dz = actualSpeed * dt;
        meters += dz;

        for (const segment of world) {
          segment.position.z += dz;
          if (segment.position.z > 38) segment.position.z -= world.length * 38;
        }
        crosswalkCooldown = Math.max(0, crosswalkCooldown - dt);
        const upcomingIntersection = intersections
          .filter((intersection) => intersection.position.z < -8 && intersection.position.z > -78)
          .sort((a, b) => b.position.z - a.position.z)[0];

        if (!crosswalkViolation.resolving) {
          const available = signalRed && crosswalkCooldown <= 0 && upcomingIntersection;
          crosswalkViolation.active = Boolean(available);
          crosswalkViolation.group.visible = Boolean(available);
          if (available) {
            crosswalkViolation.z = upcomingIntersection.position.z + 0.3;
            crosswalkViolation.group.position.set(1.2, 0, crosswalkViolation.z);
            crosswalkViolation.group.rotation.y = Math.PI;
          }
        }

        for (const car of traffic) {
          const relevant = intersections
            .map((intersection) => ({ intersection, delta: car.direction === 1 ? car.z - intersection.position.z : intersection.position.z - car.z }))
            .filter(({ delta }) => delta > 0 && delta < 22)
            .sort((a, b) => a.delta - b.delta)[0];
          const shouldStop = signalRed && relevant && relevant.delta < 7.5;
          if (shouldStop) {
            const stopOffset = 3.65 + car.halfLength;
            car.z = relevant.intersection.position.z + (car.direction === 1 ? stopOffset : -stopOffset);
          } else {
            car.z += (actualSpeed - car.speed * car.direction) * dt;
          }
          if (car.z > 18) car.z -= 330;
          if (car.z < -330) car.z += 330;
          car.group.position.z = car.z;
          car.group.position.x = car.lane;
          if (
            Math.abs(car.lane - bikeX) < 1.08
            && Math.abs(car.z - bike.position.z) < car.halfLength + 0.3
          ) {
            crashRide();
          }
        }

        for (const obstacle of obstacles) {
          if (obstacle.kind === "crosswalk") continue;
          obstacle.z += dz;
          obstacle.group.position.z = obstacle.z;
          if (obstacle.active && obstacle.z > 10) {
            scoreStreak = 0;
            setStreak(0);
            obstacle.z -= 5 * 63;
            obstacle.group.position.set(LANE_X + (Math.random() - 0.5) * 0.48, 0, obstacle.z);
          }
          if (!obstacle.active && !obstacle.resolving && obstacle.z > 15) {
            obstacle.z -= 5 * 63;
            obstacle.group.position.set(LANE_X + (Math.random() - 0.5) * 0.48, 0, obstacle.z);
            obstacle.group.rotation.set(0, Math.PI, 0);
            obstacle.group.scale.setScalar(1);
            obstacle.group.visible = true;
            obstacle.active = true;
            obstacle.resolution = undefined;
          }
        }

        currentAssessment = getTargetAssessment();
        nearest = currentAssessment?.obstacle ?? null;
        if (nearest && nearest.active && nearest.z > -40 && nearest.z < 3 && currentAssessment) {
          const isLocked = phoneOpen && currentAssessment.plateInFrame;
          setLocked(isLocked);
          setVehicleFramed(phoneOpen && currentAssessment.vehicleInFrame);
          setPrompt(phoneOpen
            ? (isLocked
              ? (nearest.kind === "crosswalk" ? "SPACE — PLATE READY · CROSSWALK +3" : "SPACE — PLATE READY · CAPTURE")
              : currentAssessment.vehicleInFrame
                ? "CENTER THE LICENSE PLATE"
                : "GET VEHICLE AND PLATE IN FRAME")
            : "E — TAKE OUT PHONE");
        } else {
          setLocked(false);
          setVehicleFramed(false);
          setPrompt(phoneOpen ? "NO VIOLATION IN FRAME — E TO POCKET" : (signalRed ? "TRAFFIC SIGNAL — RED" : "TRAFFIC SIGNAL — GREEN"));
        }
      }

      bike.position.y = 0.02 + Math.sin(elapsed * (4 + actualSpeed * 0.45)) * 0.025;
      pedalPhase -= actualSpeed * dt * 1.18;
      updatePedaling(pedalPhase);
      bike.traverse((o) => {
        if (o.userData.isBikeWheel) o.rotation.x -= actualSpeed * dt * 1.75;
        if (o.userData.restingPhoneArm) o.visible = !phoneOpen;
      });
      const phoneRig = bike.userData.phoneRig as THREE.Group;
      const phoneAmount = THREE.MathUtils.lerp(phoneRig.scale.x, phoneOpen ? 1 : 0.001, dt * (phoneOpen ? 7 : 10));
      phoneRig.scale.setScalar(phoneAmount);
      phoneRig.position.y = (1 - phoneAmount) * -0.36;
      phoneRig.rotation.x = (1 - phoneAmount) * 0.55;
      phoneRig.visible = phoneOpen || phoneAmount > 0.02;
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, bike.position.x + (phoneOpen ? 0.18 : 0.42), dt * 2.7);
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, phoneOpen ? 3.02 : 3.34, dt * 3) + Math.sin(elapsed * 2.2) * 0.018;
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, phoneOpen ? 7.45 : 8.8, dt * 3);
      camera.lookAt(bike.position.x + (phoneOpen ? -0.15 : 0), phoneOpen ? 1.35 : 1.18, phoneOpen ? -16 : -15);

      for (const obstacle of obstacles) {
        if (!obstacle.resolving || !obstacle.resolution) continue;
        obstacle.timer += dt;
        const t = obstacle.timer;
        if (obstacle.resolution === "BOOM!") {
          obstacle.group.rotation.z += dt * 8;
          obstacle.group.position.y += dt * 2.2;
          const scale = Math.max(0.01, 1 - t * 0.62);
          obstacle.group.scale.setScalar(scale);
        } else if (obstacle.resolution === "VANISHED!") {
          obstacle.group.rotation.y += dt * (3 + t * 7);
          obstacle.group.position.y = Math.sin(t * 13) * 0.12;
          obstacle.group.scale.setScalar(Math.max(0.01, 1 - t * 0.62));
        } else if (obstacle.resolution === "TICKETED!") {
          const cop = obstacle.helpers[0];
          const ticket = obstacle.helpers[1];
          if (cop) cop.position.x = THREE.MathUtils.lerp(cop.position.x, obstacle.group.position.x - 1.8, dt * 3);
          if (ticket) ticket.visible = t > 0.7;
          if (t > 1.5) {
            obstacle.group.position.x += dt * 5;
            obstacle.group.rotation.y -= dt * 1.5;
          }
        } else if (obstacle.resolution === "TOWED!") {
          const tow = obstacle.helpers[0];
          if (tow && t < 1.25) tow.position.x = THREE.MathUtils.lerp(tow.position.x, obstacle.group.position.x - 2.3, dt * 4);
          if (t > 1.25) {
            obstacle.group.position.x += dt * 5.5;
            if (tow) tow.position.x += dt * 5.5;
          }
        }
        if (t > 2.7) {
          obstacle.helpers.forEach((helper) => {
            if (helper.parent === scene) scene.remove(helper);
            else helper.parent?.remove(helper);
          });
          obstacle.helpers = [];
          obstacle.group.visible = false;
          obstacle.group.position.y = 0;
          obstacle.resolving = false;
          obstacle.z = -285 - Math.random() * 50;
          obstacle.group.position.z = obstacle.z;
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.velocity.y -= dt * 8;
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.mesh.rotation.x += dt * 7;
        p.mesh.rotation.z += dt * 5;
        p.mesh.scale.setScalar(Math.max(0.01, p.life));
        if (p.life <= 0) {
          scene.remove(p.mesh);
          particles.splice(i, 1);
        }
      }

      if (elapsed - lastUi > 0.1) {
        setSpeed(Math.round(actualSpeed * 2.24));
        setDistance(Math.floor(meters));
        lastUi = elapsed;
      }
      if (flashTimer > 0) flashTimer -= dt;
      if (phoneOpen) renderPhoneCamera();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    let animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      reportTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("resize", resize);
      window.removeEventListener("deviceorientation", deviceOrientation, true);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
      phoneRenderer.dispose();
      mount.removeChild(renderer.domElement);
      phoneMount.removeChild(phoneRenderer.domElement);
    };
  }, [beep]);

  const begin = () => {
    setStarted(true);
    if (runtimeRef.current) runtimeRef.current.started = true;
    beep(520, 0.12);
  };

  const steer = (key: string, pressed: boolean) => {
    const keys = runtimeRef.current?.keys;
    if (!keys) return;
    if (pressed) keys.add(key);
    else keys.delete(key);
  };

  const beginPhonePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!phone) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    phoneDragRef.current = { active: true, x: event.clientX, y: event.clientY };
  };

  const movePhonePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = phoneDragRef.current;
    if (!phone || !drag.active) return;
    event.preventDefault();
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const pan = phonePanRef.current;
    pan.yaw = THREE.MathUtils.clamp(pan.yaw + dx * 0.0038, -0.62, 0.62);
    pan.pitch = THREE.MathUtils.clamp(pan.pitch - dy * 0.0038, -0.38, 0.38);
    phoneDragRef.current = { active: true, x: event.clientX, y: event.clientY };
  };

  const endPhonePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (phoneDragRef.current.active && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    phoneDragRef.current.active = false;
    const motion = motionAimRef.current;
    if (motion.enabled && motion.lastBeta !== null && motion.lastGamma !== null) {
      motion.baseBeta = motion.lastBeta;
      motion.baseGamma = motion.lastGamma;
      motion.anchorYaw = phonePanRef.current.yaw;
      motion.anchorPitch = phonePanRef.current.pitch;
    }
  };

  const enableMotionAim = async () => {
    if (!("DeviceOrientationEvent" in window)) {
      setMotionAim("unsupported");
      return;
    }
    try {
      const OrientationEvent = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      const permission = OrientationEvent.requestPermission
        ? await OrientationEvent.requestPermission()
        : "granted";
      if (permission !== "granted") {
        setMotionAim("denied");
        return;
      }
      const motion = motionAimRef.current;
      motion.enabled = true;
      motion.baseBeta = null;
      motion.baseGamma = null;
      motion.anchorYaw = phonePanRef.current.yaw;
      motion.anchorPitch = phonePanRef.current.pitch;
      setMotionAim("on");
      beep(660, 0.08);
    } catch {
      setMotionAim("denied");
    }
  };

  const phoneAction = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (phone) runtime.snap();
    else runtime.togglePhone();
  };

  const restartRide = () => runtimeRef.current?.resetRide();

  return (
    <main className="game-shell" aria-label="Lane Justice 3D bicycle game">
      <div ref={mountRef} className="game-canvas" aria-hidden="true" />
      <section className="hud" aria-live="polite">
        <div className="brand">Lane Justice<span>Ride · Document · Continue</span></div>
        <div className="hud-card stats">
          <div><span className="stat-label">Speed</span><span className="stat-value">{speed}<small>MPH</small></span></div>
          <div><span className="stat-label">Civic score</span><span className="stat-value">{String(streak).padStart(2, "0")}</span></div>
          <div><span className="stat-label">Distance</span><span className="stat-value">{distance}<small>M</small></span></div>
          <div><span className="stat-label">Route</span><span className="stat-value" style={{ color: "var(--mint)" }}>ACTIVE</span></div>
        </div>
        <div className={`hud-card case-feed ${feed ? "" : "hidden"}`}>
          <strong>{feed?.title ?? "CASE CLOSED"}</strong>
          <span>{feed?.text ?? "THE LANE IS CLEAR."}</span>
        </div>
        <aside className={`evidence-report ${report ? "visible" : ""}`} aria-live="polite">
          <div className="evidence-heading">
            <span>Automated evidence report</span>
            <strong>{report?.status === "submitted" ? "Submitted" : report?.status === "preparing" ? "Form ready" : "ALPR reading"}</strong>
          </div>
          <div
            className="evidence-photo"
            role="img"
            aria-label="Captured traffic violation"
            style={report?.photo ? { backgroundImage: `url(${report.photo})` } : undefined}
          />
          <dl>
            <div><dt>Case</dt><dd>{report?.caseId ?? "—"}</dd></div>
            <div><dt>Plate</dt><dd className={report?.status === "reading" ? "scanning" : ""}>{report?.plate ?? "—"}</dd></div>
            <div><dt>Violation</dt><dd>{report?.violation ?? "—"}</dd></div>
            <div><dt>ALPR</dt><dd>{report?.confidence ? `${report.confidence}% match` : "Analyzing image"}</dd></div>
          </dl>
          <div className={`submission-track ${report?.status ?? ""}`}>
            <i /><i /><i />
            <span>{report?.status === "submitted" ? "Report auto-submitted" : report?.status === "preparing" ? "Adding photo and plate to form" : "Locating license plate"}</span>
          </div>
        </aside>
        {started && <div className="prompt"><kbd>{phone ? "SPACE" : "E"}</kbd>{prompt.replace(/^E — |^SPACE — /, "")}</div>}
        <div
          className={`phone-view ${phone ? "active" : ""} ${locked ? "locked" : ""} ${vehicleFramed && !locked ? "needs-plate" : ""}`}
          aria-hidden={!phone}
          onPointerDown={beginPhonePan}
          onPointerMove={movePhonePan}
          onPointerUp={endPhonePan}
          onPointerCancel={endPhonePan}
        >
          <div ref={phoneMountRef} className="phone-camera-feed" />
          <div className="phone-speaker" />
          <div className="phone-status">{locked ? "PLATE LOCKED · READY" : vehicleFramed ? "PLATE REQUIRED" : "CAMERA READY"}</div>
          <button
            type="button"
            className={`motion-aim-button ${motionAim}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={enableMotionAim}
          >
            {motionAim === "on" ? "Recenter gyro" : motionAim === "denied" ? "Motion denied" : motionAim === "unsupported" ? "No motion sensor" : "Enable motion aim"}
          </button>
          <div className="focus-frame" />
          <div className="phone-pan-hint">{motionAim === "on" ? "Tilt to aim · drag holds angle" : "Drag to aim · I J K L"}</div>
          <div className="shutter" />
        </div>
        <div className={`flash ${flashing ? "fire" : ""}`} />
      </section>

      <section className={`start-screen ${started ? "dismissed" : ""}`}>
        <div className="start-card">
          <span className="start-kicker">Urban cycling · evidence mode</span>
          <h1>Lane<br />Justice</h1>
          <p>Ride with traffic through a living city. You can leave the bike lane, but moving traffic is dangerous. Document cars blocking the bike lane, or catch vehicles stopped beyond the line in a crosswalk during a red light. Keep the license plate in the focus box so ALPR can complete and submit the report. Crosswalk violations are worth triple.</p>
          <button className="start-button" onClick={begin}>Start riding</button>
          <div className="controls-line">WASD / Arrow keys to ride · E for phone · Drag or IJKL to aim · Space to snap</div>
        </div>
      </section>

      <section className={`crash-screen ${crashed ? "visible" : ""}`} aria-live="assertive" aria-hidden={!crashed}>
        <div className="crash-card">
          <span className="crash-kicker">Traffic violence</span>
          <h2>Another victim of drivers in the bike lane.</h2>
          <p>You entered moving traffic while trying to get around an obstruction.</p>
          <button className="start-button" onClick={restartRide}>Ride again</button>
        </div>
      </section>

      <div className="mobile-controls" aria-label="Touch controls">
        <div className="mobile-group">
          <button className="touch-button" aria-label="Steer left" onPointerDown={() => steer("arrowleft", true)} onPointerUp={() => steer("arrowleft", false)} onPointerCancel={() => steer("arrowleft", false)}>←</button>
          <button className="touch-button" aria-label="Steer right" onPointerDown={() => steer("arrowright", true)} onPointerUp={() => steer("arrowright", false)} onPointerCancel={() => steer("arrowright", false)}>→</button>
        </div>
        <div className="mobile-group">
          <button className="touch-button" aria-label="Pedal faster" onPointerDown={() => steer("arrowup", true)} onPointerUp={() => steer("arrowup", false)} onPointerCancel={() => steer("arrowup", false)}>↑</button>
          <button className="touch-button phone" aria-label={phone ? "Snap photo" : "Open phone"} onClick={phoneAction}>{phone ? "●" : "▣"}</button>
        </div>
      </div>
      <div className="rotate-note">Best played in landscape</div>
    </main>
  );
}

export default BikeGame;
