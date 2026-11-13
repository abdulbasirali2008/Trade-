import { useSyncExternalStore } from 'react';

/** Tiny external store with optional localStorage persistence. */
export function createStore(initial, storageKey = null) {
  let state = initial;
  if (storageKey) {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) state = { ...initial, ...JSON.parse(raw) };
    } catch (e) { /* storage blocked */ }
  }
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      if (storageKey) {
        try { window.localStorage.setItem(storageKey, JSON.stringify(state)); } catch (e) { /* ignore */ }
      }
      listeners.forEach((f) => f());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const useStore = (store) => useSyncExternalStore(store.subscribe, store.get, store.get);
