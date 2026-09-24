'use client';

// A signed-out reader's reactions, kept in localStorage so they survive a
// reload. Every function tolerates blocked or full storage: the reaction was
// still counted, it just will not survive the page.
import type { Reaction } from './readerState';

const KEY = 'cct-reactions';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalReactions(store: Store | null = defaultStore()): Record<string, Reaction> {
  try {
    const raw = store?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const out: Record<string, Reaction> = {};
    if (parsed && typeof parsed === 'object') {
      for (const [id, v] of Object.entries(parsed)) if (v === 1 || v === -1) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeLocalReaction(id: string, reaction: Reaction, store: Store | null = defaultStore()): void {
  try {
    const all = readLocalReactions(store);
    if (reaction === 0) delete all[id];
    else all[id] = reaction;
    store?.setItem(KEY, JSON.stringify(all));
  } catch {
    // Blocked or full storage.
  }
}

export function clearLocalReactions(ids: string[], store: Store | null = defaultStore()): void {
  if (ids.length === 0) return;
  try {
    const all = readLocalReactions(store);
    for (const id of ids) delete all[id];
    store?.setItem(KEY, JSON.stringify(all));
  } catch {
    // Blocked or full storage.
  }
}
