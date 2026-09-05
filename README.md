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
