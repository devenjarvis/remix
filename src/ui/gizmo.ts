import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ToolBody } from '../core/ops/types';
import type { Vec3 } from '../core/types';
import type { Viewport } from './viewport';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export class ToolGizmo {
  readonly mesh: THREE.Mesh;
  private readonly controls: TransformControls;
  private readonly helper: THREE.Object3D;
  private readonly onDrag = (e: { value: boolean }) => {
    this.viewport.controls.enabled = !e.value;
  };
  private readonly onChange = () => this.viewport.requestRender();

  constructor(private readonly viewport: Viewport) {
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xf29a3c, opacity: 0.5, transparent: true, depthWrite: false }),
    );
    this.controls = new TransformControls(viewport.camera, viewport.domElement);
    this.controls.attach(this.mesh);
    this.controls.addEventListener('dragging-changed', this.onDrag as never);
    this.controls.addEventListener('change', this.onChange);
    this.helper = this.controls.getHelper();
    viewport.scene.add(this.mesh, this.helper);
    viewport.requestRender();
  }

  setTool(tool: ToolBody): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildGeometry(tool);
    this.viewport.requestRender();
  }

  setMode(mode: GizmoMode): void {
    this.controls.setMode(mode);
    this.viewport.requestRender();
  }

  getMatrix(): number[] {
    this.mesh.updateMatrixWorld(true);
    return Array.from(this.mesh.matrixWorld.elements);
  }

  setMatrix(m: number[]): void {
    const mat = new THREE.Matrix4().fromArray(m);
    mat.decompose(this.mesh.position, this.mesh.quaternion, this.mesh.scale);
    this.mesh.updateMatrixWorld(true);
    this.viewport.requestRender();
  }

  placeAt(center: Vec3): void {
    this.mesh.position.set(center[0], center[1], center[2]);
    this.mesh.updateMatrixWorld(true);
    this.viewport.requestRender();
  }

  dispose(): void {
    this.controls.removeEventListener('dragging-changed', this.onDrag as never);
    this.controls.removeEventListener('change', this.onChange);
    this.controls.detach();
    this.viewport.scene.remove(this.mesh, this.helper);
    this.controls.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.viewport.controls.enabled = true;
    this.viewport.requestRender();
  }
}

function buildGeometry(tool: ToolBody): THREE.BufferGeometry {
  switch (tool.kind) {
    case 'box':
      return new THREE.BoxGeometry(...tool.size);
    case 'cylinder': {
      const [dx, dy, dz] = tool.size;
      const g = new THREE.CylinderGeometry(dx / 2, dx / 2, dz, 64);
      g.rotateX(Math.PI / 2);
      g.scale(1, dy / dx, 1);
      return g;
    }
    case 'sphere': {
      const [dx, dy, dz] = tool.size;
      const g = new THREE.SphereGeometry(dx / 2, 48, 32);
      g.scale(1, dy / dx, dz / dx);
      return g;
    }
    case 'mesh': {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(tool.positions), 3));
      g.setIndex(new THREE.BufferAttribute(Uint32Array.from(tool.indices), 1));
      g.computeVertexNormals();
      return g;
    }
  }
}
