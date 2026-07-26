"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

type Resolution = "BOOM!" | "VANISHED!" | "TICKETED!" | "TOWED!";
type ReportStatus = "reading" | "preparing" | "submitted";
type RiderChoice = "hero" | "casual";
type PoliceCallState = "ringing" | "connected" | null;
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
  halfLength: number;
  kind: "bike-lane" | "crosswalk";
  plate: string;
  plates: THREE.Object3D[];
  active: boolean;
  resolving: boolean;
  resolution?: Resolution;
  timer: number;
  baseScale: number;
  helpers: THREE.Object3D[];
  mirrorBroken: boolean;
  mirrors: THREE.Object3D[];
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

type GameAudio = {
  context: AudioContext;
  master: GainNode;
  musicStarted: boolean;
  noise: AudioBuffer;
};

type RipArmRig = {
  elbow: THREE.Object3D;
  fingers: THREE.Object3D[];
  group: THREE.Group;
  hand: THREE.Group;
  lower: THREE.Mesh;
  upper: THREE.Mesh;
};

type RealisticRiderRig = {
  baseRotations: Map<THREE.Bone, THREE.Quaternion>;
  bones: Record<string, THREE.Bone>;
  group: THREE.Group;
  id: RiderChoice;
  phone: THREE.Group;
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

type PlateState = "NY" | "NJ" | "PA";

const US_LICENSE_PLATE_WIDTH = 0.42;
const US_LICENSE_PLATE_HEIGHT = 0.21;

const plateNumbers = [
  "KDM-4821",
  "V64-NXE",
  "MBP-1947",
  "JRX-7316",
  "M31-RDE",
  "LCR-6382",
  "HPC-2940",
  "T88-BKE",
  "JHT-2744",
  "GVT-6183",
  "K52-PDL",
  "KFN-9036",
  "LNE-2749",
  "F19-CAR",
  "GWD-3519",
  "CYC-1058",
  "R61-TKT",
  "XWK-2047",
];

function plateStateFor(plateNumber: string): PlateState {
  const knownIndex = plateNumbers.indexOf(plateNumber);
  if (knownIndex >= 0) return (["NY", "NJ", "PA"] as const)[knownIndex % 3];
  const hash = [...plateNumber].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return (["NY", "NJ", "PA"] as const)[hash % 3];
}

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

function makePlateTexture(plateNumber: string, state: PlateState) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;

  if (state === "NJ") {
    const background = context.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, "#fffef1");
    background.addColorStop(1, "#f1d76e");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    context.fillStyle = "#fbfbf5";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (state === "NY") {
    context.fillStyle = "#173b6c";
    context.fillRect(0, 0, canvas.width, 36);
    context.fillStyle = "#e7ad2e";
    context.fillRect(0, canvas.height - 24, canvas.width, 24);
  } else if (state === "PA") {
    context.fillStyle = "#193b6b";
    context.fillRect(0, 0, canvas.width, 18);
    context.fillStyle = "#efb82f";
    context.fillRect(0, canvas.height - 18, canvas.width, 18);
  }

  const ink = state === "NJ" ? "#193c70" : "#132d55";
  context.strokeStyle = ink;
  context.lineWidth = 7;
  context.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  context.fillStyle = ink;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "800 30px Arial, sans-serif";
  if (state === "NY") {
    context.fillStyle = "#ffffff";
    context.fillText("NEW YORK", canvas.width / 2, 19);
  } else if (state === "NJ") {
    context.fillText("NEW JERSEY", canvas.width / 2, 31);
  } else {
    context.fillText("PENNSYLVANIA", canvas.width / 2, 38);
  }

  context.fillStyle = ink;
  context.font = "900 88px Arial, sans-serif";
  context.fillText(plateNumber, canvas.width / 2, 142);
  context.font = "700 21px Arial, sans-serif";
  context.fillText(state === "NY" ? "EXCELSIOR" : state === "NJ" ? "GARDEN STATE" : "visitPA.com", canvas.width / 2, 218);

  context.fillStyle = "rgba(24, 31, 37, .7)";
  for (const x of [36, canvas.width - 36]) {
    context.beginPath();
    context.arc(x, 28, 7, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(x, canvas.height - 28, 7, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeLicensePlate(plateNumber: string, z: number, facesRear: boolean) {
  const state = plateStateFor(plateNumber);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(US_LICENSE_PLATE_WIDTH, US_LICENSE_PLATE_HEIGHT),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x202020,
      emissiveIntensity: 0.08,
      map: makePlateTexture(plateNumber, state),
      roughness: 0.55,
      metalness: 0.02,
    }),
  );
  plate.position.set(0, 0.69, z);
  plate.rotation.y = facesRear ? 0 : Math.PI;
  plate.userData.isLicensePlate = true;
  plate.userData.plateNumber = plateNumber;
  plate.userData.plateState = state;
  return plate;
}

function alignSegment(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3) {
  const direction = end.clone().sub(start);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.set(1, direction.length(), 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

function addSideMirrors(vehicle: THREE.Group, mountingX: number, y: number, z: number, size = 1) {
  const mirrors: THREE.Group[] = [];
  const casing = new THREE.MeshPhysicalMaterial({ color: 0x1a2023, roughness: 0.38, metalness: 0.55, clearcoat: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb4bd, roughness: 0.12, metalness: 0.72, clearcoat: 0.7 });
  for (const side of [-1, 1]) {
    const mirror = new THREE.Group();
    mirror.position.set(side * (mountingX + 0.18 * size), y, z);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * size, 0.018 * size, 1, 8), casing);
    alignSegment(stalk, new THREE.Vector3(-side * 0.18 * size, 0, 0.03), new THREE.Vector3(0, 0, 0));
    mirror.add(stalk);
    const shell = new THREE.Mesh(new RoundedBoxGeometry(0.11 * size, 0.14 * size, 0.29 * size, 3, 0.035 * size), casing);
    shell.castShadow = true;
    mirror.add(shell);
    const reflectiveFace = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.1 * size, 0.23 * size, 2, 0.018 * size), glass);
    reflectiveFace.position.x = side * 0.061 * size;
    mirror.add(reflectiveFace);
    mirror.userData.isBreakableMirror = true;
    mirror.userData.side = side;
    vehicle.add(mirror);
    mirrors.push(mirror);
  }
  vehicle.userData.mirrorMeshes = mirrors;
  return mirrors;
}

function rotateBoneToward(bone: THREE.Bone, endpoint: THREE.Bone, target: THREE.Vector3) {
  if (!bone.parent) return;
  bone.updateWorldMatrix(true, true);
  const jointPosition = bone.getWorldPosition(new THREE.Vector3());
  const endpointPosition = endpoint.getWorldPosition(new THREE.Vector3());
  const currentDirection = endpointPosition.sub(jointPosition).normalize();
  const targetDirection = target.clone().sub(jointPosition).normalize();
  if (currentDirection.lengthSq() < 0.0001 || targetDirection.lengthSq() < 0.0001) return;
  const worldDelta = new THREE.Quaternion().setFromUnitVectors(currentDirection, targetDirection);
  const currentWorldRotation = bone.getWorldQuaternion(new THREE.Quaternion());
  const desiredWorldRotation = worldDelta.multiply(currentWorldRotation);
  const parentWorldRotation = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentWorldRotation.multiply(desiredWorldRotation));
  bone.updateWorldMatrix(false, true);
}

function solveTwoBone(
  root: THREE.Bone,
  middle: THREE.Bone,
  endpoint: THREE.Bone,
  target: THREE.Vector3,
  pole: THREE.Vector3,
) {
  root.updateWorldMatrix(true, true);
  const rootPosition = root.getWorldPosition(new THREE.Vector3());
  const middlePosition = middle.getWorldPosition(new THREE.Vector3());
  const endpointPosition = endpoint.getWorldPosition(new THREE.Vector3());
  const upperLength = rootPosition.distanceTo(middlePosition);
  const lowerLength = middlePosition.distanceTo(endpointPosition);
  const direction = target.clone().sub(rootPosition);
  const distance = THREE.MathUtils.clamp(direction.length(), 0.001, upperLength + lowerLength - 0.001);
  direction.normalize();
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const poleDirection = pole.clone().sub(rootPosition);
  poleDirection.addScaledVector(direction, -poleDirection.dot(direction));
  if (poleDirection.lengthSq() < 0.0001) poleDirection.set(1, 0, 0);
  poleDirection.normalize();
  const desiredMiddle = rootPosition.clone().addScaledVector(direction, along).addScaledVector(poleDirection, height);
  rotateBoneToward(root, middle, desiredMiddle);
  rotateBoneToward(middle, endpoint, target);
}

function makeRealisticRiderPhone() {
  const phone = new THREE.Group();
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(0.15, 0.29, 0.025, 3, 0.025),
    new THREE.MeshPhysicalMaterial({ color: 0x090c0e, roughness: 0.2, metalness: 0.78 }),
  );
  body.castShadow = true;
  phone.add(body);
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.012, 16),
    new THREE.MeshStandardMaterial({ color: 0x14222a, metalness: 0.8, roughness: 0.12 }),
  );
  lens.position.set(-0.045, 0.095, -0.018);
  lens.rotation.x = Math.PI / 2;
  phone.add(lens);
  // The handset sits above and just outside the wrist so the palm supports
  // its lower half instead of passing through its center.
  phone.position.set(0.38, 2.075, -0.59);
  phone.rotation.set(-0.16, 0.06, -0.1);
  phone.scale.setScalar(0.001);
  phone.visible = false;
  return phone;
}

function loadRealisticBike(bike: THREE.Group) {
  new GLTFLoader().load("/models/realistic-city-bicycle.glb", (gltf) => {
    const source = gltf.scene.getObjectByName("RealisticCityBicycle");
    if (!source) return;
    source.traverse((object) => {
      object.userData.isBike = true;
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        material.roughness = Math.max(material.roughness, 0.46);
        if (material.map) material.map.anisotropy = 4;
        material.needsUpdate = true;
      });
    });

    // The downloaded bicycle points toward +Z after Blender-to-glTF axis
    // conversion. Rotate it into the game's -Z riding direction, then fit it
    // to the existing rider's hand, seat, and pedal targets.
    source.rotation.y = Math.PI;
    source.updateMatrixWorld(true);
    const sourceSize = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
    source.scale.set(
      0.78 / sourceSize.x,
      1.25 / sourceSize.y,
      2.08 / sourceSize.z,
    );
    source.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(source);
    const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
    source.position.x -= fittedCenter.x;
    source.position.y -= fittedBounds.min.y;
    source.position.z -= fittedCenter.z;
    source.updateMatrixWorld(true);

    for (const wheelName of ["FrontWheel", "RearWheel"]) {
      const wheel = source.getObjectByName(wheelName);
      if (wheel) wheel.userData.isBikeWheel = true;
    }
    const group = new THREE.Group();
    group.add(source);
    bike.add(group);
    (bike.userData.proceduralBike as THREE.Group).visible = false;
    bike.userData.realisticBike = group;
    bike.userData.realisticBikeCrank = source.getObjectByName("Pedalier");
  });
}

