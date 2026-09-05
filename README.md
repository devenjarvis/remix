# Remix

A browser-based tool for remixing 3D-print models. Load an STL, OBJ, or 3MF file, then scale, mirror, rotate, lay flat, cut, split, boolean, add text, and paint faces with up to 16 filament colors. Every operation is recorded in an undoable history that can be saved as a recipe and replayed on another model.

## Develop

```
npm install
npm run dev
```

## Verify

```
npm run typecheck
npm test
npm run build
```

## Stack

- Vite + TypeScript
- three.js for rendering and file parsing
- manifold-3d for all geometry operations
- opentype.js for text outlines
- fflate for the 3MF writer

## Notes

- All geometry runs on the main thread through manifold-3d WASM. On a 320k-triangle model, loading, manifold conversion, a boolean, and a plane cut each take under one second. A Web Worker can be added later if larger models make the UI stall.
- Loading a file with several touching shells (for example a 3MF exported after a cut) shows the file's own triangle count until an operation is applied; manifold-3d then merges coincident faces.
- Recipes are JSON files holding the active history. Imported mesh tools for booleans are stored inline, so a recipe is self-contained.
- On load, the model is centered on X and Y and dropped so its lowest point sits on the bed.
- If a loaded mesh is not manifold, the app removes degenerate, duplicate, and flipped triangles and fan-fills boundary loops of up to 32 edges. The status bar reports what was repaired. Larger defects are left alone and geometry ops stay disabled.
- Every operation form shows a live preview in the viewport and the status bar before Apply. The preview is an uncommitted step on top of the history; closing the form or switching tools discards it.
- Paint assigns each triangle a color slot: Base or filament 1 to 16. Fill paints a connected region within a normal angle of the clicked face, Brush paints along a drag, Height paints a Z band, Part paints one shell, All paints everything. Slots survive every later operation and recipe replay because they ride on manifold-3d run IDs.
- A paint op does not rebuild the manifold. It keeps its colors beside the geometry, and the next geometry op (cut, boolean, text, split, transform) bakes them into run IDs first. On a 320k-triangle mesh a paint takes under 100 ms and the one-time bake about 0.8 s.
- Fill has two rules. Stop at creases, the default, compares each triangle with the neighbor it was reached from, so it follows smooth curves and stops where the dihedral angle exceeds the threshold. Similar direction compares every triangle with the hovered face's normal. Recipes without a rule replay as Similar direction.
- Paint boundaries follow triangle edges. On coarse models, apply Refine first: it splits edges longer than the given length with manifold-3d's refineToLength and leaves small triangles alone, so fills and Height bands get a finer edge.
- Consecutive paint steps with the same color merge into one step with a list of selections when a recipe is saved, and the Merge paints button in the History panel does the same in place. Undo still steps back one fill at a time until you merge.
- In Fill mode the hover preview stays pinned when the pointer leaves the model, so the angle can be tuned from the panel and applied with Paint highlighted or nudged with [ and ].
- A 3MF export writes one `m:colorgroup` color per palette slot plus Bambu `paint_color` attributes. Bambu Studio and OrcaSlicer show one filament per slot in palette order, so two slots must not share a hex; export refuses a palette with duplicate colors.
- Surfaces created by a Cut are Base. Surfaces created by a Boolean or Text tool take that form's Color selection, which defaults to Base.
- STL and OBJ cannot carry colors. Exporting a painted model to either format succeeds and the status bar warns that colors were dropped.
- 3MF import reads `m:colorgroup` and `basematerials` references and Bambu or PrusaSlicer paint attributes on unsplit triangles. Distinct colors become slots in order of first use; a 17th color and any split paint code become Base with a warning.
- Recipes with a palette are version 2. Version 1 recipes still load. Applying a version 2 recipe replaces the current palette.
- Fill and Brush share one triangle adjacency table per mesh, built with a counting sort in about 50 ms for 320k triangles and cached until the geometry changes.
