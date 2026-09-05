# Remix

A browser-based tool for remixing 3D-print models. Load an STL, OBJ, or 3MF file, then scale, mirror, rotate, lay flat, cut, split, boolean, and add text. Every operation is recorded in an undoable history that can be saved as a recipe and replayed on another model.

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
