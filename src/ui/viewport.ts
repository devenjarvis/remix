import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { Axis } from '../core/ops/types';
import type { Bounds, TriMesh, Vec3 } from '../core/types';
import type { FaceHit, ViewportLike } from './app';
import { pickFace } from './pick';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const BG = 0x1b1d22;
const PALETTE = [0xb8c4d6, 0xe6a86b, 0x8fcf8a, 0xd98ad6, 0x7fc8d8, 0xe0d072];
const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
const HIGHLIGHT = 0.5;
const HIGHLIGHT_TINT = new THREE.Color(0x5aa9ff);
const SKETCH_SPACING_PX = 3;
const SKETCH_DEPTH = 0.5;
const SVG_NS = 'http://www.w3.org/2000/svg';

type DragPhase = 'start' | 'move' | 'end';
type SketchListener = (points: [number, number][], phase: DragPhase) => void;

type Part = {
  mesh: THREE.Mesh;
  positions: Float32Array;
  indices: Uint32Array;
  slots: Uint8Array | null;
  override: Uint8Array | null;
  highlight: Uint32Array | null;
  color: THREE.BufferAttribute;
};

export class Viewport implements ViewportLike {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly domElement: HTMLCanvasElement;

  private readonly partGroup = new THREE.Group();
  private parts: Part[] = [];
  private palette: THREE.Color[] = [];
  private plane: THREE.Mesh | null = null;
  private pickMode = false;
  private pickListeners = new Set<(hit: FaceHit) => void>();
  private hoverListeners = new Set<(hit: FaceHit | null) => void>();
  private dragListeners = new Set<(hit: FaceHit, phase: DragPhase) => void>();
  private sketchListeners = new Set<SketchListener>();
  private pointerDown: { x: number; y: number } | null = null;
  private drag: { last: FaceHit } | null = null;
  private sketch: { ndc: [number, number][]; px: [number, number][] } | null = null;
  private readonly overlay: SVGSVGElement;
  private readonly outline: SVGPolylineElement;
  private hoverQueued = false;
  private hoverEvent: PointerEvent | null = null;
  private hovering = false;
  private raycaster = new THREE.Raycaster();
  private renderQueued = false;
  private fitted = false;
  private resizeObserver: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.domElement = this.renderer.domElement;
    container.appendChild(this.domElement);
    this.overlay = document.createElementNS(SVG_NS, 'svg');
    this.overlay.classList.add('sketch');
    this.outline = document.createElementNS(SVG_NS, 'polyline');
    this.overlay.append(this.outline);
    this.overlay.style.display = 'none';
    container.appendChild(this.overlay);

    this.scene.background = new THREE.Color(BG);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    this.camera.position.set(150, -150, 120);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.addEventListener('change', () => this.requestRender());

