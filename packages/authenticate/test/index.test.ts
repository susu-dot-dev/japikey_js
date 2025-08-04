import { describe, it, expect } from 'vitest';
import { hello_world } from '../src/index.js';

describe('authenticate', () => {
  it('should export hello_world as "hello world"', () => {
    expect(hello_world).toBe('hello world');
  });
});
