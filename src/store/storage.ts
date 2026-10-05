import { del, get, set } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

// IndexedDB first, then localStorage, then memory. Every access is wrapped so the app
// keeps working with storage blocked (private windows, file:// quirks).
const memory = new Map<string, string>();

function ls(): Storage | null {
  try {
    const s = window.localStorage;
    const k = '__br_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export const safeStorage: StateStorage = {
  async getItem(name) {
    try {
      const v = await get<string>(name);
      if (typeof v === 'string') return v;
    } catch {
      /* fall through */
    }
    try {
      const v = ls()?.getItem(name);
      if (v != null) return v;
    } catch {
      /* fall through */
    }
    return memory.get(name) ?? null;
  },
  async setItem(name, value) {
    memory.set(name, value);
    try {
      await set(name, value);
      return;
    } catch {
      /* fall through */
    }
    try {
      ls()?.setItem(name, value);
    } catch {
      /* memory only */
    }
  },
  async removeItem(name) {
    memory.delete(name);
    try {
      await del(name);
    } catch {
      /* ignore */
    }
    try {
      ls()?.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};