    const minor = new THREE.GridHelper(200, 20, 0x3a3e47, 0x2a2d34);
    const major = new THREE.GridHelper(200, 4, 0x4a4f5a, 0x4a4f5a);
    for (const g of [minor, major]) {
      g.rotation.x = Math.PI / 2;
      (g.material as THREE.Material).transparent = true;
      this.scene.add(g);
    }
    major.position.z = 0.01;
    this.scene.add(new THREE.AxesHelper(20));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(100, -80, 200);
    this.scene.add(dir);
    this.scene.add(this.partGroup);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.domElement.addEventListener('pointermove', this.onPointerMove);
    this.domElement.addEventListener('pointerup', this.onPointerUp);
    this.domElement.addEventListener('pointerleave', this.onPointerLeave);
  }

  requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderer.render(this.scene, this.camera);
    });
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private get meshes(): THREE.Mesh[] {
    return this.parts.map((p) => p.mesh);
  }

  setParts(parts: TriMesh[], fit = false): void {
    const previous = this.parts;
    const reused = new Set<Part>();
    this.parts = parts.map((p, i) => {
      const prev = previous[i];
      if (prev && prev.positions === p.positions && prev.indices === p.indices) {
        reused.add(prev);
        prev.slots = p.colors ?? null;
        prev.override = null;
        prev.highlight = null;
        this.fill(prev, i);
        return prev;
      }
      return this.buildPart(p, i);
    });
    for (const p of previous) {
      if (reused.has(p)) continue;
      this.partGroup.remove(p.mesh);
      p.mesh.geometry.disposeBoundsTree?.();
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    if (parts.length === 0) this.fitted = false;
    else if (fit || !this.fitted) this.fitCamera();
    this.requestRender();
  }

  private buildPart(p: TriMesh, index: number): Part {
    const n = p.indices.length;
    const positions = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const v = p.indices[k] * 3;
      positions[k * 3] = p.positions[v];
      positions[k * 3 + 1] = p.positions[v + 1];
      positions[k * 3 + 2] = p.positions[v + 2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const color = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('color', color);
    geo.computeVertexNormals();
    geo.computeBoundsTree({ indirect: true });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    this.partGroup.add(mesh);
    const part: Part = { mesh, positions: p.positions, indices: p.indices, slots: p.colors ?? null, override: null, highlight: null, color };
    this.fill(part, index);
    return part;
  }

  private fill(part: Part, index: number): void {
    const base = new THREE.Color(PALETTE[index % PALETTE.length]);
    const slots = part.override ?? part.slots;
    const arr = part.color.array as Float32Array;
    const n = arr.length / 9;
    for (let t = 0; t < n; t++) {
      const slot = slots ? slots[t] : 0;
      const c = slot > 0 && slot < this.palette.length ? this.palette[slot] : base;
      for (let k = 0; k < 3; k++) {
        arr[t * 9 + k * 3] = c.r;
        arr[t * 9 + k * 3 + 1] = c.g;
        arr[t * 9 + k * 3 + 2] = c.b;
      }
    }
    if (part.highlight) {
      for (const t of part.highlight) {
        if (t >= n) continue;
        for (let k = 0; k < 9; k += 3) {
          arr[t * 9 + k] += (HIGHLIGHT_TINT.r - arr[t * 9 + k]) * HIGHLIGHT;
          arr[t * 9 + k + 1] += (HIGHLIGHT_TINT.g - arr[t * 9 + k + 1]) * HIGHLIGHT;
          arr[t * 9 + k + 2] += (HIGHLIGHT_TINT.b - arr[t * 9 + k + 2]) * HIGHLIGHT;
        }
      }
    }
    part.color.needsUpdate = true;
  }

  setPalette(hexes: string[]): void {
    const next = hexes.map((h) => new THREE.Color(h));
    const same = next.length === this.palette.length && next.every((c, i) => c.equals(this.palette[i]));
    this.palette = next;
    if (same) return;
    this.parts.forEach((p, i) => this.fill(p, i));
    this.requestRender();
  }

  setTriangleColors(part: number, colors: Uint8Array | null): void {
    const p = this.parts[part];
    if (!p) return;
    p.override = colors;
    this.fill(p, part);
    this.requestRender();
  }

  highlightTriangles(part: number, tris: Uint32Array | null): void {
    const p = this.parts[part];
    if (!p) return;
    p.highlight = tris;
    this.fill(p, part);
    this.requestRender();
  }

  fitCamera(): void {
    if (!this.parts.length) return;
    const box = new THREE.Box3();
    for (const m of this.meshes) box.expandByObject(m);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.15;
    const dir = new THREE.Vector3(1, -1, 0.8).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.1, dist / 100);
    this.camera.far = dist * 20 + sphere.radius * 4;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.update();
    this.fitted = true;
    this.requestRender();
  }

  showPlane(axis: Axis, offset: number, extent: Bounds): void {
    this.hidePlane();
    const i = AXIS_INDEX[axis];
    const others = [0, 1, 2].filter((k) => k !== i) as (0 | 1 | 2)[];
    const w = extent.size[others[0]] * 1.2 + 10;
    const h = extent.size[others[1]] * 1.2 + 10;
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x5aa9ff,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(geo, mat);
    const center = [0, 1, 2].map((k) => (extent.min[k] + extent.max[k]) / 2);
    center[i] = offset;
    plane.position.set(center[0], center[1], center[2]);
    if (axis === 'x') plane.rotation.y = Math.PI / 2;
    else if (axis === 'y') plane.rotation.x = Math.PI / 2;
    this.plane = plane;
    this.scene.add(plane);
    this.requestRender();
  }

  hidePlane(): void {
    if (!this.plane) return;
    this.scene.remove(this.plane);
    this.plane.geometry.dispose();
    (this.plane.material as THREE.Material).dispose();
    this.plane = null;
    this.requestRender();
  }

  onFacePick(cb: (hit: FaceHit) => void): () => void {
    this.pickListeners.add(cb);
    return () => this.pickListeners.delete(cb);
  }

  onHover(cb: (hit: FaceHit | null) => void): () => void {
    this.hoverListeners.add(cb);
    return () => this.hoverListeners.delete(cb);
  }

  onDrag(cb: (hit: FaceHit, phase: DragPhase) => void): () => void {
    this.dragListeners.add(cb);
    return () => this.dragListeners.delete(cb);
  }

  onSketch(cb: SketchListener): () => void {
    this.sketchListeners.add(cb);
    return () => this.sketchListeners.delete(cb);
  }

  sketchToWorld(points: [number, number][]): { eye: Vec3; polygon: Vec3[] } {
    const eye: Vec3 = [this.camera.position.x, this.camera.position.y, this.camera.position.z];
    const v = new THREE.Vector3();
    const polygon = points.map(([x, y]): Vec3 => {
      v.set(x, y, SKETCH_DEPTH).unproject(this.camera);
      return [v.x, v.y, v.z];
    });
    return { eye, polygon };
  }

  private ndcOf(e: PointerEvent): { ndc: [number, number]; px: [number, number] } {
    const rect = this.domElement.getBoundingClientRect();
    const px: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
    return { px, ndc: [(px[0] / rect.width) * 2 - 1, -(px[1] / rect.height) * 2 + 1] };
  }

  private drawSketch(): void {
    if (!this.sketch) return;
    const rect = this.domElement.getBoundingClientRect();
    this.overlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    this.outline.setAttribute('points', this.sketch.px.map(([x, y]) => `${x},${y}`).join(' '));
  }

  private addSketchPoint(e: PointerEvent): boolean {
    if (!this.sketch) return false;
    const { ndc, px } = this.ndcOf(e);
    const last = this.sketch.px[this.sketch.px.length - 1];
    if (last && Math.hypot(px[0] - last[0], px[1] - last[1]) < SKETCH_SPACING_PX) return false;
    this.sketch.ndc.push(ndc);
    this.sketch.px.push(px);
    this.drawSketch();
    return true;
  }

  setPickMode(on: boolean): void {
    this.pickMode = on;
    this.container.style.cursor = on ? 'crosshair' : '';
    if (!on) this.emitHover(null);
  }

  private hitAt(e: PointerEvent): FaceHit | null {
    if (!this.parts.length) return null;
    const rect = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return pickFace(this.raycaster, this.meshes);
  }

  private emitHover(hit: FaceHit | null): void {
    if (!hit && !this.hovering) return;
    this.hovering = hit !== null;
    for (const cb of this.hoverListeners) cb(hit);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    if (e.button !== 0 || !this.pickMode) return;
    if (this.dragListeners.size) {
      const hit = this.hitAt(e);
      if (!hit) return;
      this.drag = { last: hit };
      this.controls.enabled = false;
      this.domElement.setPointerCapture(e.pointerId);
      for (const cb of this.dragListeners) cb(hit, 'start');
      return;
    }
    if (!this.sketchListeners.size) return;
    this.sketch = { ndc: [], px: [] };
    this.addSketchPoint(e);
    this.overlay.style.display = '';
    this.controls.enabled = false;
    this.domElement.setPointerCapture(e.pointerId);
    this.emitHover(null);
    for (const cb of this.sketchListeners) cb(this.sketch.ndc, 'start');
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pickMode) return;
    if (this.sketch) {
      if (this.addSketchPoint(e)) for (const cb of this.sketchListeners) cb(this.sketch.ndc, 'move');
      return;
    }
    if (this.drag) {
      const hit = this.hitAt(e);
      if (!hit) return;
      this.drag.last = hit;
      for (const cb of this.dragListeners) cb(hit, 'move');
      return;
    }
    if (!this.hoverListeners.size) return;
    this.hoverEvent = e;
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      if (this.hoverEvent && this.pickMode) this.emitHover(this.hitAt(this.hoverEvent));
    });
  };

  private onPointerLeave = (): void => {
    this.hoverEvent = null;
    this.emitHover(null);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (this.sketch) {
      this.addSketchPoint(e);
      const { ndc } = this.sketch;
      this.sketch = null;
      this.overlay.style.display = 'none';
      this.outline.removeAttribute('points');
      this.controls.enabled = true;
      if (this.domElement.hasPointerCapture(e.pointerId)) this.domElement.releasePointerCapture(e.pointerId);
      for (const cb of this.sketchListeners) cb(ndc, 'end');
      return;
    }
    if (this.drag) {
      const { last } = this.drag;
      this.drag = null;
      this.controls.enabled = true;
      if (this.domElement.hasPointerCapture(e.pointerId)) this.domElement.releasePointerCapture(e.pointerId);
      for (const cb of this.dragListeners) cb(this.hitAt(e) ?? last, 'end');
      return;
    }
    if (!down || !this.pickMode || !this.parts.length) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 4) return;
    const hit = this.hitAt(e);
    if (hit) for (const cb of this.pickListeners) cb(hit);
  };

  dispose(): void {
    this.resizeObserver.disconnect();
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.setParts([]);
    this.hidePlane();
    this.controls.dispose();
    this.renderer.dispose();
    this.domElement.remove();
    this.overlay.remove();
  }
}
