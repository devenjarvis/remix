import type { Panel } from '../panel';
import { buildScaleForm } from './scale';
import { buildMirrorForm } from './mirror';
import { buildRotateForm } from './rotate';
import { buildCutForm } from './cut';
import { buildSplitForm } from './split';

export { buildScaleForm, buildMirrorForm, buildRotateForm, buildCutForm, buildSplitForm };

export function registerTransformForms(panel: Panel): void {
  panel.register('scale', 'Scale', buildScaleForm, { needsManifold: true });
  panel.register('mirror', 'Mirror', buildMirrorForm, { needsManifold: true });
  panel.register('rotate', 'Rotate', buildRotateForm, { needsManifold: true });
}

export function registerCutSplitForms(panel: Panel): void {
  panel.register('cut', 'Cut', buildCutForm, { needsManifold: true });
  panel.register('split', 'Split', buildSplitForm, { needsManifold: true });
}
