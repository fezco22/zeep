// Hero background: a calm field of floating "@" glyphs (the product is "get paid by
// handle", so @ is the identity motif). Glyphs are textured planes drifting in 3D with
// a gentle tilt and parallax. Transparent canvas over the light hero, so the page
// background shows through. Static frame under reduced-motion; the caller owns that.
import * as THREE from "three";

export interface HeroScene {
  dispose(): void;
  setTheme(dark: boolean): void;
}

export function initHeroScene(canvas: HTMLCanvasElement): HeroScene | null {
  if (!("WebGLRenderingContext" in window)) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  // Draw a crisp "@" once per tint, reused across every glyph.
  function atTexture(color: string): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = color;
    g.font = '700 190px Georgia, "Times New Roman", serif';
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("@", 128, 142);
    const t = new THREE.Texture(c);
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }
  const texGold = atTexture("#c7a45a");
  const texSlate = atTexture("#6b7180");

  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const small = canvas.clientWidth < 560;
  const COUNT = small ? 9 : 16;
  const spreadX = small ? 7 : 12;

  type At = { mesh: THREE.Mesh; baseY: number; phase: number; spin: number; amp: number; speed: number };
  const ats: At[] = [];
  const group = new THREE.Group();
  for (let i = 0; i < COUNT; i++) {
    const gold = Math.random() < 0.6;
    const mat = new THREE.MeshBasicMaterial({
      map: gold ? texGold : texSlate,
      transparent: true,
      opacity: rand(0.12, gold ? 0.5 : 0.28),
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    const s = rand(0.6, 2.2);
    mesh.scale.set(s, s, s);
    mesh.position.set(rand(-spreadX, spreadX), rand(-6, 6), rand(-6, 3));
    mesh.rotation.z = rand(-0.3, 0.3);
    group.add(mesh);
    ats.push({
      mesh,
      baseY: mesh.position.y,
      phase: rand(0, Math.PI * 2),
      spin: rand(-0.15, 0.15),
      amp: rand(0.2, 0.6),
      speed: rand(0.15, 0.4),
    });
  }
  scene.add(group);

  const pointer = { x: 0, y: 0 };
  const host = canvas.parentElement ?? canvas;
  const onPointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    pointer.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointer.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  host.addEventListener("pointermove", onPointer);

  let raf = 0;
  let visible = true;
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
  });
  io.observe(canvas);

  function resize(): void {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();
  function tick(): void {
    raf = requestAnimationFrame(tick);
    if (!visible || document.hidden) return;
    const t = clock.getElapsedTime();
    for (const a of ats) {
      a.mesh.position.y = a.baseY + Math.sin(t * a.speed + a.phase) * a.amp;
      a.mesh.rotation.z += a.spin * 0.01;
      a.mesh.rotation.y = Math.sin(t * a.speed * 0.7 + a.phase) * 0.35; // gentle 3D tilt
    }
    camera.position.x += (pointer.x * 0.8 - camera.position.x) * 0.03;
    camera.position.y += (-pointer.y * 0.5 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }
  tick();

  return {
    setTheme() {
      /* light theme only */
    },
    dispose() {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", resize);
      host.removeEventListener("pointermove", onPointer);
      scene.traverse((o) => {
        const obj = o as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material };
        obj.geometry?.dispose();
        obj.material?.dispose();
      });
      texGold.dispose();
      texSlate.dispose();
      renderer.dispose();
    },
  };
}
