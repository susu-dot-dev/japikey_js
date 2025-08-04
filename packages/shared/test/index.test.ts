import { describe, it, expect } from 'vitest';
import { hello_world } from '../src/index.js';

describe('shared', () => {
  it('should export hello_world as "hello world from shared"', () => {
    expect(hello_world).toBe('hello world from shared');
  });
});
