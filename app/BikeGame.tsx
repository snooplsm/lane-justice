"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Resolution = "BOOM!" | "VANISHED!" | "TICKETED!" | "TOWED!";
type Obstacle = {
  group: THREE.Group;
  z: number;
  active: boolean;
  resolving: boolean;
  resolution?: Resolution;
  timer: number;
  baseScale: number;
  helpers: THREE.Object3D[];
};

const LANE_X = 4.7;
const colors = {
  ink: 0x102941,
  mint: 0x42e0a5,
  coral: 0xff5a5f,
  cream: 0xfff4d2,
  sky: 0x74dff4,
  yellow: 0xffd943,
  road: 0x33495a,
};

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
    new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
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
    new THREE.CylinderGeometry(radius, radius, length, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function makeBike() {
  const bike = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: colors.coral, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: colors.ink, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb96947, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: colors.yellow, roughness: 0.72 });

  for (const z of [-0.72, 0.72]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.065, 10, 24), dark);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(0, 0.52, z);
    wheel.castShadow = true;
    bike.add(wheel);
    const hub = cylinder(0.055, 0.13, colors.cream, 0, 0.52, z);
    hub.rotation.z = Math.PI / 2;
    bike.add(hub);
  }

  const tube = (a: THREE.Vector3, b: THREE.Vector3) => {
    const direction = b.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, direction.length(), 8), frame);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    bike.add(mesh);
  };
  tube(new THREE.Vector3(0, 0.55, -0.7), new THREE.Vector3(0, 0.98, 0));
  tube(new THREE.Vector3(0, 0.55, 0.7), new THREE.Vector3(0, 0.98, 0));
  tube(new THREE.Vector3(0, 0.98, 0), new THREE.Vector3(0, 0.6, 0.58));
  tube(new THREE.Vector3(0, 0.98, 0), new THREE.Vector3(0, 1.17, -0.52));

  const torso = cylinder(0.24, 0.62, colors.yellow, 0, 1.48, 0.03);
  torso.rotation.z = -0.12;
  torso.scale.z = 0.78;
  bike.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), skin);
  head.position.set(0, 1.9, -0.08);
  head.castShadow = true;
  bike.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.225, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  helmet.position.set(0, 1.95, -0.08);
  bike.add(helmet);

  for (const x of [-0.18, 0.18]) {
    const leg = cylinder(0.075, 0.62, 0x294c72, x, 1.03, 0.18);
    leg.rotation.x = 0.48 * (x < 0 ? 1 : -1);
    bike.add(leg);
    const arm = cylinder(0.062, 0.53, 0xb96947, x * 1.35, 1.48, -0.24);
    arm.rotation.x = 0.88;
    arm.rotation.z = x < 0 ? -0.28 : 0.28;
    bike.add(arm);
  }

  bike.position.set(LANE_X, 0, 4.6);
  bike.rotation.y = Math.PI;
  bike.scale.setScalar(1.07);
  bike.traverse((object) => { object.userData.isBike = true; });
  return bike;
}

function makeCar(color = colors.coral) {
  const car = new THREE.Group();
  car.add(box(2.05, 0.62, 3.7, color, 0, 0.7, 0));
  car.add(box(1.66, 0.55, 1.85, color, 0, 1.18, -0.22));
  const glass = new THREE.MeshStandardMaterial({ color: 0x91d9e8, roughness: 0.28, metalness: 0.15 });
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.38, 0.06), glass);
  windshield.position.set(0, 1.2, -1.16);
  windshield.rotation.x = -0.38;
  car.add(windshield);
  for (const x of [-0.91, 0.91]) {
    for (const z of [-1.2, 1.2]) {
      const wheel = cylinder(0.3, 0.18, colors.ink, x, 0.43, z);
      wheel.rotation.z = Math.PI / 2;
      car.add(wheel);
    }
  }
  car.add(box(1.1, 0.13, 0.12, colors.cream, 0, 0.69, -1.91));
  car.add(box(0.52, 0.08, 0.06, colors.yellow, 0, 1.63, -0.1));
  car.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return car;
}

