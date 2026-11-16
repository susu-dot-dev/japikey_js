import { describe, test, expect } from 'vitest';
import {
  ALG,
  ALG_BY_VER,
  VER_PREFIX,
  VER_NUM,
  VER,
  appendPathToUrl,
} from '../src/index.ts';

describe('shared', () => {
  test('index exports', () => {
    expect(ALG).toBe('ES256');
    expect(ALG_BY_VER[VER_NUM]).toBe(ALG);
    expect(ALG_BY_VER).toEqual({ 1: 'RS256', 2: 'ES256' });
    expect(VER_PREFIX).toBe('japikey-v');
    expect(VER_NUM).toBe(2);
    expect(VER).toBe('japikey-v2');
    expect(appendPathToUrl).toBeDefined();
  });
});
