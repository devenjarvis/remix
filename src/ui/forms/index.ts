import type { Panel } from '../panel';
import { buildScaleForm } from './scale';
import { buildMirrorForm } from './mirror';
import { buildRotateForm } from './rotate';
import { buildCutForm } from './cut';
import { buildSplitForm } from './split';
import { buildTextForm } from './text';
import { buildBooleanForm } from './boolean';
import { buildPaintForm, registerPaintForm } from './paint';
import { buildRefineForm } from './refine';

export { buildScaleForm, buildMirrorForm, buildRotateForm, buildCutForm, buildSplitForm, buildPaintForm, registerPaintForm };

export function registerTransformForms(panel: Panel): void {
  panel.register('scale', 'Scale', buildScaleForm, { needsManifold: true });
  panel.register('mirror', 'Mirror', buildMirrorForm, { needsManifold: true });
  panel.register('rotate', 'Rotate', buildRotateForm, { needsManifold: true });
}

export function registerCutSplitForms(panel: Panel): void {
  panel.register('cut', 'Cut', buildCutForm, { needsManifold: true });
  panel.register('split', 'Split', buildSplitForm, { needsManifold: true });
}

export function registerTextForm(panel: Panel): void {
  panel.register('text', 'Text', buildTextForm, { needsManifold: true });
}

export function registerRefineForm(panel: Panel): void {
  panel.register('refine', 'Refine', buildRefineForm, { needsManifold: true });
}

export function registerBooleanForm(panel: Panel): void {
  panel.register('boolean', 'Boolean', buildBooleanForm, { needsManifold: true });
}
