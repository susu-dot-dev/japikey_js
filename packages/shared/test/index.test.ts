import { describe, test, expect } from 'vitest';
import {
  ALG,
  VER_PREFIX,
  VER_NUM,
  VER,
  appendPathToUrl,
} from '../src/index.ts';

describe('shared', () => {
  test('index exports', () => {
    expect(ALG).toBe('RS256');
    expect(VER_PREFIX).toBe('japikey-v');
    expect(VER_NUM).toBe(1);
    expect(VER).toBe('japikey-v1');
    expect(appendPathToUrl).toBeDefined();
  });
});
