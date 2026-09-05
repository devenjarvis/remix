import './styles.css';
import { Engine } from './core/engine';
import { History } from './core/history';
import { validateRecipe } from './core/ops/validate';
import { getFont } from './core/font';
import { getManifold } from './core/manifold';
import { exportModel, type ExportFormat } from './io/save';
import { AppState } from './ui/app';
import { baseName, download } from './ui/download';
import { pickFile, readModelFile, wireFileOpen } from './ui/files';
import { buildLayFlatForm } from './ui/forms/layflat';
import { registerBooleanForm, registerCutSplitForms, registerTextForm, registerTransformForms } from './ui/forms';
import { HistoryPanel } from './ui/history';
import { Panel } from './ui/panel';
import { StatusBar } from './ui/status';
import { Viewport } from './ui/viewport';

const $ = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id}`);
  return e as T;
};

async function boot(): Promise<void> {
  const app = new AppState(new History(), new Engine());
  const viewport = new Viewport($('viewport'));
  app.viewport = viewport;

  const status = new StatusBar(app, $('status-size'), $('status-tris'), $('status-manifold'), $('status-msg'));
  new HistoryPanel(app, $('history-list'), $<HTMLButtonElement>('btn-undo'), $<HTMLButtonElement>('btn-redo'));

  const panel = new Panel(app, $('op-buttons'), $('op-form'));
  registerTransformForms(panel);
  panel.register('layflat', 'Lay Flat', buildLayFlatForm, { needsManifold: true });
  registerCutSplitForms(panel);
  registerBooleanForm(panel);
  registerTextForm(panel);

  const dropHint = $('drop-hint');

  async function openFile(file: File): Promise<void> {
    status.setMessage(`Loading ${file.name}…`);
    try {
      const loaded = await readModelFile(file);
      panel.close();
      app.setSource(loaded.mesh, file.name, loaded.palette);
      await app.refresh();
      viewport.fitCamera();
      dropHint.classList.add('hidden');
      const warnings = loaded.warnings.join('; ');
      if (warnings) {
        status.setMessage(warnings, 'warn');
      } else if (!app.canEditGeometry) {
        status.setMessage('Source mesh is not manifold: booleans, cut, split, and text are disabled', 'warn');
      } else if (app.repair) {
        const r = app.repair;
        status.setMessage(`Repaired mesh: removed ${r.removedTriangles} bad triangle(s), filled ${r.filledHoles} small hole(s)`, 'ok');
      } else {
        status.setMessage('');
      }
    } catch (e) {
      status.setMessage(`Could not load ${file.name}: ${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  }

  wireFileOpen($('btn-open'), $<HTMLInputElement>('file-input'), $('viewport'), (f) => void openFile(f));

  const exportMenu = $('btn-export').parentElement!;
  $('btn-export').addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('open');
  });
  document.addEventListener('click', () => exportMenu.classList.remove('open'));
  $('export-menu').querySelectorAll<HTMLButtonElement>('button[data-format]').forEach((b) => {
    b.addEventListener('click', () => {
      exportMenu.classList.remove('open');
      const parts = app.parts;
      if (!parts.length) return status.setMessage('Nothing to export', 'warn');
      const format = b.dataset.format as ExportFormat;
      const name = `${baseName(app.sourceName)}-remix`;
      const { bytes, droppedColors } = exportModel(parts, format, name, app.palette);
      download(bytes, `${name}.${format}`);
      if (droppedColors) status.setMessage(`Exported ${name}.${format} (colors dropped; use 3MF to keep them)`, 'warn');
      else status.setMessage(`Exported ${name}.${format}`, 'ok');
    });
  });

  $('btn-save-recipe').addEventListener('click', () => {
    const recipe = app.history.toJSON(app.palette);
    if (!recipe.ops.length) return status.setMessage('History is empty; nothing to save', 'warn');
    download(JSON.stringify(recipe, null, 2), `${baseName(app.sourceName)}-recipe.json`, 'application/json');
    status.setMessage('Recipe saved', 'ok');
  });

  $('btn-apply-recipe').addEventListener('click', async () => {
    if (!app.source) return status.setMessage('Load a model before applying a recipe', 'warn');
    const file = await pickFile($<HTMLInputElement>('recipe-input'));
    if (!file) return;
    try {
      const recipe = validateRecipe(JSON.parse(await file.text()));
      if (recipe.ops.some((op) => op.type === 'text') && !app.engine.font) {
        app.engine.font = await getFont();
      }
      if (recipe.palette) app.setPalette(recipe.palette);
      app.history.pushAll(recipe.ops);
      const withPalette = recipe.palette ? ` and its ${recipe.palette.length}-slot palette` : '';
      status.setMessage(`Applied ${recipe.ops.length} steps${withPalette} from ${file.name}`, 'ok');
    } catch (e) {
      status.setMessage(`Could not apply recipe: ${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  });

  app.onChange(() => {
    if (app.result?.error) status.setMessage(app.result.error, 'err');
  });

  await getManifold();
  status.setMessage('Ready');
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('status-msg')!.textContent = `Failed to start: ${e instanceof Error ? e.message : String(e)}`;
});
