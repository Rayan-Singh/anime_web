import * as anilist from './anilist.mjs';
import * as jikan from './jikan.mjs';
import * as kitsu from './kitsu.mjs';

export const sources = ['anilist', 'jikan', 'kitsu'];
const adapters = { anilist, jikan, kitsu };

export function normalizeSource(value, fallback = 'anilist') {
  const source = String(value || fallback).toLowerCase();
  return [...sources, 'auto'].includes(source) ? source : fallback;
}

export async function call(method, source, ...args) {
  const requested = normalizeSource(source, 'auto');
  if (requested !== 'auto') return adapters[requested][method](...args);
  let primaryError;
  for (const adapter of [anilist, jikan, kitsu]) {
    try { return await adapter[method](...args); }
    catch (error) { primaryError ||= error; }
  }
  throw primaryError;
}