function loadRealisticRider(bike: THREE.Group) {
  const loader = new GLTFLoader();
  const aliases: Record<RiderChoice, Record<string, string>> = {
    hero: {},
    casual: {
      Hips: "CC_Base_Hip_02",
      Spine: "CC_Base_Waist_033",
      Spine1: "CC_Base_Spine01_034",
      Spine2: "CC_Base_Spine02_035",
      Neck: "CC_Base_NeckTwist01_036",
      Head: "CC_Base_Head_038",
      LeftArm: "CC_Base_L_Upperarm_050",
      LeftForeArm: "CC_Base_L_Forearm_051",
      LeftHand: "CC_Base_L_Hand_055",
      RightArm: "CC_Base_R_Upperarm_078",
      RightForeArm: "CC_Base_R_Forearm_079",
      RightHand: "CC_Base_R_Hand_083",
      LeftUpLeg: "CC_Base_L_Thigh_04",
      LeftLeg: "CC_Base_L_Calf_05",
      LeftFoot: "CC_Base_L_Foot_06",
      RightUpLeg: "CC_Base_R_Thigh_018",
      RightLeg: "CC_Base_R_Calf_019",
      RightFoot: "CC_Base_R_Foot_021",
    },
  };
  const load = (id: RiderChoice, url: string) => loader.load(url, (gltf) => {
    const source = gltf.scene;
    const namedBones: Record<string, THREE.Bone> = {};
    source.traverse((object) => {
      object.userData.isBike = true;
      if (object instanceof THREE.Bone) namedBones[object.name] = object;
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    const required = [
      "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
      "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand",
      "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot",
    ];
    const bones: Record<string, THREE.Bone> = {};
    required.forEach((name) => {
      const sourceName = aliases[id][name] ?? name;
      if (namedBones[sourceName]) bones[name] = namedBones[sourceName];
    });
    if (required.some((name) => !bones[name])) return;

    const group = new THREE.Group();
    group.add(source);
    source.updateWorldMatrix(true, true);
    const initialBounds = new THREE.Box3().setFromObject(source);
    const height = Math.max(initialBounds.max.y - initialBounds.min.y, 0.1);
    source.scale.multiplyScalar(2.1 / height);
    source.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(source);
    const center = bounds.getCenter(new THREE.Vector3());
    source.position.x -= center.x;
    source.position.y -= bounds.min.y;
    source.position.z -= center.z;
    group.position.set(0, 0.2, 0.2);
    group.rotation.y = Math.PI;
    group.visible = false;

    const baseRotations = new Map<THREE.Bone, THREE.Quaternion>();
    Object.values(namedBones).forEach((bone) => baseRotations.set(bone, bone.quaternion.clone()));
    const phone = makeRealisticRiderPhone();
    bike.add(group, phone);
    const rig = { baseRotations, bones, group, id, phone } satisfies RealisticRiderRig;
    const rigs = (bike.userData.riderRigs ??= {}) as Partial<Record<RiderChoice, RealisticRiderRig>>;
    rigs[id] = rig;
    if (id === "hero") activateRider(bike, "hero");
  });
  load("hero", "/models/lead-rider.glb");
  load("casual", "/models/support-casual-male.glb");
}

function activateRider(bike: THREE.Group, id: RiderChoice) {
  const rigs = bike.userData.riderRigs as Partial<Record<RiderChoice, RealisticRiderRig>> | undefined;
  const next = rigs?.[id];
  if (!next) return (bike.userData.activeRider as RiderChoice | undefined) ?? "hero";
  Object.values(rigs ?? {}).forEach((rig) => {
    if (!rig) return;
    rig.group.visible = rig.id === id;
    if (rig.id !== id) rig.phone.visible = false;
  });
  next.group.visible = true;
  bike.userData.realisticRiderRig = next;
  bike.userData.activeRider = id;
  return id;
}

function switchRider(bike: THREE.Group) {
  const current = (bike.userData.activeRider as RiderChoice | undefined) ?? "hero";
  return activateRider(bike, current === "hero" ? "casual" : "hero");
}

function poseRealisticRider(
  bike: THREE.Group,
  pedalAngle: number,
  phoneOpen: boolean,
  ripSide: -1 | 1 | null,
  ripTarget: THREE.Vector3 | null,
) {
  const rig = bike.userData.realisticRiderRig as RealisticRiderRig | undefined;
  if (!rig) return;
  rig.baseRotations.forEach((rotation, bone) => bone.quaternion.copy(rotation));
  const addRotation = (name: string, x: number, y = 0, z = 0) => {
    rig.bones[name].quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
  };
  addRotation("Spine", 0.7);
  addRotation("Spine1", 0.5);
  addRotation("Spine2", 0.35);
  addRotation("Neck", -0.7);
  addRotation("Head", -0.45);
  addRotation("LeftLeg", 0.34);
  addRotation("RightLeg", 0.34);
  addRotation("LeftForeArm", 0, 0, 0.3);
  addRotation("RightForeArm", 0, 0, -0.3);
  rig.group.updateWorldMatrix(true, true);

  const hasRealisticBike = Boolean(bike.userData.realisticBike);
  const crankCenter = hasRealisticBike
    ? new THREE.Vector3(0, 0.34, 0.09)
    : new THREE.Vector3(0, 0.64, 0.19);
  const pedalRadius = hasRealisticBike ? 0.16 : 0.17;
  const pedalX = hasRealisticBike ? 0.11 : 0.17;
  const solveLeg = (side: -1 | 1, phase: number, prefix: "Left" | "Right") => {
    const pedal = new THREE.Vector3(
      side * pedalX,
      crankCenter.y + Math.cos(phase) * pedalRadius,
      crankCenter.z + Math.sin(phase) * pedalRadius,
    );
    const target = bike.localToWorld(pedal);
    const pole = bike.localToWorld(new THREE.Vector3(side * 0.22, 0.96, -0.58));
    solveTwoBone(rig.bones[`${prefix}UpLeg`], rig.bones[`${prefix}Leg`], rig.bones[`${prefix}Foot`], target, pole);
  };
  solveLeg(-1, pedalAngle, "Left");
  solveLeg(1, pedalAngle + Math.PI, "Right");

  const solveArm = (side: -1 | 1, prefix: "Left" | "Right", target: THREE.Vector3) => {
    const pole = bike.localToWorld(new THREE.Vector3(side * 0.52, 1.47, -0.26));
    solveTwoBone(rig.bones[`${prefix}Arm`], rig.bones[`${prefix}ForeArm`], rig.bones[`${prefix}Hand`], target, pole);
  };
  const leftBar = bike.localToWorld(new THREE.Vector3(-0.35, 1.24, -0.68));
  const rightBar = bike.localToWorld(new THREE.Vector3(0.35, 1.24, -0.68));
  if (ripSide === -1 && ripTarget) solveArm(-1, "Left", ripTarget);
  else solveArm(-1, "Left", leftBar);
  if (ripSide === 1 && ripTarget) solveArm(1, "Right", ripTarget);
  else if (phoneOpen) {
    // Target the wrist below the phone. The hand mesh extends upward from this
    // bone and now wraps the lower edge rather than floating through the screen.
    solveArm(1, "Right", bike.localToWorld(new THREE.Vector3(0.335, 1.925, -0.565)));
  } else solveArm(1, "Right", rightBar);

  const phoneScale = THREE.MathUtils.lerp(rig.phone.scale.x, phoneOpen ? 1 : 0.001, phoneOpen ? 0.16 : 0.24);
  rig.phone.scale.setScalar(phoneScale);
  rig.phone.visible = phoneOpen || phoneScale > 0.02;
}

function makeBike() {
  const bike = new THREE.Group();
  const proceduralBike = new THREE.Group();
  bike.add(proceduralBike);
  bike.userData.proceduralBike = proceduralBike;
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
    proceduralBike.add(wheel);
  }

  const rear = wheelCenters[1];
  const crank = new THREE.Vector3(0, 0.64, 0.19);
  const seatJoint = new THREE.Vector3(0, 1.05, 0.28);
  const headTop = new THREE.Vector3(0, 1.12, -0.55);
  const headBottom = new THREE.Vector3(0, 0.88, -0.47);
  tube(proceduralBike, rear, crank, 0.032, frame);
  tube(proceduralBike, rear, seatJoint, 0.029, frame);
  tube(proceduralBike, crank, seatJoint, 0.04, frame);
  tube(proceduralBike, seatJoint, headTop, 0.034, frame);
  tube(proceduralBike, crank, headBottom, 0.038, frame);
  tube(proceduralBike, headBottom, headTop, 0.043, frame);
  for (const x of [-0.048, 0.048]) tube(proceduralBike, new THREE.Vector3(x, 1.02, -0.51), new THREE.Vector3(x, 0.54, -0.84), 0.018, alloy);

  tube(proceduralBike, seatJoint, new THREE.Vector3(0, 1.2, 0.3), 0.024, alloy);
  const saddle = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.055, 0.39, 3, 0.045), rubber);
  saddle.position.set(0, 1.22, 0.34);
  saddle.rotation.x = -0.05;
  proceduralBike.add(saddle);
  tube(proceduralBike, headTop, new THREE.Vector3(0, 1.25, -0.61), 0.021, alloy);
  const handlebar = tube(proceduralBike, new THREE.Vector3(-0.36, 1.25, -0.66), new THREE.Vector3(0.36, 1.25, -0.66), 0.018, alloy);
  handlebar.castShadow = true;
  for (const x of [-0.36, 0.36]) {
    tube(proceduralBike, new THREE.Vector3(x, 1.25, -0.66), new THREE.Vector3(x, 1.2, -0.73), 0.022, rubber);
    const brake = box(0.035, 0.09, 0.018, 0x33383a, x, 1.2, -0.73);
    brake.rotation.x = -0.3;
    proceduralBike.add(brake);
  }

  const chainring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.011, 8, 32), alloy);
  chainring.position.copy(crank).setX(-0.055);
  chainring.rotation.y = Math.PI / 2;
  proceduralBike.add(chainring);
  const rearCog = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 8, 24), alloy);
  rearCog.position.copy(rear).setX(-0.06);
  rearCog.rotation.y = Math.PI / 2;
  proceduralBike.add(rearCog);
  tube(proceduralBike, new THREE.Vector3(-0.065, 0.77, 0.2), new THREE.Vector3(-0.065, 0.6, 0.84), 0.006, rubber);
  tube(proceduralBike, new THREE.Vector3(-0.065, 0.51, 0.2), new THREE.Vector3(-0.065, 0.48, 0.84), 0.006, rubber);

  const proceduralRider = new THREE.Group();
  proceduralRider.visible = false;
  bike.add(proceduralRider);
  bike.userData.proceduralRider = proceduralRider;

  const pelvis = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.22, 0.25, 4, 0.08), denim);
  pelvis.position.set(0, 1.27, 0.22);
  pelvis.rotation.x = 0.18;
  pelvis.castShadow = true;
  proceduralRider.add(pelvis);
  const hip = new THREE.Vector3(0, 1.3, 0.2);
  const shoulder = new THREE.Vector3(0, 1.82, -0.22);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.28, 8, 18), jacket);
  torso.position.copy(hip).add(shoulder).multiplyScalar(0.5);
  torso.quaternion.setFromUnitVectors(up, shoulder.clone().sub(hip).normalize());
  torso.scale.set(1, 1, 0.82);
  torso.castShadow = true;
  proceduralRider.add(torso);
  const shoulderLine = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.32, 6, 12), jacket);
  shoulderLine.position.copy(shoulder);
  shoulderLine.rotation.z = Math.PI / 2;
  proceduralRider.add(shoulderLine);
  tube(proceduralRider, new THREE.Vector3(0, 1.82, -0.23), new THREE.Vector3(0, 1.94, -0.28), 0.075, skin);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 28, 20), skin);
  head.scale.set(0.9, 1.08, 0.96);
  head.position.set(0, 2.06, -0.31);
  head.castShadow = true;
  proceduralRider.add(head);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), skin);
  nose.scale.set(0.72, 0.82, 1.15);
  nose.position.set(0, 2.065, -0.49);
  proceduralRider.add(nose);
  for (const x of [-0.073, 0.073]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), skin);
    ear.scale.set(0.45, 0.9, 0.75);
    ear.position.set(x < 0 ? -0.178 : 0.178, 2.065, -0.31);
    proceduralRider.add(ear);
  }
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.215, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), helmetMaterial);
  helmet.scale.set(0.94, 0.73, 1.06);
  helmet.position.set(0, 2.145, -0.31);
  helmet.rotation.x = -0.08;
  helmet.castShadow = true;
  proceduralRider.add(helmet);
  for (const x of [-0.095, 0, 0.095]) {
    const vent = new THREE.Mesh(new RoundedBoxGeometry(0.025, 0.018, 0.13, 2, 0.008), rubber);
    vent.position.set(x, 2.255 - Math.abs(x) * 0.2, -0.34);
    vent.rotation.x = -0.17;
    proceduralRider.add(vent);
  }

  const backpack = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.49, 0.18, 4, 0.075), new THREE.MeshStandardMaterial({ color: 0x171d20, roughness: 0.94 }));
  backpack.position.set(0, 1.58, 0.08);
  backpack.rotation.x = -0.66;
  backpack.castShadow = true;
  proceduralRider.add(backpack);
  for (const x of [-0.15, 0.15]) tube(proceduralRider, new THREE.Vector3(x, 1.76, -0.08), new THREE.Vector3(x, 1.39, 0.12), 0.018, rubber);

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
  const leftHandlebarArm = makeArm(-1);
  leftHandlebarArm.userData.armSide = -1;
  proceduralRider.add(leftHandlebarArm);
  const restingPhoneArm = makeArm(1);
  restingPhoneArm.userData.restingPhoneArm = true;
  restingPhoneArm.userData.armSide = 1;
  proceduralRider.add(restingPhoneArm);
  bike.userData.handlebarArms = [leftHandlebarArm, restingPhoneArm];

  const ripArm = new THREE.Group();
  const ripUpper = segment(0.067, jacket, 14);
  const ripLower = segment(0.054, skin, 14);
  const ripElbow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), skin);
  const ripHand = new THREE.Group();
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.085, 0.17, 3, 0.035), skin);
  palm.castShadow = true;
  ripHand.add(palm);
  const ripFingers: THREE.Mesh[] = [];
  for (let fingerIndex = 0; fingerIndex < 4; fingerIndex++) {
    const finger = segment(0.016, skin, 10);
    finger.scale.y = 0.12;
    finger.position.set(-0.045 + fingerIndex * 0.03, 0, -0.1);
    finger.rotation.x = Math.PI / 2;
    ripHand.add(finger);
    ripFingers.push(finger);
  }
  const thumb = segment(0.018, skin, 10);
  thumb.scale.y = 0.1;
  thumb.position.set(0.075, -0.015, -0.01);
  thumb.rotation.z = -0.85;
  ripHand.add(thumb);
  ripArm.add(ripUpper, ripLower, ripElbow, ripHand);
  ripArm.visible = false;
  proceduralRider.add(ripArm);
  bike.userData.ripArmRig = {
    elbow: ripElbow,
    fingers: ripFingers,
    group: ripArm,
    hand: ripHand,
    lower: ripLower,
    upper: ripUpper,
  } satisfies RipArmRig;

  const leftUpper = segment(0.075, denim, 14);
  const leftLower = segment(0.064, skin, 14);
  const rightUpper = segment(0.075, denim, 14);
  const rightLower = segment(0.064, skin, 14);
  const leftShoe = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.09, 0.29, 3, 0.045), shoeMaterial);
  const rightShoe = leftShoe.clone();
  [leftUpper, leftLower, rightUpper, rightLower, leftShoe, rightShoe].forEach((part) => {
    part.castShadow = true;
    proceduralRider.add(part);
  });
  const leftCrank = segment(0.012, alloy, 8);
  const rightCrank = segment(0.012, alloy, 8);
  proceduralBike.add(leftCrank, rightCrank);
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
  proceduralRider.add(phoneRig);
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
  const frontPlateBacking = box(0.49, 0.28, 0.035, 0x171b1d, 0, 0.69, -2.105);
  const rearPlateBacking = box(0.49, 0.28, 0.035, 0x171b1d, 0, 0.69, 2.105);
  car.add(frontPlateBacking, rearPlateBacking);
  const frontPlate = makeLicensePlate(plateNumber, -2.126, false);
  const rearPlate = makeLicensePlate(plateNumber, 2.126, true);
  car.add(frontPlate, rearPlate);
  addSideMirrors(car, 0.91, 1.3, -0.82, 0.95);
  car.userData.plateNumber = plateNumber;
  car.userData.plateMeshes = [frontPlate, rearPlate];
  car.userData.fleetKind = "car";
  car.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return car;
}

