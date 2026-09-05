import { describe, expect, it } from 'vitest';

describe('smoke', () => {
  it('resolves core types module', async () => {
    const mod = await import('../src/core/types');
    expect(mod).toBeDefined();
  });
});
