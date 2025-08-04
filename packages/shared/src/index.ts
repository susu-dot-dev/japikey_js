import { appendPathToUrl } from './util.ts';
export * from './errors.ts';

export const ALG = 'RS256';
export const VER_PREFIX = 'japikey-v';
export const VER_NUM = 1;
export const VER = `${VER_PREFIX}${VER_NUM}`;

export { appendPathToUrl };
