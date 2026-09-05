import { loadModel, type Loaded } from '../io/load';

export type FileHandler = (name: string, loaded: Loaded) => void;

export async function readModelFile(file: File): Promise<Loaded> {
  return loadModel(file.name, await file.arrayBuffer());
}

export function wireFileOpen(
  button: HTMLElement,
  input: HTMLInputElement,
  dropZone: HTMLElement,
  onFile: (file: File) => void,
): void {
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onFile(f);
    input.value = '';
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
}

export function pickFile(input: HTMLInputElement): Promise<File | null> {
  return new Promise((resolve) => {
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.value = '';
    };
    input.click();
  });
}