function makeTaxi(plateNumber: string) {
  const taxi = makeCar(0xe2ad22, plateNumber);
  addNYCTaxiMarkings(taxi);
  taxi.userData.isTaxi = true;
  taxi.userData.fleetKind = "taxi";
  return taxi;
}

function addNYCTaxiMarkings(taxi: THREE.Group) {
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x171b1d, roughness: 0.72 });
  const badgeCanvas = document.createElement("canvas");
  badgeCanvas.width = 512;
  badgeCanvas.height = 256;
  const badgeContext = badgeCanvas.getContext("2d")!;
  badgeContext.fillStyle = "#171b1d";
  badgeContext.fillRect(0, 0, badgeCanvas.width, badgeCanvas.height);
  badgeContext.fillStyle = "#f5c22f";
  badgeContext.beginPath();
  badgeContext.arc(92, 128, 68, 0, Math.PI * 2);
  badgeContext.fill();
  badgeContext.fillStyle = "#171b1d";
  badgeContext.textAlign = "center";
  badgeContext.textBaseline = "middle";
  badgeContext.font = "900 104px Arial, sans-serif";
  badgeContext.fillText("T", 92, 132);
  badgeContext.fillStyle = "#ffffff";
  badgeContext.textAlign = "left";
  badgeContext.font = "900 62px Arial, sans-serif";
  badgeContext.fillText("NYC", 184, 98);
  badgeContext.font = "800 48px Arial, sans-serif";
  badgeContext.fillText("TAXI", 184, 164);
  const badgeTexture = new THREE.CanvasTexture(badgeCanvas);
  badgeTexture.colorSpace = THREE.SRGBColorSpace;
  badgeTexture.anisotropy = 8;
  const badgeMaterial = new THREE.MeshStandardMaterial({ map: badgeTexture, roughness: 0.68 });
  const roofLight = new THREE.Mesh(
    new RoundedBoxGeometry(0.86, 0.26, 0.5, 3, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xf4e2a0, emissive: 0x8d6b18, emissiveIntensity: 0.55, roughness: 0.48 }),
  );
  roofLight.position.set(0, 1.76, 0.12);
  taxi.add(roofLight);
  for (const side of [-1, 1]) {
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.41), badgeMaterial);
    badge.position.set(side * 0.991, 0.93, 0.38);
    badge.rotation.y = side * Math.PI / 2;
    taxi.add(badge);
    const doorStripe = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.18, 1.55), darkTrim);
    doorStripe.position.set(side * 0.971, 0.98, 0.12);
    taxi.add(doorStripe);
    for (let square = 0; square < 5; square++) {
      const checker = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.18), darkTrim);
      checker.position.set(side * 0.988, 1.12 + (square % 2) * 0.12, -0.42 + square * 0.22);
      taxi.add(checker);
    }
  }
}

type FleetKind = "amazon" | "usps" | "box" | "garbage";

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
  } else if (kind === "garbage") {
    ctx.fillStyle = "#304b3d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e8eee8";
    ctx.font = "800 62px Arial";
    ctx.textAlign = "center";
    ctx.fillText("SANITATION", 384, 105);
    ctx.fillStyle = "#a7c9a9";
    ctx.font = "600 34px Arial";
    ctx.fillText("KEEP OUR CITY CLEAN", 384, 164);
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

function makeTransitPanelTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f3f5f4";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1d5f9a";
  ctx.fillRect(0, 0, canvas.width, 68);
  ctx.fillRect(0, 204, canvas.width, 24);
  ctx.fillStyle = "#173754";
  ctx.font = "900 76px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("NYC TRANSIT", 512, 164);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function addTransitBusMarkings(bus: THREE.Group) {
  const panelMaterial = new THREE.MeshStandardMaterial({
    map: makeTransitPanelTexture(),
    roughness: 0.72,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 0.78), panelMaterial);
    panel.position.set(side * 1.286, 1.42, 0.48);
    panel.rotation.y = side * Math.PI / 2;
    bus.add(panel);
  }

  const routeCanvas = document.createElement("canvas");
  routeCanvas.width = 512;
  routeCanvas.height = 160;
  const routeContext = routeCanvas.getContext("2d")!;
  routeContext.fillStyle = "#111715";
  routeContext.fillRect(0, 0, routeCanvas.width, routeCanvas.height);
  routeContext.fillStyle = "#efad35";
  routeContext.font = "900 94px Arial, sans-serif";
  routeContext.textAlign = "center";
  routeContext.textBaseline = "middle";
  routeContext.fillText("M15", 256, 84);
  const routeTexture = new THREE.CanvasTexture(routeCanvas);
  routeTexture.colorSpace = THREE.SRGBColorSpace;
  const routeMaterial = new THREE.MeshStandardMaterial({ map: routeTexture, emissiveMap: routeTexture, emissive: 0x6b3b08, emissiveIntensity: 0.7, side: THREE.DoubleSide });
  const routeSign = new THREE.Mesh(new THREE.PlaneGeometry(1.38, 0.43), routeMaterial);
  routeSign.position.set(0, 2.86, -5.99);
  routeSign.rotation.y = Math.PI;
  bus.add(routeSign);
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
  addSideMirrors(van, 1.04, isAmazon ? 1.78 : 1.6, -1.93, 1.12);
  van.userData.plateNumber = plateNumber;
  van.userData.plateMeshes = [frontPlate, rearPlate];
  van.userData.fleetKind = kind;
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
  addSideMirrors(truck, 1.06, 1.52, -2.36, 1.08);
  truck.userData.plateNumber = plateNumber;
  truck.userData.plateMeshes = [frontPlate, rearPlate];
  truck.userData.fleetKind = "box";
  return truck;
}

function makeGarbageTruck(plateNumber: string) {
  const truck = new THREE.Group();
  const greenPaint = new THREE.MeshPhysicalMaterial({ color: 0x304b3d, roughness: 0.48, metalness: 0.48, clearcoat: 0.2 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x20292a, roughness: 0.62, metalness: 0.65 });
  const cab = new THREE.Mesh(new RoundedBoxGeometry(2.16, 1.48, 1.95, 4, 0.14), greenPaint);
  cab.position.set(0, 1.14, -1.8);
  cab.castShadow = true;
  truck.add(cab);
  const compactor = new THREE.Mesh(new RoundedBoxGeometry(2.2, 1.98, 3.55, 4, 0.11), greenPaint);
  compactor.position.set(0, 1.48, 0.9);
  compactor.castShadow = true;
  truck.add(compactor);
  const hopper = new THREE.Mesh(new RoundedBoxGeometry(2.08, 1.38, 0.72, 3, 0.08), darkMetal);
  hopper.position.set(0, 1.2, 2.68);
  hopper.rotation.x = -0.12;
  truck.add(hopper);
  const hopperOpening = new THREE.Mesh(new RoundedBoxGeometry(1.72, 0.83, 0.045, 3, 0.04), new THREE.MeshStandardMaterial({ color: 0x0b0f10, roughness: 0.95 }));
  hopperOpening.position.set(0, 1.28, 3.045);
  hopperOpening.rotation.x = -0.12;
  truck.add(hopperOpening);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x29434a, roughness: 0.16, metalness: 0.08, transparent: true, opacity: 0.92 });
  const windshield = new THREE.Mesh(new RoundedBoxGeometry(1.72, 0.62, 0.055, 3, 0.03), glass);
  windshield.position.set(0, 1.55, -2.8);
  windshield.rotation.x = -0.1;
  truck.add(windshield);
  for (const side of [-1, 1]) {
    const window = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.52, 0.78, 3, 0.03), glass);
    window.position.set(side * 1.085, 1.57, -1.83);
    truck.add(window);
    const liftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.72, 10), darkMetal);
    const armStart = new THREE.Vector3(side * 1.15, 0.65, 2.08);
    const armEnd = new THREE.Vector3(side * 1.15, 1.92, 2.78);
    alignSegment(liftArm, armStart, armEnd);
    truck.add(liftArm);
    for (const ribZ of [-0.2, 0.55, 1.3]) {
      const rib = box(0.045, 1.72, 0.08, 0x263a31, side * 1.115, 1.52, ribZ);
      truck.add(rib);
    }
  }
  addFleetPanels(truck, "garbage", 1.56, 0.48, 2.35, 0.72, 1.106);
  addCommercialWheels(truck, [-1.82, 0.85, 1.7]);
  for (const x of [-0.72, 0.72]) {
    const frontLight = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.16, 0.05, 2, 0.02), new THREE.MeshStandardMaterial({ color: 0xe8dfbe, emissive: 0xb69c66, emissiveIntensity: 0.45 }));
    frontLight.position.set(x, 0.82, -2.82);
    truck.add(frontLight);
    const rearLight = frontLight.clone();
    rearLight.material = (frontLight.material as THREE.MeshStandardMaterial).clone();
    (rearLight.material as THREE.MeshStandardMaterial).color.setHex(0x8e2424);
    (rearLight.material as THREE.MeshStandardMaterial).emissive.setHex(0x6b1515);
    rearLight.position.set(x, 0.82, 3.07);
    truck.add(rearLight);
  }
  const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0xf0aa32, emissive: 0xc16b16, emissiveIntensity: 1.25 });
  for (const x of [-0.72, 0.72]) {
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.13, 12), beaconMaterial);
    beacon.position.set(x, 2.02, -1.76);
    truck.add(beacon);
  }
  const frontPlate = makeLicensePlate(plateNumber, -2.845, false);
  frontPlate.position.y = 0.66;
  const rearPlate = makeLicensePlate(plateNumber, 3.085, true);
  rearPlate.position.y = 0.66;
  truck.add(frontPlate, rearPlate);
  addSideMirrors(truck, 1.08, 1.54, -2.48, 1.12);
  truck.userData.plateNumber = plateNumber;
  truck.userData.plateMeshes = [frontPlate, rearPlate];
  truck.userData.fleetKind = "garbage";
  return truck;
}

