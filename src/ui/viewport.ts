import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { Axis } from '../core/ops/types';
import type { Bounds, TriMesh } from '../core/types';
import type { FaceHit, ViewportLike } from './app';
import { pickFace } from './pick';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const BG = 0x1b1d22;
const PALETTE = [0xb8c4d6, 0xe6a86b, 0x8fcf8a, 0xd98ad6, 0x7fc8d8, 0xe0d072];
const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

export class Viewport implements ViewportLike {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly domElement: HTMLCanvasElement;

  private readonly partGroup = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private plane: THREE.Mesh | null = null;
  private pickMode = false;
  private pickListeners = new Set<(hit: FaceHit) => void>();
  private pointerDown: { x: number; y: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private renderQueued = false;
  private fitted = false;
  private resizeObserver: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.domElement = this.renderer.domElement;
    container.appendChild(this.domElement);

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
    this.domElement.addEventListener('pointerup', this.onPointerUp);
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

  setParts(parts: TriMesh[], fit = false): void {
    for (const m of this.meshes) {
      this.partGroup.remove(m);
      m.geometry.disposeBoundsTree?.();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.meshes = parts.map((p, i) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(p.indices, 1));
      geo.computeVertexNormals();
      geo.computeBoundsTree();
      const mat = new THREE.MeshStandardMaterial({
        color: PALETTE[i % PALETTE.length],
        flatShading: true,
        roughness: 0.6,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      this.partGroup.add(mesh);
      return mesh;
    });
    if (parts.length === 0) this.fitted = false;
    else if (fit || !this.fitted) this.fitCamera();
    this.requestRender();
  }

  fitCamera(): void {
    if (!this.meshes.length) return;
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

  setPickMode(on: boolean): void {
    this.pickMode = on;
    this.container.style.cursor = on ? 'crosshair' : '';
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  };

  private onPointerUp = (e: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || !this.pickMode || !this.meshes.length) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 4) return;
    const rect = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = pickFace(this.raycaster, this.meshes);
    if (hit) for (const cb of this.pickListeners) cb(hit);
  };

  dispose(): void {
    this.resizeObserver.disconnect();
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.setParts([]);
    this.hidePlane();
    this.controls.dispose();
    this.renderer.dispose();
    this.domElement.remove();
  }
}