function makeWorld(scene: THREE.Scene) {
  const movers: THREE.Group[] = [];
  const roadMat = new THREE.MeshStandardMaterial({ color: colors.road, roughness: 0.95 });
  const laneMat = new THREE.MeshStandardMaterial({ color: colors.mint, roughness: 0.9 });
  const curbMat = new THREE.MeshStandardMaterial({ color: colors.cream, roughness: 0.9 });
  const blockColors = [0xf6bd60, 0xf28482, 0x84a59d, 0x6fa8dc, 0xf7ede2, 0x8ac7aa];

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
    for (const x of [3.1, 6.3]) segment.add(box(0.13, 0.035, 38, colors.cream, x, 0.035, 0));
    for (let z = -14; z <= 14; z += 9) segment.add(box(0.16, 0.04, 3.7, colors.cream, 0, 0.04, z));
    segment.add(box(2.7, 0.24, 38, 0xb9afa3, -9.8, 0.11, 0));
    segment.add(box(2.7, 0.24, 38, 0xb9afa3, 9.8, 0.11, 0));
    segment.add(box(0.25, 0.4, 38, colors.cream, -8.48, 0.2, 0));
    segment.add(box(0.25, 0.4, 38, colors.cream, 8.48, 0.2, 0));

    for (const side of [-1, 1]) {
      for (let b = 0; b < 3; b++) {
        const width = 4 + ((i + b) % 3);
        const height = 5 + ((i * 7 + b * 5) % 9);
        const z = -13 + b * 13;
        const x = side * (12 + (b % 2) * 1.2);
        const building = box(width, height, 8.8, blockColors[(i + b + (side > 0 ? 2 : 0)) % blockColors.length], x, height / 2, z);
        segment.add(building);
        for (let wy = 1.8; wy < height - 0.6; wy += 2.1) {
          for (const wx of [-1.1, 1.1]) {
            const window = box(0.72, 0.72, 0.08, colors.cream, x + wx, wy, z + (side < 0 ? 4.45 : -4.45));
            segment.add(window);
          }
        }
      }
      for (const tz of [-14, 2, 16]) {
        const trunk = cylinder(0.11, 1.6, 0x79553a, side * 8.9, 0.9, tz);
        segment.add(trunk);
        const crown = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.85, 0),
          new THREE.MeshStandardMaterial({ color: 0x3b9b67, roughness: 0.95 }),
        );
        crown.position.set(side * 8.9, 2.02, tz);
        crown.castShadow = true;
        segment.add(crown);
      }
    }
    scene.add(segment);
    movers.push(segment);
  }

  return movers;
}

function makeObstacle(z: number, index: number): Obstacle {
  const group = makeCar([colors.coral, 0xf3bd36, 0x6c8ee5, 0xdb6fa3][index % 4]);
  group.position.set(LANE_X + (index % 2 ? -0.22 : 0.18), 0, z);
  group.rotation.y = Math.PI;
  return { group, z, active: true, resolving: false, timer: 0, baseScale: 1, helpers: [] };
}

function makeTowTruck() {
  const truck = new THREE.Group();
  truck.add(box(2.25, 0.78, 3.3, colors.yellow, 0, 0.75, 0));
  truck.add(box(2.1, 1.15, 1.35, colors.cream, 0, 1.38, -0.9));
  const boom = box(0.16, 0.16, 3.2, colors.ink, 0, 1.55, 0.7);
  boom.rotation.x = -0.42;
  truck.add(boom);
  for (const x of [-1.04, 1.04]) for (const z of [-1.1, 1.1]) {
    const wheel = cylinder(0.31, 0.2, colors.ink, x, 0.42, z);
    wheel.rotation.z = Math.PI / 2;
    truck.add(wheel);
  }
  return truck;
}

function BikeGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<{
    started: boolean;
    phone: boolean;
    keys: Set<string>;
    snap: () => void;
    togglePhone: () => void;
  } | null>(null);
  const [started, setStarted] = useState(false);
  const [phone, setPhone] = useState(false);
  const [locked, setLocked] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [streak, setStreak] = useState(0);
  const [prompt, setPrompt] = useState("PEDAL UP — THE LANE IS YOURS");
  const [feed, setFeed] = useState<{ title: string; text: string } | null>(null);
  const [flashing, setFlashing] = useState(false);

  const beep = useCallback((frequency = 620, length = 0.08) => {
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioCtx();
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "square";
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
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(colors.sky);
    scene.fog = new THREE.Fog(colors.sky, 45, 145);
    const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.1, 260);
    camera.position.set(LANE_X, 4.3, 10.8);
    camera.lookAt(LANE_X, 1.2, -12);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(colors.cream, 0x405e6b, 2.1));
    const sun = new THREE.DirectionalLight(colors.cream, 3.2);
    sun.position.set(-18, 30, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -10;
    scene.add(sun);

    const world = makeWorld(scene);
    const bike = makeBike();
    scene.add(bike);
    const obstacles: Obstacle[] = [0, 1, 2, 3, 4].map((_, i) => makeObstacle(-46 - i * 63, i));
    obstacles.forEach((o) => scene.add(o.group));
    const keys = new Set<string>();
    let desiredSpeed = 8.2;
    let actualSpeed = 0;
    let meters = 0;
    let scoreStreak = 0;
    let lastUi = 0;
    let bikeX = LANE_X;
    let nearest: Obstacle | null = null;
    let phoneOpen = false;
    let running = false;
    let flashTimer = 0;
    const clock = new THREE.Clock();
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];

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

    const resolveObstacle = (obstacle: Obstacle) => {
      const options: Resolution[] = ["BOOM!", "VANISHED!", "TICKETED!", "TOWED!"];
      const resolution = options[Math.floor(Math.random() * options.length)];
      obstacle.resolution = resolution;
      obstacle.resolving = true;
      obstacle.active = false;
      obstacle.timer = 0;
      scoreStreak += 1;
      setStreak(scoreStreak);
      setFeed({
        title: resolution,
        text: resolution === "BOOM!" ? "CARTOON DEBRIS. ZERO PAPERWORK."
          : resolution === "VANISHED!" ? "OBSTRUCTION REMOVED FROM REALITY."
          : resolution === "TICKETED!" ? "CITATION ISSUED. LANE LIBERATED."
          : "EXPRESS TOW DISPATCHED. KEEP ROLLING.",
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

    const snap = () => {
      if (!running) return;
      if (!phoneOpen) {
        phoneOpen = true;
        setPhone(true);
        beep(410, 0.07);
        return;
      }
      setFlashing(true);
      window.setTimeout(() => setFlashing(false), 430);
      beep(980, 0.1);
      const target = nearest as Obstacle | null;
      if (target && target.active && target.z > -28 && target.z < 1 && Math.abs(target.group.position.x - bikeX) < 2.9) {
        resolveObstacle(target);
        phoneOpen = false;
        setPhone(false);
        setPrompt("CASE CLOSED — PEDAL ON!");
      } else {
        setFeed({ title: "NO CASE", text: "GET THE BLOCKER INSIDE THE RETICLE." });
        setTimeout(() => setFeed(null), 1300);
      }
    };

    const togglePhone = () => {
      if (!running) return;
      phoneOpen = !phoneOpen;
      setPhone(phoneOpen);
      beep(phoneOpen ? 440 : 280, 0.06);
    };

    runtimeRef.current = { started: running, phone: phoneOpen, keys, snap, togglePhone };

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
    };
    window.addEventListener("resize", resize);

    const animate = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      running = runtimeRef.current?.started ?? false;
      if (runtimeRef.current) {
        runtimeRef.current.phone = phoneOpen;
        runtimeRef.current.snap = snap;
        runtimeRef.current.togglePhone = togglePhone;
      }

      if (running) {
        if (keys.has("arrowup") || keys.has("w")) desiredSpeed = Math.min(11.6, desiredSpeed + dt * 3.5);
        if (keys.has("arrowdown") || keys.has("s")) desiredSpeed = Math.max(3.8, desiredSpeed - dt * 4.5);
        const steer = (keys.has("arrowleft") || keys.has("a") ? -1 : 0) + (keys.has("arrowright") || keys.has("d") ? 1 : 0);
        bikeX = THREE.MathUtils.clamp(bikeX + steer * dt * 4.4, 3.42, 5.98);
        bike.position.x = THREE.MathUtils.lerp(bike.position.x, bikeX, dt * 8);
        bike.rotation.z = THREE.MathUtils.lerp(bike.rotation.z, -steer * 0.13, dt * 7);

        nearest = null;
        let nearestDistance = Infinity;
        for (const obstacle of obstacles) {
          if (obstacle.active && obstacle.z > -38 && obstacle.z < nearestDistance) {
            nearest = obstacle;
            nearestDistance = obstacle.z;
          }
        }
        const blocked = nearest && nearest.z > -7.3 && nearest.z < 2 && Math.abs(nearest.group.position.x - bikeX) < 1.65;
        const targetSpeed = blocked ? 0 : desiredSpeed;
        actualSpeed = THREE.MathUtils.lerp(actualSpeed, targetSpeed, dt * (blocked ? 8 : 1.9));
        const dz = actualSpeed * dt;
        meters += dz;

        for (const segment of world) {
          segment.position.z += dz;
          if (segment.position.z > 38) segment.position.z -= world.length * 38;
        }
        for (const obstacle of obstacles) {
          obstacle.z += dz;
          obstacle.group.position.z = obstacle.z;
          if (obstacle.active && obstacle.z > 10) {
            scoreStreak = 0;
            setStreak(0);
            obstacle.z -= obstacles.length * 63;
            obstacle.group.position.set(LANE_X + (Math.random() - 0.5) * 0.48, 0, obstacle.z);
          }
          if (!obstacle.active && !obstacle.resolving && obstacle.z > 15) {
            obstacle.z -= obstacles.length * 63;
            obstacle.group.position.set(LANE_X + (Math.random() - 0.5) * 0.48, 0, obstacle.z);
            obstacle.group.rotation.set(0, Math.PI, 0);
            obstacle.group.scale.setScalar(1);
            obstacle.group.visible = true;
            obstacle.active = true;
            obstacle.resolution = undefined;
          }
        }

        if (nearest && nearest.active && nearest.z > -29 && nearest.z < 2) {
          const isLocked = phoneOpen && Math.abs(nearest.group.position.x - bikeX) < 2.9;
          setLocked(isLocked);
          setPrompt(phoneOpen ? (isLocked ? "SPACE — SNAP THE EVIDENCE!" : "CENTER THE BLOCKER") : "E — PULL OUT YOUR PHONE");
        } else {
          setLocked(false);
          setPrompt(phoneOpen ? "NO BLOCKER IN RANGE — E TO POCKET" : "PEDAL UP — THE LANE IS YOURS");
        }
      }

      bike.position.y = 0.02 + Math.sin(elapsed * (4 + actualSpeed * 0.45)) * 0.025;
      bike.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry.type === "TorusGeometry") o.rotation.x -= actualSpeed * dt * 1.75;
      });
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, bike.position.x, dt * 2.2);
      camera.position.y = 4.28 + Math.sin(elapsed * 2.2) * 0.025;
      camera.lookAt(bike.position.x, 1.18, -13);

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
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    let animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("resize", resize);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
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

  const phoneAction = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (phone) runtime.snap();
    else runtime.togglePhone();
  };

  return (
    <main className="game-shell" aria-label="Lane Justice 3D bicycle game">
      <div ref={mountRef} className="game-canvas" aria-hidden="true" />
      <section className="hud" aria-live="polite">
        <div className="brand">Lane Justice<span>Snap · Clear · Ride</span></div>
        <div className="hud-card stats">
          <div><span className="stat-label">Speed</span><span className="stat-value">{speed}<small>MPH</small></span></div>
          <div><span className="stat-label">Report streak</span><span className="stat-value">{String(streak).padStart(2, "0")}</span></div>
          <div><span className="stat-label">Distance</span><span className="stat-value">{distance}<small>M</small></span></div>
          <div><span className="stat-label">Status</span><span className="stat-value" style={{ color: "var(--mint)" }}>ROLL</span></div>
        </div>
        <div className={`hud-card case-feed ${feed ? "" : "hidden"}`}>
          <strong>{feed?.title ?? "CASE CLOSED"}</strong>
          <span>{feed?.text ?? "THE LANE IS CLEAR."}</span>
        </div>
        {started && <div className="prompt"><kbd>{phone ? "SPACE" : "E"}</kbd>{prompt.replace(/^E — |^SPACE — /, "")}</div>}
        <div className={`phone-view ${phone ? "active" : ""} ${locked ? "locked" : ""}`} aria-hidden={!phone}>
          <div className="phone-speaker" />
          <div className="phone-status">{locked ? "BLOCKER LOCKED" : "SEARCHING FOR OBSTRUCTION"}</div>
          <div className="focus-frame" />
          <div className="shutter" />
        </div>
        <div className={`flash ${flashing ? "fire" : ""}`} />
      </section>

      <section className={`start-screen ${started ? "dismissed" : ""}`}>
        <div className="start-card">
          <span className="start-kicker">A tiny game about a huge pet peeve</span>
          <h1>Lane<br />Justice</h1>
          <p>Ride the green. When a car blocks your lane, pull out your phone, frame the evidence, and let cartoon civic justice handle the rest.</p>
          <button className="start-button" onClick={begin}>Start riding</button>
          <div className="controls-line">WASD / Arrow keys to ride · E for phone · Space to snap</div>
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