function makeTransitBus(plateNumber: string) {
  const bus = new THREE.Group();
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(2.48, 2.75, 11.55, 5, 0.16),
    new THREE.MeshPhysicalMaterial({ color: 0xe5e8e8, roughness: 0.5, metalness: 0.28, clearcoat: 0.18 }),
  );
  body.position.y = 1.76;
  body.castShadow = true;
  bus.add(body);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x172b35, roughness: 0.2, transparent: true, opacity: 0.94 });
  const windshield = new THREE.Mesh(new RoundedBoxGeometry(2.08, 0.88, 0.055, 3, 0.03), glass);
  windshield.position.set(0, 2.35, -5.79);
  bus.add(windshield);
  addCommercialWheels(bus, [-3.85, 3.35]);
  addTransitBusMarkings(bus);
  const frontPlate = makeLicensePlate(plateNumber, -5.82, false);
  frontPlate.position.y = 0.62;
  const rearPlate = makeLicensePlate(plateNumber, 5.82, true);
  rearPlate.position.y = 0.62;
  bus.add(frontPlate, rearPlate);
  const mirrors = addSideMirrors(bus, 1.24, 2.28, -5.22, 1.12);
  bus.userData.plateNumber = plateNumber;
  bus.userData.plateMeshes = [frontPlate, rearPlate];
  bus.userData.mirrorMeshes = mirrors;
  bus.userData.fleetKind = "bus";
  return bus;
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
  const fallbackTreeTrunkGeometry = new THREE.CylinderGeometry(0.095, 0.095, 1.7, 10);
  const fallbackTreeTrunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4c382c, roughness: 0.96 });
  const fallbackTreeCrownGeometry = new THREE.IcosahedronGeometry(0.82, 2);
  const fallbackTreeCrownMaterial = new THREE.MeshStandardMaterial({ color: 0x364d3f, roughness: 0.98 });
  let cityBuildingIndex = 0;
  let streetTreeIndex = 0;

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
        const building = new THREE.Group();
        building.userData.cityBuildingDepth = width;
        building.userData.cityBuildingFrontage = 11.4 + ((i + b) % 3) * 0.5;
        building.userData.cityBuildingHeight = height;
        building.userData.cityBuildingIndex = cityBuildingIndex++;
        building.userData.cityBuildingSide = side;
        building.position.set(x, 0, z);
        const shell = box(width, height, 9.2, facade, 0, height / 2, 0);
        (shell.material as THREE.MeshStandardMaterial).roughness = 0.9;
        building.add(shell);
        const frontZ = side < 0 ? 4.64 : -4.64;
        for (let wy = 1.65; wy < height - 0.7; wy += 1.75) {
          for (const wx of [-1.35, 0, 1.35]) {
            const lit = (i + b + Math.round(wy) + (wx === 0 ? 1 : 0)) % 4 === 0;
            const window = new THREE.Mesh(new RoundedBoxGeometry(0.64, 0.82, 0.06, 2, 0.025), windowMaterials[lit ? 1 : 0]);
            window.position.set(wx, wy, frontZ);
            building.add(window);
          }
        }
        const cornice = box(width + 0.15, 0.18, 9.35, 0x4a4c4b, 0, height + 0.05, 0);
        building.add(cornice);
        if ((i + b) % 3 === 0) {
          const fireEscape = box(width * 0.63, 0.045, 0.55, 0x252b2e, 0, 4.3, frontZ + (side < 0 ? 0.34 : -0.34));
          building.add(fireEscape);
        }
        segment.add(building);
      }
      for (const tz of [-14, 2, 16]) {
        const tree = new THREE.Group();
        tree.userData.streetTreeIndex = streetTreeIndex++;
        tree.position.set(side * 9.05, 0.23, tz);
        const trunk = new THREE.Mesh(fallbackTreeTrunkGeometry, fallbackTreeTrunkMaterial);
        trunk.position.y = 0.85;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        tree.add(trunk);
        const crown = new THREE.Mesh(
          fallbackTreeCrownGeometry,
          fallbackTreeCrownMaterial,
        );
        crown.scale.set(1, 1.25, 1);
        crown.position.y = 1.95;
        crown.castShadow = true;
        crown.receiveShadow = true;
        tree.add(crown);
        segment.add(tree);
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

function loadRealisticStreetTrees(world: THREE.Group[]) {
  const placeholders: THREE.Group[] = [];
  world.forEach((segment) => segment.traverse((object) => {
    if (object instanceof THREE.Group && Number.isInteger(object.userData.streetTreeIndex)) {
      placeholders.push(object);
    }
  }));
  if (placeholders.length === 0) return;

  new GLTFLoader().load("/models/realistic-street-trees.glb", (gltf) => {
    const targetSizes = [
      { depth: 3.2, height: 5.4, width: 3.4 },
      { depth: 3.0, height: 5.0, width: 3.1 },
    ];
    const templates = ["StreetTreeA", "StreetTreeB"].map((name, index) => {
      const source = gltf.scene.getObjectByName(name);
      if (!source) return null;
      source.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const isLeaves = object.name.toLowerCase().includes("leaves");
        object.castShadow = !isLeaves;
        object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (!isLeaves) return;
          material.side = THREE.DoubleSide;
          material.alphaTest = Math.max(material.alphaTest, 0.36);
          material.transparent = false;
          material.depthWrite = true;
          material.needsUpdate = true;
        });
      });

      source.updateMatrixWorld(true);
      const sourceSize = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
      const target = targetSizes[index];
      source.scale.set(
        target.width / sourceSize.x,
        target.height / sourceSize.y,
        target.depth / sourceSize.z,
      );
      source.updateMatrixWorld(true);
      const fittedBounds = new THREE.Box3().setFromObject(source);
      const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
      source.position.x -= fittedCenter.x;
      source.position.y -= fittedBounds.min.y;
      source.position.z -= fittedCenter.z;
      source.updateMatrixWorld(true);

      const wrapper = new THREE.Group();
      wrapper.add(source);
      return wrapper;
    });
    if (templates.some((template) => template === null)) return;

    placeholders.forEach((placeholder) => {
      const index = placeholder.userData.streetTreeIndex as number;
      const template = templates[index % templates.length];
      if (!template) return;
      const instance = template.clone(true);
      const variation = 0.93 + ((index * 17) % 13) / 100;
      instance.scale.setScalar(variation);
      placeholder.clear();
      placeholder.rotation.y = ((index * 47) % 360) * THREE.MathUtils.DEG2RAD;
      placeholder.add(instance);
    });
  });
}

function loadRealisticNYCBuildings(world: THREE.Group[]) {
  const placeholders: THREE.Group[] = [];
  world.forEach((segment) => segment.traverse((object) => {
    if (object instanceof THREE.Group && Number.isInteger(object.userData.cityBuildingIndex)) {
      placeholders.push(object);
    }
  }));
  if (placeholders.length === 0) return;

  new GLTFLoader().load("/models/realistic-nyc-buildings.glb", (gltf) => {
    const templates = ["A", "B", "C", "D", "E", "F"].map((letter) => {
      const source = gltf.scene.getObjectByName(`NYCBuilding${letter}`);
      if (!source) return null;
      source.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = false;
        object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (!(material instanceof THREE.MeshStandardMaterial)) return;
          material.metalness = Math.min(material.metalness, 0.08);
          material.roughness = Math.max(material.roughness, 0.72);
          if (material.map) material.map.anisotropy = 4;
          material.needsUpdate = true;
        });
      });

      source.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(source);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      source.position.x -= center.x;
      source.position.y -= bounds.min.y;
      source.position.z -= center.z;
      source.updateMatrixWorld(true);

      const wrapper = new THREE.Group();
      wrapper.userData.sourceSize = size;
      wrapper.add(source);
      return wrapper;
    });
    if (templates.some((template) => template === null)) return;

    placeholders.forEach((placeholder) => {
      const index = placeholder.userData.cityBuildingIndex as number;
      const template = templates[index % templates.length];
      if (!template) return;
      const sourceSize = template.userData.sourceSize as THREE.Vector3;
      const depth = placeholder.userData.cityBuildingDepth as number;
      const frontage = placeholder.userData.cityBuildingFrontage as number;
      const height = placeholder.userData.cityBuildingHeight as number;
      const side = placeholder.userData.cityBuildingSide as -1 | 1;
      const instance = template.clone(true);
      instance.scale.set(
        frontage / sourceSize.x,
        height / sourceSize.y,
        depth / sourceSize.z,
      );
      instance.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      placeholder.clear();
      placeholder.position.x = side * (11.3 + depth * 0.5);
      placeholder.add(instance);
    });
  });
}

function makeObstacle(z: number, index: number, kind: Obstacle["kind"] = "bike-lane"): Obstacle {
  const plate = kind === "crosswalk" ? "X31-WLK" : plateNumbers[index % plateNumbers.length];
  // Keep yellow cabs in the recurring obstruction rotation, not just the
  // opening encounter, so riders cannot miss them during a longer session.
  const obstructionTypes: Array<"taxi" | "amazon" | "usps" | "box" | "garbage" | "bus"> = ["taxi", "amazon", "usps", "taxi", "garbage", "bus"];
  const obstructionType = kind === "crosswalk" ? "car" : obstructionTypes[index % obstructionTypes.length];
  const group = obstructionType === "amazon" || obstructionType === "usps"
    ? makeDeliveryVan(obstructionType, plate)
    : obstructionType === "box"
      ? makeBoxTruck(plate)
      : obstructionType === "garbage"
        ? makeGarbageTruck(plate)
        : obstructionType === "bus"
          ? makeTransitBus(plate)
        : makeTaxi(plate);
  const bounds = new THREE.Box3().setFromObject(group);
  const halfLength = (bounds.max.z - bounds.min.z) * 0.5;
  group.position.set(kind === "bike-lane" ? LANE_X + (index % 2 ? -0.22 : 0.18) : 1.2, 0, z);
  group.rotation.y = Math.PI;
  group.visible = kind === "bike-lane";
  return {
    group,
    z,
    halfLength,
    kind,
    plate,
    plates: group.userData.plateMeshes as THREE.Object3D[],
    active: kind === "bike-lane",
    resolving: false,
    timer: 0,
    baseScale: 1,
    helpers: [],
    mirrorBroken: false,
    mirrors: (group.userData.mirrorMeshes as THREE.Object3D[] | undefined) ?? [],
  };
}

type TrafficCar = { group: THREE.Group; z: number; speed: number; direction: 1 | -1; halfLength: number; lane: number };

function makeTraffic(scene: THREE.Scene) {
  const lanes = [1.2, -2.0, -5.1];
  const traffic: TrafficCar[] = [];
  const fleet: Array<"car" | "taxi" | "box" | "amazon" | "usps" | "garbage" | "bus"> = ["taxi", "garbage", "bus", "taxi", "amazon", "taxi", "usps", "car", "box", "amazon", "garbage", "bus"];
  for (let i = 0; i < fleet.length; i++) {
    // The lead cab travels with the rider, keeping it in view long enough to
    // be recognized before it reaches the first red light.
    const direction: 1 | -1 = i === 0 ? 1 : i % 4 === 0 ? -1 : 1;
    const lane = lanes[i % lanes.length];
    const kind = fleet[i];
    const plate = plateNumbers[(i + 5) % plateNumbers.length];
    const group = kind === "box"
      ? makeBoxTruck(plate)
      : kind === "garbage"
        ? makeGarbageTruck(plate)
      : kind === "bus"
        ? makeTransitBus(plate)
      : kind === "amazon" || kind === "usps"
        ? makeDeliveryVan(kind, plate)
        : kind === "taxi"
          ? makeTaxi(plate)
        : makeCar([0x24282a, 0x5f6364, 0x394b56, 0x70685c, 0x5a2f2d][i % 5], plate);
    const halfLength = kind === "bus" ? 5.96 : kind === "garbage" ? 3.05 : kind === "box" ? 2.75 : kind === "amazon" || kind === "usps" ? 2.35 : 2.05;
    if (kind === "car" || kind === "taxi") group.scale.setScalar(0.9 + (i % 3) * 0.025);
    group.position.set(lane, 0, -22 - i * 27);
    group.rotation.y = direction === 1 ? Math.PI : 0;
    scene.add(group);
    const speed = kind === "bus" ? 3.35 : kind === "garbage" ? 3.45 : kind === "box" ? 3.85 : kind === "amazon" || kind === "usps" ? 4.35 : 4.8 + (i % 3) * 0.62;
    traffic.push({ group, z: group.position.z, speed, direction, halfLength, lane });
  }
  return traffic;
}

