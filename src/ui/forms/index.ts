import type { Panel } from '../panel';
import { buildScaleForm } from './scale';
import { buildMirrorForm } from './mirror';
import { buildRotateForm } from './rotate';

export { buildScaleForm, buildMirrorForm, buildRotateForm };

export function registerTransformForms(panel: Panel): void {
  panel.register('scale', 'Scale', buildScaleForm, { needsManifold: true });
  panel.register('mirror', 'Mirror', buildMirrorForm, { needsManifold: true });
  panel.register('rotate', 'Rotate', buildRotateForm, { needsManifold: true });
}
