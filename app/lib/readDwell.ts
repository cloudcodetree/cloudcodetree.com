// A "read" is 10 cumulative seconds of the article being visible, sent once per
// item per browser. Separate from reader_state.read_at, which marks an item as
// opened immediately and drives the Hide read filter.

export const READ_DWELL_MS = 10_000;
export const MAX_SENT_READS = 2000;
const KEY = 'cct-reads-sent';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Accumulates visible time and calls `onReached` once when it crosses the threshold. */
export function createDwell(thresholdMs: number, onReached: () => void) {
  let spent = 0;
  let startedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const hide = () => {
    if (startedAt === null) return;
    spent += Date.now() - startedAt;
    startedAt = null;
    if (timer) { clearTimeout(timer); timer = null; }
  };
  const show = () => {
    if (finished || startedAt !== null) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      finished = true;
      timer = null;
      startedAt = null;
      onReached();
    }, Math.max(0, thresholdMs - spent));
  };
  const dispose = () => { hide(); finished = true; };
  return { show, hide, dispose };
}

function defaultStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The ids whose read was already sent from this browser, newest last. */
export function readLedger(store: Store | null = defaultStore()) {
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(store?.getItem(KEY) ?? '[]');
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    ids = [];
  }
  return {
    has: (id: string) => ids.includes(id),
    add: (id: string) => {
      ids = [...ids.filter((x) => x !== id), id].slice(-MAX_SENT_READS);
      try { store?.setItem(KEY, JSON.stringify(ids)); } catch { /* blocked: memory only */ }
    },
  };
}