function loadRivianAmazonFleet(traffic: TrafficCar[], obstacles: Obstacle[]) {
  const amazonTraffic = traffic.filter((vehicle) => vehicle.group.userData.fleetKind === "amazon");
  const amazonObstacles = obstacles.filter((obstacle) => obstacle.group.userData.fleetKind === "amazon");
  if (amazonTraffic.length === 0 && amazonObstacles.length === 0) return;

  new GLTFLoader().load("/models/rivian-amazon-van.glb", (gltf) => {
    const template = gltf.scene;
    for (const strayName of ["Cube", "Cube.001"]) {
      template.getObjectByName(strayName)?.removeFromParent();
    }
    // The supplied model's forward axis is +X; rotate it so its nose matches
    // the game's -Z vehicle convention before measuring and fitting it.
    template.rotation.y = -Math.PI / 2;
    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    template.scale.set(2.28 / sourceSize.x, 2.75 / sourceSize.y, 5.55 / sourceSize.z);
    template.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(template);
    const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
    template.position.set(-fittedCenter.x, -fittedBounds.min.y - 0.035, -fittedCenter.z);
    template.updateMatrixWorld(true);
    template.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const upgrade = (group: THREE.Group) => {
      group.clear();
      group.add(template.clone(true));
      const plateNumber = group.userData.plateNumber as string;
      const frontPlate = makeLicensePlate(plateNumber, -2.795, false);
      frontPlate.position.y = 0.84;
      const rearPlate = makeLicensePlate(plateNumber, 2.795, true);
      rearPlate.position.y = 0.84;
      group.add(frontPlate, rearPlate);
      const mirrors = addSideMirrors(group, 1.12, 1.74, -1.82, 1.08);
      group.userData.plateMeshes = [frontPlate, rearPlate];
      group.userData.mirrorMeshes = mirrors;
      group.userData.fleetKind = "amazon";
      return { mirrors, plates: [frontPlate, rearPlate] };
    };

    amazonTraffic.forEach((vehicle) => {
      upgrade(vehicle.group);
      vehicle.halfLength = 2.8;
    });
    amazonObstacles.forEach((obstacle) => {
      const parts = upgrade(obstacle.group);
      obstacle.halfLength = 2.8;
      obstacle.plates = parts.plates;
      obstacle.mirrors = parts.mirrors;
    });
  });
}

function loadNYCTaxiFleet(traffic: TrafficCar[], obstacles: Obstacle[]) {
  const taxiTraffic = traffic.filter((vehicle) => vehicle.group.userData.isTaxi);
  const taxiObstacles = obstacles.filter((obstacle) => obstacle.group.userData.isTaxi);
  if (taxiTraffic.length === 0 && taxiObstacles.length === 0) return;

  new GLTFLoader().load("/models/nyc-taxi-snowy.glb", (gltf) => {
    const template = gltf.scene;
    // This Crown Victoria was authored nose-first on +X. The game treats -Z
    // as a vehicle's front, so align that axis before fitting it to the road.
    template.rotation.y = Math.PI / 2;
    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    template.scale.setScalar(4.85 / sourceSize.z);
    template.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(template);
    const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
    template.position.set(-fittedCenter.x, -fittedBounds.min.y - 0.025, -fittedCenter.z);
    template.updateMatrixWorld(true);
    template.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const upgrade = (group: THREE.Group) => {
      group.clear();
      group.add(template.clone(true));
      // Keep the downloaded Crown Victoria immediately readable as an NYC cab.
      // The source texture is weathered/snowy, so the roof light and clean door
      // medallions provide a strong silhouette and identity at riding distance.
      addNYCTaxiMarkings(group);
      const plateNumber = group.userData.plateNumber as string;
      const frontPlate = makeLicensePlate(plateNumber, -2.44, false);
      frontPlate.position.y = 0.57;
      const rearPlate = makeLicensePlate(plateNumber, 2.44, true);
      rearPlate.position.y = 0.61;
      group.add(frontPlate, rearPlate);
      const mirrors = addSideMirrors(group, 1.02, 1.14, -0.72, 0.9);
      group.userData.plateMeshes = [frontPlate, rearPlate];
      group.userData.mirrorMeshes = mirrors;
      group.userData.isTaxi = true;
      group.userData.fleetKind = "taxi";
      return { mirrors, plates: [frontPlate, rearPlate] };
    };

    taxiTraffic.forEach((vehicle) => {
      upgrade(vehicle.group);
      vehicle.halfLength = 2.43;
    });
    taxiObstacles.forEach((obstacle) => {
      const parts = upgrade(obstacle.group);
      obstacle.halfLength = 2.43;
      obstacle.plates = parts.plates;
      obstacle.mirrors = parts.mirrors;
    });
  });
}

function loadRealisticPassengerFleet(scene: THREE.Scene, traffic: TrafficCar[], obstacles: Obstacle[]) {
  const trafficCars = traffic.filter((vehicle) => vehicle.group.userData.fleetKind === "car");
  const obstacleCars = obstacles.filter((obstacle) => obstacle.group.userData.fleetKind === "car");
  const trackedGroups = new Set<THREE.Group>([
    ...trafficCars.map((vehicle) => vehicle.group),
    ...obstacleCars.map((obstacle) => obstacle.group),
  ]);
  const parkedCars: THREE.Group[] = [];
  scene.traverse((object) => {
    if (
      object instanceof THREE.Group
      && object.userData.fleetKind === "car"
      && !object.userData.isTaxi
      && !trackedGroups.has(object)
    ) parkedCars.push(object);
  });
  if (trafficCars.length === 0 && obstacleCars.length === 0 && parkedCars.length === 0) return;

  new GLTFLoader().load("/models/realistic-passenger-fleet.glb", (gltf) => {
    const variantSpecs = [
      { name: "Sedan", width: 1.9, height: 1.46, length: 4.48, plateY: 0.58, mirrorY: 1.04, mirrorZ: -0.58, mirrorSize: 0.92 },
      { name: "Hatchback", width: 1.82, height: 1.5, length: 4.08, plateY: 0.58, mirrorY: 1.06, mirrorZ: -0.56, mirrorSize: 0.9 },
      { name: "Minivan", width: 1.98, height: 1.82, length: 4.72, plateY: 0.64, mirrorY: 1.28, mirrorZ: -1.02, mirrorSize: 1 },
      { name: "SUV", width: 2.02, height: 1.82, length: 4.7, plateY: 0.66, mirrorY: 1.24, mirrorZ: -1.18, mirrorSize: 1 },
    ] as const;
    const variants = variantSpecs.flatMap((spec) => {
      const source = gltf.scene.getObjectByName(spec.name);
      if (!source) return [];
      const template = source.clone(true);
      // The cleaned Blender assets face -Y, which becomes +Z in glTF.
      // Turn them back toward the game's -Z vehicle-forward convention.
      template.rotation.y += Math.PI;
      template.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(template);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      template.scale.multiply(new THREE.Vector3(
        spec.width / sourceSize.x,
        spec.height / sourceSize.y,
        spec.length / sourceSize.z,
      ));
      template.updateMatrixWorld(true);
      const fittedBounds = new THREE.Box3().setFromObject(template);
      const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
      template.position.add(new THREE.Vector3(-fittedCenter.x, -fittedBounds.min.y - 0.02, -fittedCenter.z));
      template.updateMatrixWorld(true);
      template.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      return [{ spec, template }];
    });
    if (variants.length === 0) return;

    const upgrade = (group: THREE.Group, variantIndex: number) => {
      const variant = variants[variantIndex % variants.length];
      const { spec, template } = variant;
      group.clear();
      group.add(template.clone(true));
      const plateNumber = group.userData.plateNumber as string;
      const frontPlate = makeLicensePlate(plateNumber, -spec.length * 0.5 - 0.015, false);
      frontPlate.position.y = spec.plateY;
      const rearPlate = makeLicensePlate(plateNumber, spec.length * 0.5 + 0.015, true);
      rearPlate.position.y = spec.plateY;
      group.add(frontPlate, rearPlate);
      const mirrors = addSideMirrors(group, spec.width * 0.5, spec.mirrorY, spec.mirrorZ, spec.mirrorSize);
      group.userData.plateMeshes = [frontPlate, rearPlate];
      group.userData.mirrorMeshes = mirrors;
      group.userData.fleetKind = "car";
      group.userData.passengerVariant = spec.name;
      return { halfLength: spec.length * 0.5, mirrors, plates: [frontPlate, rearPlate] };
    };

    let variantIndex = 0;
    trafficCars.forEach((vehicle) => {
      const parts = upgrade(vehicle.group, variantIndex++);
      vehicle.halfLength = parts.halfLength;
    });
    obstacleCars.forEach((obstacle) => {
      const parts = upgrade(obstacle.group, variantIndex++);
      obstacle.halfLength = parts.halfLength;
      obstacle.plates = parts.plates;
      obstacle.mirrors = parts.mirrors;
    });
    parkedCars.forEach((group) => upgrade(group, variantIndex++));
  });
}

function addPoliceCruiserMarkings(cruiser: THREE.Group) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 240;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f5f2";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#174d86";
  ctx.fillRect(0, 0, canvas.width, 58);
  ctx.fillRect(0, 190, canvas.width, 18);
  ctx.fillStyle = "#173c67";
  ctx.font = "900 84px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("POLICE", 384, 157);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.68, 0.48), material);
    panel.position.set(side * 0.996, 0.94, 0.15);
    panel.rotation.y = side * Math.PI / 2;
    cruiser.add(panel);
  }
  const red = new THREE.MeshStandardMaterial({ color: 0xe83b32, emissive: 0xd51f19, emissiveIntensity: 1.5 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x2875d5, emissive: 0x165dc3, emissiveIntensity: 1.5 });
  for (const side of [-1, 1]) {
    const light = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.1, 0.2, 2, 0.035), side < 0 ? red : blue);
    light.position.set(side * 0.23, 1.58, 0.05);
    cruiser.add(light);
  }
}

function loadRealisticPoliceCruiser(onReady: (template: THREE.Object3D) => void) {
  new GLTFLoader().load("/models/realistic-passenger-fleet.glb", (gltf) => {
    const source = gltf.scene.getObjectByName("Sedan");
    if (!source) return;
    const template = source.clone(true);
    template.rotation.y += Math.PI;
    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    template.scale.multiply(new THREE.Vector3(1.94 / sourceSize.x, 1.48 / sourceSize.y, 4.62 / sourceSize.z));
    template.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(template);
    const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
    template.position.add(new THREE.Vector3(-fittedCenter.x, -fittedBounds.min.y - 0.02, -fittedCenter.z));
    template.updateMatrixWorld(true);
    template.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    onReady(template);
  });
}

function makePoliceCruiser(template: THREE.Object3D | null) {
  const cruiser = new THREE.Group();
  const attach = (loadedTemplate: THREE.Object3D) => {
    cruiser.add(loadedTemplate.clone(true));
    cruiser.visible = true;
  };
  if (template) attach(template);
  else {
    cruiser.visible = false;
    loadRealisticPoliceCruiser(attach);
  }
  addPoliceCruiserMarkings(cruiser);
  return cruiser;
}

