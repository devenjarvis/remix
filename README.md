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
- Paint assigns each triangle a color slot: Base or filament 1 to 16. The Paint form builds a live selection from gestures and paints it once with Enter or Paint selection. Region gestures are Segment (a connected surface region whose normals stay within the tolerance of one mean direction), Fill (a connected region within an angle of the clicked face), Brush (a drag stroke), Lasso (a loop drawn on the viewport), Height (a Z band), Part (one shell), and All. Each region gesture adds to or subtracts from the selection; Alt held flips the mode for one click or drag. Invert, Grow, and Shrink transform the running selection, Undo gesture (Backspace) drops the last gesture, and Clear (Escape) empties it. The selection shows as a tint on the model and closes with the form. Slots survive every later operation and recipe replay because they ride on manifold-3d run IDs.
- A paint step stores its gesture list and replays it in order to one triangle set per part. Segment labels the whole mesh by merging neighbors in ascending dihedral order while every normal in a region stays within the tolerance of the region's area-weighted mean; the labeling is cached per mesh and tolerance, so hovering is free after the first pass. Lasso stores the camera position and the loop as a world polygon, and selects triangles that face that eye, whose centroid projects inside the loop, and whose centroid no other triangle hides from the eye, so replay never needs the camera. Fill and Brush with Dam checked do not enter triangles that are already painted, which keeps a fill from leaking across an earlier boundary. Grow and Shrink step from centroid to centroid over triangle adjacency, so their distance is an approximation that overshoots on coarse meshes rather than a true surface distance.
- A paint op does not rebuild the manifold. It keeps its colors beside the geometry, and the next geometry op (cut, boolean, text, split, transform) bakes them into run IDs first. On a 320k-triangle mesh a paint takes under 100 ms and the one-time bake about 0.8 s.
- Fill has two rules. Similar direction, the default, compares every triangle with the hovered face's normal. Stop at creases compares each triangle with the neighbor it was reached from, so it follows smooth curves and stops where the dihedral angle exceeds the threshold. Recipes without a rule replay as Similar direction.
- Edges has two settings. Smooth, the default, first splits the mesh on the exact contour of every Height plane and Lasso outline in the step, then resolves the selection, then splits once more along the 0.5 iso-line of the per-corner selected fraction so a fill, segment, or brush region ends on a smooth curve. Corners are weighted by corner angle, a corner counts only neighbors within 40° of the triangle's normal so a boundary on a sharp crease stays exactly on the crease, a crossing within 2% of a vertex is not split, and a vertex where the boundary already runs straight through, or that this step's own contour split created, is kept in place. Together these mean a second paint next to an earlier one adds no slivers along the earlier boundary. Triangles keeps whole triangles. Recipes without the field replay as Triangles. On a 320k-triangle sphere a smooth Fill takes about 180 ms, a smooth Height about 200 ms, a Segment about 420 ms (220 ms of it the one-time labeling), a Lasso about 720 ms (230 ms building the ray tree, the rest visibility tests), and a step of five gestures about 1 s; the split changes the index array, so the viewport rebuilds its geometry and raycast tree on that paint. The split mesh stays manifold, and the extra triangles remain if the region is later repainted Base.
- Refine is still available for models whose triangles are too coarse for the brush: it splits edges longer than the given length with manifold-3d's refineToLength and leaves small triangles alone.
- Consecutive paint steps with the same color and edges merge into one step with a list of gestures when a recipe is saved, and the Merge paints button in the History panel does the same in place. A step merges into the one before it only when every gesture in it adds a region without a dam; a step with a subtract, invert, grow, shrink, or dam keeps its own place, because its meaning depends on the set it starts from.
- Keys in the Paint form: 1 to 9 pick a slot, [ and ] nudge the angle or tolerance by 1°, Alt flips Add and Subtract while held, Enter paints the selection, Backspace undoes the last gesture, and Escape clears the selection.
- Measured on a 396k-triangle scanned hen painted with 47 fills: labeling the whole mesh takes 300 to 450 ms per tolerance, and covering 90% of the painted area with the largest segments alone would take about 66 clicks at 45° or 36 at 60°, more than the 47 fills, because scan noise breaks a smooth region into many segments. On such surfaces Lasso and a Segment followed by Grow do the work; Segment on its own suits models with clean faces.
- A 3MF export writes one `m:colorgroup` color per palette slot plus Bambu `paint_color` attributes. Bambu Studio and OrcaSlicer show one filament per slot in palette order, so two slots must not share a hex; export refuses a palette with duplicate colors.
- Surfaces created by a Cut are Base. Surfaces created by a Boolean or Text tool take that form's Color selection, which defaults to Base.
- STL and OBJ cannot carry colors. Exporting a painted model to either format succeeds and the status bar warns that colors were dropped.
- 3MF import reads `m:colorgroup` and `basematerials` references and Bambu or PrusaSlicer paint attributes on unsplit triangles. Distinct colors become slots in order of first use; a 17th color and any split paint code become Base with a warning.
- Recipes with a palette are version 2. Version 1 recipes still load. Applying a version 2 recipe replaces the current palette.
- Fill and Brush share one triangle adjacency table per mesh, built with a counting sort in about 50 ms for 320k triangles and cached until the geometry changes.