function loadRealisticUSPSFleet(traffic: TrafficCar[], obstacles: Obstacle[]) {
  const uspsTraffic = traffic.filter((vehicle) => vehicle.group.userData.fleetKind === "usps");
  const uspsObstacles = obstacles.filter((obstacle) => obstacle.group.userData.fleetKind === "usps");
  if (uspsTraffic.length === 0 && uspsObstacles.length === 0) return;

  new GLTFLoader().load("/models/realistic-usps-step-van.glb", (gltf) => {
    const template = gltf.scene;
    // Both new service vehicles were authored front-first on Blender's -Y
    // axis, which arrives in Three.js as +Z. Turn the nose toward game -Z.
    template.rotation.y = Math.PI;
    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    template.scale.set(2.12 / sourceSize.x, 2.18 / sourceSize.y, 4.55 / sourceSize.z);
    template.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(template);
    const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
    template.position.set(-fittedCenter.x, -fittedBounds.min.y - 0.025, -fittedCenter.z);
    template.updateMatrixWorld(true);
    template.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const upgrade = (group: THREE.Group) => {
      group.clear();
      group.add(template.clone(true));
      addFleetPanels(group, "usps", 1.32, 0.22, 2.3, 0.66, 1.066);
      const plateNumber = group.userData.plateNumber as string;
      const frontPlate = makeLicensePlate(plateNumber, -2.29, false);
      frontPlate.position.y = 0.57;
      const rearPlate = makeLicensePlate(plateNumber, 2.29, true);
      rearPlate.position.y = 0.52;
      group.add(frontPlate, rearPlate);
      const mirrors = addSideMirrors(group, 1.06, 1.5, -1.58, 1.05);
      group.userData.plateMeshes = [frontPlate, rearPlate];
      group.userData.mirrorMeshes = mirrors;
      group.userData.fleetKind = "usps";
      return { mirrors, plates: [frontPlate, rearPlate] };
    };

    uspsTraffic.forEach((vehicle) => {
      upgrade(vehicle.group);
      vehicle.halfLength = 2.3;
    });
    uspsObstacles.forEach((obstacle) => {
      const parts = upgrade(obstacle.group);
      obstacle.halfLength = 2.3;
      obstacle.plates = parts.plates;
      obstacle.mirrors = parts.mirrors;
    });
  });
}

function loadRealisticBoxFleet(traffic: TrafficCar[], obstacles: Obstacle[]) {
  const boxTraffic = traffic.filter((vehicle) => vehicle.group.userData.fleetKind === "box");
  const boxObstacles = obstacles.filter((obstacle) => obstacle.group.userData.fleetKind === "box");
  if (boxTraffic.length === 0 && boxObstacles.length === 0) return;

  new GLTFLoader().load("/models/realistic-box-truck.glb", (gltf) => {
    const template = gltf.scene;
    template.rotation.y = Math.PI;
    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    template.scale.set(2.22 / sourceSize.x, 2.7 / sourceSize.y, 5.75 / sourceSize.z);
    template.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(template);
    const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
    template.position.set(-fittedCenter.x, -fittedBounds.min.y - 0.035, -fittedCenter.z);
    template.updateMatrixWorld(true);
    template.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const upgrade = (group: THREE.Group) => {
      group.clear();
      group.add(template.clone(true));
      const plateNumber = group.userData.plateNumber as string;
      const frontPlate = makeLicensePlate(plateNumber, -2.9, false);
      frontPlate.position.y = 0.68;
      const rearPlate = makeLicensePlate(plateNumber, 2.9, true);
      rearPlate.position.y = 0.66;
      group.add(frontPlate, rearPlate);
      const mirrors = addSideMirrors(group, 1.11, 1.58, -2.18, 1.15);
      group.userData.plateMeshes = [frontPlate, rearPlate];
      group.userData.mirrorMeshes = mirrors;
      group.userData.fleetKind = "box";
      return { mirrors, plates: [frontPlate, rearPlate] };
    };

    boxTraffic.forEach((vehicle) => {
      upgrade(vehicle.group);
      vehicle.halfLength = 2.9;
    });
    boxObstacles.forEach((obstacle) => {
      const parts = upgrade(obstacle.group);
      obstacle.halfLength = 2.9;
      obstacle.plates = parts.plates;
      obstacle.mirrors = parts.mirrors;
    });
  });
}

function loadRealisticGarbageFleet(traffic: TrafficCar[], obstacles: Obstacle[]) {
  const garbageTraffic = traffic.filter((vehicle) => vehicle.group.userData.fleetKind === "garbage");
  const garbageObstacles = obstacles.filter((obstacle) => obstacle.group.userData.fleetKind === "garbage");
  if (garbageTraffic.length === 0 && garbageObstacles.length === 0) return;

  new GLTFLoader().load("/models/realistic-garbage-truck.glb", (gltf) => {
    const template = gltf.scene;
    // The source truck points down -X; align its cab with the game's -Z front.
    template.rotation.y = -Math.PI / 2;
    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    template.scale.set(2.38 / sourceSize.x, 3.08 / sourceSize.y, 6.62 / sourceSize.z);
    template.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(template);
    const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
    template.position.set(-fittedCenter.x, -fittedBounds.min.y - 0.035, -fittedCenter.z);
    template.updateMatrixWorld(true);
    template.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const upgrade = (group: THREE.Group) => {
      group.clear();
      group.add(template.clone(true));
      const plateNumber = group.userData.plateNumber as string;
      const frontPlate = makeLicensePlate(plateNumber, -3.33, false);
      frontPlate.position.y = 0.62;
      const rearPlate = makeLicensePlate(plateNumber, 3.33, true);
      rearPlate.position.y = 0.69;
      group.add(frontPlate, rearPlate);
      const mirrors = addSideMirrors(group, 1.16, 1.72, -2.4, 1.16);
      group.userData.plateMeshes = [frontPlate, rearPlate];
      group.userData.mirrorMeshes = mirrors;
      group.userData.fleetKind = "garbage";
      return { mirrors, plates: [frontPlate, rearPlate] };
    };

    garbageTraffic.forEach((vehicle) => {
      upgrade(vehicle.group);
      vehicle.halfLength = 3.34;
    });
    garbageObstacles.forEach((obstacle) => {
      const parts = upgrade(obstacle.group);
      obstacle.halfLength = 3.34;
      obstacle.plates = parts.plates;
      obstacle.mirrors = parts.mirrors;
    });
  });
}

function loadRealisticTransitBusFleet(traffic: TrafficCar[], obstacles: Obstacle[]) {
  const busTraffic = traffic.filter((vehicle) => vehicle.group.userData.fleetKind === "bus");
  const busObstacles = obstacles.filter((obstacle) => obstacle.group.userData.fleetKind === "bus");
  if (busTraffic.length === 0 && busObstacles.length === 0) return;

  new GLTFLoader().load("/models/realistic-transit-bus.glb", (gltf) => {
    const template = gltf.scene;
    // The source bus exports nose-first on +Z; align it with the game's -Z
    // vehicle convention before fitting and cloning it into traffic.
    template.rotation.y = Math.PI;
    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    template.scale.set(2.55 / sourceSize.x, 3.42 / sourceSize.y, 11.9 / sourceSize.z);
    template.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(template);
    const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
    template.position.set(-fittedCenter.x, -fittedBounds.min.y - 0.025, -fittedCenter.z);
    template.updateMatrixWorld(true);
    template.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const upgrade = (group: THREE.Group) => {
      group.clear();
      group.add(template.clone(true));
      addTransitBusMarkings(group);
      const plateNumber = group.userData.plateNumber as string;
      const frontPlate = makeLicensePlate(plateNumber, -5.97, false);
      frontPlate.position.y = 0.64;
      const rearPlate = makeLicensePlate(plateNumber, 5.97, true);
      rearPlate.position.y = 0.64;
      group.add(frontPlate, rearPlate);
      const mirrors = addSideMirrors(group, 1.27, 2.28, -5.4, 1.12);
      group.userData.plateMeshes = [frontPlate, rearPlate];
      group.userData.mirrorMeshes = mirrors;
      group.userData.fleetKind = "bus";
      return { mirrors, plates: [frontPlate, rearPlate] };
    };

    busTraffic.forEach((vehicle) => {
      upgrade(vehicle.group);
      vehicle.halfLength = 5.97;
    });
    busObstacles.forEach((obstacle) => {
      const parts = upgrade(obstacle.group);
      obstacle.halfLength = 5.97;
      obstacle.plates = parts.plates;
      obstacle.mirrors = parts.mirrors;
    });
  });
}

function loadRealisticTowTruck(onReady: (template: THREE.Object3D) => void) {
  new GLTFLoader().load("/models/realistic-tow-truck.glb", (gltf) => {
    const template = gltf.scene;
    template.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(template);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    template.scale.set(2.12 / sourceSize.x, 2.12 / sourceSize.y, 5.95 / sourceSize.z);
    template.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(template);
    const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
    template.position.set(-fittedCenter.x, -fittedBounds.min.y - 0.025, -fittedCenter.z);
    template.updateMatrixWorld(true);
    template.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    onReady(template);
  });
}

function makeTowTruck(template: THREE.Object3D | null) {
  const truck = new THREE.Group();
  if (template) truck.add(template.clone(true));
  else {
    truck.visible = false;
    loadRealisticTowTruck((loadedTemplate) => {
      truck.add(loadedTemplate.clone(true));
      truck.visible = true;
    });
  }
  const lightbarMaterial = new THREE.MeshStandardMaterial({ color: 0xf2a52e, emissive: 0xd26412, emissiveIntensity: 1.35, roughness: 0.3 });
  for (const x of [-0.26, 0.26]) {
    const beacon = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.11, 0.16, 2, 0.035), lightbarMaterial);
    beacon.position.set(x, 2.1, -0.42);
    truck.add(beacon);
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
  const audioRef = useRef<GameAudio | null>(null);
  const mutedRef = useRef(false);
  const runtimeRef = useRef<{
    started: boolean;
    phone: boolean;
    keys: Set<string>;
    ripMirror: () => void;
    snap: () => void;
    switchRider: () => RiderChoice;
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
  const [muted, setMuted] = useState(false);
  const [rider, setRider] = useState<RiderChoice>("hero");
  const [policeCall, setPoliceCall] = useState<PoliceCallState>(null);

  const ensureAudio = useCallback(() => {
    if (audioRef.current) {
      void audioRef.current.context.resume();
      return audioRef.current;
    }
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioCtx();
      const master = context.createGain();
      master.gain.value = mutedRef.current ? 0 : 0.62;
      master.connect(context.destination);
      const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const channel = noise.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
      audioRef.current = { context, master, musicStarted: false, noise };
      void context.resume();
      return audioRef.current;
    } catch {
      return null;
    }
  }, []);

  const beep = useCallback((frequency = 620, length = 0.08) => {
    if (mutedRef.current) return;
    const audio = ensureAudio();
    if (!audio) return;
    const { context, master } = audio;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + length);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(context.currentTime + length);
  }, [ensureAudio]);

  const startMusic = useCallback(() => {
    const audio = ensureAudio();
    if (!audio || audio.musicStarted) return;
    audio.musicStarted = true;
    const { context, master } = audio;
    const duration = 12;
    const buffer = context.createBuffer(2, context.sampleRate * duration, context.sampleRate);
    const notes = [146.83, 174.61, 220, 196, 164.81, 196, 246.94, 220];
    for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
      const data = buffer.getChannelData(channelIndex);
      for (let i = 0; i < data.length; i++) {
        const time = i / context.sampleRate;
        const stepTime = time % 1.5;
        const note = notes[Math.floor(time / 1.5) % notes.length];
        const envelope = Math.min(1, stepTime * 3.5) * Math.exp(-stepTime * 1.45);
        const stereoDrift = channelIndex ? 0.997 : 1.003;
        data[i] = (
          Math.sin(time * note * stereoDrift * Math.PI * 2)
          + Math.sin(time * note * 0.5 * Math.PI * 2) * 0.38
        ) * envelope * 0.12;
      }
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 920;
    gain.gain.value = 0.12;
    source.connect(filter).connect(gain).connect(master);
    source.start();
  }, [ensureAudio]);

  const playNoiseBurst = useCallback((frequency: number, volume: number, duration: number, delay = 0) => {
    if (mutedRef.current) return;
    const audio = ensureAudio();
    if (!audio) return;
    const { context, master, noise } = audio;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    source.buffer = noise;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 1.8;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(start);
    source.stop(start + duration);
  }, [ensureAudio]);

  const playCameraSnap = useCallback(() => {
    playNoiseBurst(1450, 0.18, 0.045);
    playNoiseBurst(950, 0.1, 0.065, 0.055);
    beep(1050, 0.035);
  }, [beep, playNoiseBurst]);

  const playBreakSound = useCallback(() => {
    playNoiseBurst(2200, 0.32, 0.22);
    playNoiseBurst(3600, 0.2, 0.16, 0.025);
    beep(165, 0.18);
  }, [beep, playNoiseBurst]);

  const playChainSound = useCallback(() => {
    playNoiseBurst(2850, 0.012, 0.025);
  }, [playNoiseBurst]);

  useEffect(() => {
    const loadPreferenceFrame = window.requestAnimationFrame(() => {
      const savedMuted = window.localStorage.getItem("lane-justice-muted") === "true";
      mutedRef.current = savedMuted;
      setMuted(savedMuted);
    });
    return () => {
      window.cancelAnimationFrame(loadPreferenceFrame);
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio) void audio.context.close();
    };
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
    loadRealisticNYCBuildings(world);
    loadRealisticStreetTrees(world);
    const intersections = world.filter((segment) => segment.userData.isIntersection);
    const signalLamps: THREE.Mesh[] = [];
    intersections.forEach((segment) => segment.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.signal) signalLamps.push(object);
    }));
    const bike = makeBike();
    scene.add(bike);
    loadRealisticBike(bike);
    loadRealisticRider(bike);
    const pedalRig = bike.userData.pedalRig as PedalRig;
    const updatePedaling = (angle: number) => {
      const hasRealisticBike = Boolean(bike.userData.realisticBike);
      const crankCenter = hasRealisticBike
        ? new THREE.Vector3(0, 0.34, 0.09)
        : new THREE.Vector3(0, 0.64, 0.19);
      const pedalRadius = hasRealisticBike ? 0.16 : 0.17;
      const pedalX = hasRealisticBike ? 0.11 : 0.17;
      const placeLeg = (side: -1 | 1, phase: number, upper: THREE.Mesh, lower: THREE.Mesh, shoe: THREE.Mesh, crankArm: THREE.Mesh) => {
        const hip = new THREE.Vector3(side * 0.13, 1.3, 0.2);
        const pedal = new THREE.Vector3(
          side * pedalX,
          crankCenter.y + Math.cos(phase) * pedalRadius,
          crankCenter.z + Math.sin(phase) * pedalRadius,
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
      const realisticCrank = bike.userData.realisticBikeCrank as THREE.Object3D | undefined;
      if (realisticCrank) realisticCrank.rotation.x = angle;
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
    // Lead with the taxi close enough to be recognizable within the opening
    // seconds; the remaining obstruction cadence stays unchanged.
    const obstacles: Obstacle[] = [0, 1, 2, 3, 4, 5].map((_, i) => makeObstacle(-26 - i * 63, i));
    const crosswalkViolation = makeObstacle(-114, 7, "crosswalk");
    obstacles.push(crosswalkViolation);
    obstacles.forEach((o) => scene.add(o.group));
    loadRivianAmazonFleet(traffic, obstacles);
    loadNYCTaxiFleet(traffic, obstacles);
    loadRealisticPassengerFleet(scene, traffic, obstacles);
    loadRealisticUSPSFleet(traffic, obstacles);
    loadRealisticBoxFleet(traffic, obstacles);
    loadRealisticGarbageFleet(traffic, obstacles);
    loadRealisticTransitBusFleet(traffic, obstacles);
    let realisticTowTruck: THREE.Object3D | null = null;
    loadRealisticTowTruck((template) => { realisticTowTruck = template; });
    let realisticPoliceCruiser: THREE.Object3D | null = null;
    loadRealisticPoliceCruiser((template) => { realisticPoliceCruiser = template; });
    const keys = new Set<string>();
    let desiredSpeed = 8.2;
    let actualSpeed = 0;
    let meters = 0;
    let scoreStreak = 0;
    let submittedReports = 0;
    let policeCallTriggered = false;
    let policeCallTimer: number | null = null;
    let rideEpoch = 0;
    let lastUi = 0;
    let bikeX = LANE_X;
    let nearest: Obstacle | null = null;
    let currentAssessment: FrameAssessment | null = null;
    let phoneOpen = false;
    let running = false;
    let signalRed = true;
    let crosswalkCooldown = 3;
    let flashTimer = 0;
    let chainTimer = 0;
    const clock = new THREE.Clock();
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
    const brokenMirrors: {
      object: THREE.Object3D;
      velocity: THREE.Vector3;
      spin: THREE.Vector3;
      life: number;
    }[] = [];
    let ripGesture: { timer: number; side: -1 | 1; target: THREE.Vector3 } | null = null;
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
        const leftEdge = new THREE.Vector3(-US_LICENSE_PLATE_WIDTH / 2, 0, 0).applyMatrix4(plateMesh.matrixWorld).project(phoneCamera);
        const rightEdge = new THREE.Vector3(US_LICENSE_PLATE_WIDTH / 2, 0, 0).applyMatrix4(plateMesh.matrixWorld).project(phoneCamera);
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
        title: obstacle.kind === "crosswalk" ? `Crosswalk report · +${points}`
          : resolution === "BOOM!" ? "Obstruction cleared"
          : resolution === "VANISHED!" ? "Vehicle removed"
          : resolution === "TICKETED!" ? "Citation issued"
          : "Tow dispatched",
        text: obstacle.kind === "crosswalk" ? "Vehicle documented past the stop line during a red light."
          : resolution === "TOWED!" ? "Wait for the lane to clear before continuing."
          : "The bike lane is clear.",
      });
      setTimeout(() => setFeed(null), 2600);
      addBurst(obstacle.group.position.clone());

      if (resolution === "TICKETED!") {
        const cop = makePoliceCruiser(realisticPoliceCruiser);
        cop.position.copy(obstacle.group.position).add(new THREE.Vector3(-6, 0, 0));
        cop.rotation.y = -Math.PI / 2;
        scene.add(cop);
        obstacle.helpers.push(cop);
        const ticket = box(0.42, 0.03, 0.62, colors.yellow, 0, 1.36, -1.94);
        ticket.visible = false;
        obstacle.group.add(ticket);
        obstacle.helpers.push(ticket);
      }
      if (resolution === "TOWED!") {
        const tow = makeTowTruck(realisticTowTruck);
        tow.position.copy(obstacle.group.position).add(new THREE.Vector3(-8, 0, 1.2));
        scene.add(tow);
        obstacle.helpers.push(tow);
      }
    };

    const capturePhoneFrame = () => {
      // Copy the exact canvas currently shown in the phone. Capturing before any
      // scene state changes keeps the evidence image identical to the viewfinder.
      const source = phoneRenderer.domElement;
      const capture = document.createElement("canvas");
      capture.width = source.width;
      capture.height = source.height;
      const context = capture.getContext("2d");
      if (!context) return "";
      context.drawImage(source, 0, 0, capture.width, capture.height);
      try {
        return capture.toDataURL("image/jpeg", 0.9);
      } catch {
        return "";
      }
    };

    const beginAutoReport = (obstacle: Obstacle, photo: string) => {
      const reportRide = rideEpoch;
      obstacle.active = false;
      obstacle.resolving = true;
      obstacle.timer = 0;
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
      setFeed({ title: "Reading license plate", text: "Checking the plate in your photo." });

      reportTimers.push(window.setTimeout(() => {
        if (reportRide !== rideEpoch) return;
        setReport((current) => current ? {
          ...current,
          confidence: 94 + Math.floor(Math.random() * 5),
          plate: obstacle.plate,
          status: "preparing",
        } : current);
        setFeed({ title: `Plate ${obstacle.plate}`, text: "The report is ready and is being submitted." });
      }, 680));

      reportTimers.push(window.setTimeout(() => {
        if (reportRide !== rideEpoch) return;
        setReport((current) => current ? { ...current, status: "submitted" } : current);
        resolveObstacle(obstacle);
        submittedReports += 1;
        if (submittedReports === 3 && !policeCallTriggered) {
          policeCallTriggered = true;
          policeCallTimer = window.setTimeout(() => {
            setPoliceCall("ringing");
            beep(690, 0.18);
            reportTimers.push(window.setTimeout(() => beep(690, 0.18), 420));
          }, 850);
        }
      }, 1450));

      reportTimers.push(window.setTimeout(() => {
        if (reportRide === rideEpoch) setReport(null);
      }, 5200));
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
      playCameraSnap();
      renderPhoneCamera();
      const photo = capturePhoneFrame();
      const assessment = getTargetAssessment();
      const target = assessment?.obstacle ?? null;
      if (target && assessment?.plateInFrame) {
        beginAutoReport(target, photo);
        phoneOpen = false;
        setPhone(false);
        setLocked(false);
        setVehicleFramed(false);
        setPrompt("EVIDENCE CAPTURED — ALPR RUNNING");
      } else if (target && assessment?.vehicleInFrame) {
        setFeed({
          title: "Plate not readable",
          text: "Keep the license plate inside the focus box and try again.",
        });
        setPrompt("CENTER THE LICENSE PLATE — THEN SNAP AGAIN");
        beep(220, 0.12);
        setTimeout(() => setFeed(null), 1800);
      } else {
        setFeed({ title: "Nothing captured", text: "Keep the vehicle and its plate inside the frame." });
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

    const findRippableMirror = () => {
      let closest: {
        obstacle: Obstacle;
        mirror: THREE.Object3D;
        position: THREE.Vector3;
        distance: number;
      } | null = null;

      for (const obstacle of obstacles) {
        if (
          obstacle.kind !== "bike-lane"
          || !obstacle.active
          || obstacle.resolving
          || obstacle.mirrorBroken
          || !obstacle.group.visible
        ) continue;

        const longitudinal = Math.abs(obstacle.z - bike.position.z);
        const lateral = Math.abs(obstacle.group.position.x - bikeX);
        if (longitudinal > 4.2 || lateral < 0.82 || lateral > 3.15) continue;

        obstacle.group.updateMatrixWorld(true);
        for (const mirror of obstacle.mirrors) {
          if (!mirror.visible) continue;
          const position = mirror.getWorldPosition(new THREE.Vector3());
          const reach = position.distanceTo(new THREE.Vector3(bikeX, 1.45, bike.position.z));
          if (reach > 1.45 || (closest && reach >= closest.distance)) continue;
          closest = { obstacle, mirror, position, distance: reach };
        }
      }
      return closest;
    };

    const ripMirror = () => {
      if (!running || phoneOpen || ripGesture) return;
      const target = findRippableMirror();
      if (!target) {
        beep(190, 0.08);
        return;
      }

      const flyingMirror = target.mirror.clone(true);
      flyingMirror.position.copy(target.position);
      flyingMirror.quaternion.copy(target.mirror.getWorldQuaternion(new THREE.Quaternion()));
      flyingMirror.scale.copy(target.mirror.getWorldScale(new THREE.Vector3()));
      scene.add(flyingMirror);
      target.mirror.visible = false;
      target.obstacle.mirrorBroken = true;

      const throwSide = Math.sign(target.position.x - target.obstacle.group.position.x) || 1;
      ripGesture = {
        timer: 0,
        side: target.position.x < bikeX ? -1 : 1,
        target: target.position.clone(),
      };
      brokenMirrors.push({
        object: flyingMirror,
        velocity: new THREE.Vector3(throwSide * 2.6, 2.2, 3.2),
        spin: new THREE.Vector3(8, throwSide * 11, 6),
        life: 2.1,
      });
      setPrompt("MIRROR OFF — KEEP RIDING");
      playBreakSound();
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
      rideEpoch += 1;
      submittedReports = 0;
      policeCallTriggered = false;
      if (policeCallTimer !== null) window.clearTimeout(policeCallTimer);
      policeCallTimer = null;
      setStreak(0);
      setCrashed(false);
      setReport(null);
      setPoliceCall(null);
      window.speechSynthesis?.cancel();
      setPrompt("RIDE THE BIKE LANE");
      running = true;
      if (runtimeRef.current) runtimeRef.current.started = true;
      beep(520, 0.12);
    };

    const cycleRider = () => switchRider(bike);
    runtimeRef.current = { started: running, phone: phoneOpen, keys, ripMirror, snap, switchRider: cycleRider, togglePhone, resetRide };

    const keydown = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
      keys.add(event.key.toLowerCase());
      if (event.repeat) return;
      if (event.key.toLowerCase() === "e") togglePhone();
      if (event.key.toLowerCase() === "f") ripMirror();
      if (event.key.toLowerCase() === "c") setRider(cycleRider());
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
        const activeColor = name === "red" ? 0xff3030 : name === "amber" ? 0xffc928 : 0x27d66f;
        material.color.setHex(on ? activeColor : 0x202527);
        material.emissive.setHex(activeColor);
        material.emissiveIntensity = on ? 4.8 : 0.025;
      });
      running = runtimeRef.current?.started ?? false;
      if (runtimeRef.current) {
        runtimeRef.current.phone = phoneOpen;
        runtimeRef.current.ripMirror = ripMirror;
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
          // Let the bike reach and slightly overlap the visible bumper instead
          // of stopping against a large, invisible center-distance boundary.
          && obstacle.z > bike.position.z - obstacle.halfLength - 0.12
          && obstacle.z < bike.position.z + obstacle.halfLength
          && Math.abs(obstacle.group.position.x - bike.position.x) < 1.02);
        const targetSpeed = blocked ? Math.min(desiredSpeed, 1.8) : desiredSpeed;
        actualSpeed = THREE.MathUtils.lerp(actualSpeed, targetSpeed, dt * (blocked ? 5 : 1.9));
        const dz = actualSpeed * dt;
        meters += dz;
        chainTimer -= dt;
        if (actualSpeed > 0.8 && chainTimer <= 0) {
          playChainSound();
          chainTimer = THREE.MathUtils.clamp(0.2 - actualSpeed * 0.01, 0.065, 0.19);
        }

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
            obstacle.mirrorBroken = false;
            obstacle.mirrors.forEach((mirror) => { mirror.visible = true; });
          }
          if (!obstacle.active && !obstacle.resolving && obstacle.z > 15) {
            obstacle.z -= 5 * 63;
            obstacle.group.position.set(LANE_X + (Math.random() - 0.5) * 0.48, 0, obstacle.z);
            obstacle.group.rotation.set(0, Math.PI, 0);
            obstacle.group.scale.setScalar(1);
            obstacle.group.visible = true;
            obstacle.active = true;
            obstacle.resolution = undefined;
            obstacle.mirrorBroken = false;
            obstacle.mirrors.forEach((mirror) => { mirror.visible = true; });
          }
        }

        currentAssessment = getTargetAssessment();
        nearest = currentAssessment?.obstacle ?? null;
        const rippableMirror = phoneOpen ? null : findRippableMirror();
        if (rippableMirror) {
          setLocked(false);
          setVehicleFramed(false);
          setPrompt("F — RIP OFF MIRROR");
        } else if (nearest && nearest.active && nearest.z > -40 && nearest.z < 3 && currentAssessment) {
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
          setPrompt(phoneOpen ? "NO VIOLATION IN FRAME — E TO POCKET" : `TRAFFIC SIGNAL — ${signalRed ? "RED" : signalAmber ? "YELLOW" : "GREEN"}`);
        }
      }

      bike.position.y = 0.02 + Math.sin(elapsed * (4 + actualSpeed * 0.45)) * 0.025;
      pedalPhase -= actualSpeed * dt * 1.18;
      updatePedaling(pedalPhase);
      const ripArmRig = bike.userData.ripArmRig as RipArmRig;
      const handlebarArms = bike.userData.handlebarArms as THREE.Object3D[];
      let realisticRipSide: -1 | 1 | null = null;
      let realisticRipTarget: THREE.Vector3 | null = null;
      if (ripGesture) {
        ripGesture.timer += dt;
        const reachIn = THREE.MathUtils.smoothstep(ripGesture.timer / 0.18, 0, 1);
        const reachOut = ripGesture.timer < 0.34
          ? 1
          : 1 - THREE.MathUtils.smoothstep((ripGesture.timer - 0.34) / 0.4, 0, 1);
        const reachAmount = Math.min(reachIn, reachOut);
        const side = ripGesture.side;
        const shoulder = new THREE.Vector3(side * 0.22, 1.78, -0.2);
        const restingHand = new THREE.Vector3(side * 0.35, 1.24, -0.68);
        const targetHand = bike.worldToLocal(ripGesture.target.clone());
        const handPoint = restingHand.clone().lerp(targetHand, reachAmount);
        realisticRipSide = side;
        realisticRipTarget = bike.localToWorld(handPoint.clone());
        const elbowPoint = shoulder.clone().lerp(handPoint, 0.52);
        elbowPoint.y += 0.13 - reachAmount * 0.04;
        elbowPoint.z -= 0.08 * (1 - reachAmount);
        alignSegment(ripArmRig.upper, shoulder, elbowPoint);
        alignSegment(ripArmRig.lower, elbowPoint, handPoint);
        ripArmRig.elbow.position.copy(elbowPoint);
        ripArmRig.hand.position.copy(handPoint);
        ripArmRig.hand.rotation.set(0.15, side * -0.5, side * -0.24);
        ripArmRig.fingers.forEach((finger, fingerIndex) => {
          finger.rotation.x = THREE.MathUtils.lerp(Math.PI / 2, 0.38 + fingerIndex * 0.035, reachAmount);
        });
        ripArmRig.group.visible = true;
        handlebarArms.forEach((arm) => {
          arm.visible = arm.userData.armSide !== side && !(phoneOpen && arm.userData.restingPhoneArm);
        });
        if (ripGesture.timer >= 0.76) ripGesture = null;
      } else {
        ripArmRig.group.visible = false;
        handlebarArms.forEach((arm) => {
          arm.visible = !(phoneOpen && arm.userData.restingPhoneArm);
        });
      }
      bike.traverse((o) => {
        if (o.userData.isBikeWheel) o.rotation.x -= actualSpeed * dt * 1.75;
      });
      const phoneRig = bike.userData.phoneRig as THREE.Group;
      const phoneAmount = THREE.MathUtils.lerp(phoneRig.scale.x, phoneOpen ? 1 : 0.001, dt * (phoneOpen ? 7 : 10));
      phoneRig.scale.setScalar(phoneAmount);
      phoneRig.position.y = (1 - phoneAmount) * -0.36;
      phoneRig.rotation.x = (1 - phoneAmount) * 0.55;
      phoneRig.visible = phoneOpen || phoneAmount > 0.02;
      poseRealisticRider(bike, pedalPhase, phoneOpen, realisticRipSide, realisticRipTarget);
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

      for (let i = brokenMirrors.length - 1; i >= 0; i--) {
        const mirror = brokenMirrors[i];
        mirror.life -= dt;
        mirror.velocity.y -= dt * 6.4;
        mirror.object.position.addScaledVector(mirror.velocity, dt);
        mirror.object.rotation.x += mirror.spin.x * dt;
        mirror.object.rotation.y += mirror.spin.y * dt;
        mirror.object.rotation.z += mirror.spin.z * dt;
        if (mirror.life <= 0 || mirror.object.position.y < -0.7) {
          scene.remove(mirror.object);
          brokenMirrors.splice(i, 1);
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
      if (policeCallTimer !== null) window.clearTimeout(policeCallTimer);
      window.speechSynthesis?.cancel();
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
  }, [beep, playBreakSound, playCameraSnap, playChainSound]);

  const begin = () => {
    setStarted(true);
    if (runtimeRef.current) runtimeRef.current.started = true;
    startMusic();
    beep(520, 0.12);
  };

  const toggleMute = () => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    window.localStorage.setItem("lane-justice-muted", String(nextMuted));
    const audio = audioRef.current;
    if (audio) {
      audio.master.gain.setTargetAtTime(nextMuted ? 0 : 0.62, audio.context.currentTime, 0.025);
    }
    if (nextMuted) window.speechSynthesis?.cancel();
    if (!nextMuted) startMusic();
  };

  const answerPoliceCall = () => {
    setPoliceCall("connected");
    if (mutedRef.current || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const message = new SpeechSynthesisUtterance(
      "Hello. This is the police. You're filing too many reports. Please stop. We don't want to do our job.",
    );
    message.rate = 0.92;
    message.pitch = 0.82;
    window.speechSynthesis.speak(message);
  };

  const endPoliceCall = () => {
    window.speechSynthesis?.cancel();
    setPoliceCall(null);
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

  const ripMirrorAction = () => runtimeRef.current?.ripMirror();
  const restartRide = () => runtimeRef.current?.resetRide();
  const switchRiderAction = () => {
    const runtime = runtimeRef.current;
    if (runtime) setRider(runtime.switchRider());
  };

  return (
    <main className="game-shell" aria-label="Lane Justice 3D bicycle game">
      <div ref={mountRef} className="game-canvas" aria-hidden="true" />
      <section className="hud" aria-live="polite">
        <div className="brand">Lane Justice<span>Ride · Document · Continue</span></div>
        <button className="mute-button" type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Turn sound on" : "Mute sound"}>
          {muted ? "Sound off" : "Sound on"}
        </button>
        <button className="rider-button" type="button" onClick={switchRiderAction} aria-label="Switch rider character">
          Switch rider · {rider === "hero" ? "Hero" : "Casual"}
        </button>
        <div className="hud-card stats">
          <div><span className="stat-label">Speed</span><span className="stat-value">{speed}<small>MPH</small></span></div>
          <div><span className="stat-label">Civic score</span><span className="stat-value">{String(streak).padStart(2, "0")}</span></div>
          <div><span className="stat-label">Distance</span><span className="stat-value">{distance}<small>M</small></span></div>
          <div><span className="stat-label">Route</span><span className="stat-value" style={{ color: "var(--mint)" }}>ACTIVE</span></div>
        </div>
        <div className={`hud-card case-feed ${feed ? "" : "hidden"}`}>
          <strong>{feed?.title ?? "Update"}</strong>
          <span>{feed?.text ?? "The lane is clear."}</span>
        </div>
        <aside className={`evidence-report ${report ? "visible" : ""}`} aria-live="polite">
          <div className="evidence-heading">
            <span>Traffic report</span>
            <strong>{report?.status === "submitted" ? "Submitted" : report?.status === "preparing" ? "Ready" : "Reading plate"}</strong>
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
        {started && <div className="prompt"><kbd>{phone ? "SPACE" : prompt.startsWith("F —") ? "F" : "E"}</kbd>{prompt.replace(/^E — |^F — |^SPACE — /, "")}</div>}
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
        <aside className={`police-call ${policeCall ? "visible" : ""}`} aria-live="assertive" aria-hidden={!policeCall}>
          <div className="police-call-status">{policeCall === "connected" ? "Call in progress" : "Incoming call"}</div>
          <div className="police-call-avatar" aria-hidden="true">?</div>
          <h2>Unknown Number</h2>
          <p>
            {policeCall === "connected"
              ? "Police: You’re filing too many reports. Please stop. We don’t want to do our job."
              : "Unknown caller"}
          </p>
          <div className="police-call-actions">
            {policeCall === "ringing" ? (
              <>
                <button className="decline" type="button" onClick={endPoliceCall}>Decline</button>
                <button className="answer" type="button" onClick={answerPoliceCall}>Answer</button>
              </>
            ) : (
              <button className="end" type="button" onClick={endPoliceCall}>End call</button>
            )}
          </div>
        </aside>
        <div className={`flash ${flashing ? "fire" : ""}`} />
      </section>

      <section className={`start-screen ${started ? "dismissed" : ""}`}>
        <div className="start-card">
          <span className="start-kicker">Urban cycling · evidence mode</span>
          <h1>Lane<br />Justice</h1>
          <p>Ride with traffic through a living city. You can leave the bike lane, but moving traffic is dangerous. Document cars blocking the bike lane, or catch vehicles stopped beyond the line in a crosswalk during a red light. Keep the license plate in the focus box so ALPR can complete and submit the report. Ride alongside a blocking vehicle and press F to tear off its mirror. Crosswalk violations are worth triple.</p>
          <button className="start-button" onClick={begin}>Start riding</button>
          <div className="controls-line">WASD / Arrow keys to ride · E for phone · F to rip mirror · C to switch rider · Drag or IJKL to aim · Space to snap</div>
          <a className="character-credits" href="/models/ATTRIBUTION.md" target="_blank" rel="noreferrer">Character model credits</a>
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
          <button className="touch-button mirror" aria-label="Rip off nearby mirror" onClick={ripMirrorAction}>F</button>
          <button className="touch-button phone" aria-label={phone ? "Snap photo" : "Open phone"} onClick={phoneAction}>{phone ? "●" : "▣"}</button>
        </div>
      </div>
      <div className="rotate-note">Best played in landscape</div>
    </main>
  );
}

export default BikeGame;
