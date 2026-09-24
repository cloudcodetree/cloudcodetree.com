'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadReaderState, setSaved, watchReaderAuth, type ReaderStateMap } from './readerState';

/** Shared optimistic reading state for blog posts and tutorial lessons. */
export function useReaderLibrary() {
  const [state, setState] = useState<ReaderStateMap>(new Map());
  const [status, setStatus] = useState<'loading' | 'signedOut' | 'ready' | 'error'>('loading');
  const [signedIn, setSignedIn] = useState(false);
  const [writeError, setWriteError] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [attempt, setAttempt] = useState(0);
  const userRef = useRef<string | null>(null);
  const pendingRef = useRef<Record<string, boolean>>({});
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    let live = true;
    userRef.current = null;
    setWriteError(false);
    const stop = watchReaderAuth((userId) => {
      if (!live) return;
      if (userId && userId === userRef.current) return;
      userRef.current = userId;
      setSignedIn(!!userId);
      setState(new Map());
      pendingRef.current = {};
      setPending({});
      if (!userId) { setStatus('signedOut'); return; }
      setStatus('loading');
      void loadReaderState().then((rows) => {
        if (!live || userRef.current !== userId) return;
        setState(rows);
        setStatus('ready');
      }).catch(() => { if (live && userRef.current === userId) setStatus('error'); });
    });
    return () => { live = false; userRef.current = null; stop(); };
  }, [attempt]);

  const toggleSaved = useCallback((id: string) => {
    const userId = userRef.current;
    if (!userId || status !== 'ready' || pendingRef.current[id]) return;
    pendingRef.current[id] = true;
    setPending((cur) => ({ ...cur, [id]: true }));
    setWriteError(false);
    const before = stateRef.current.get(id);
    const saved = !before?.saved;
    setState((cur) => new Map(cur).set(id, { post_id: id, saved, read_at: before?.read_at ?? null, reaction: before?.reaction ?? 0 }));
    void setSaved(id, saved).then((ok) => {
      if (userRef.current !== userId) return;
      delete pendingRef.current[id];
      setPending((cur) => ({ ...cur, [id]: false }));
      if (!ok) {
        setWriteError(true);
        setState((cur) => {
          const next = new Map(cur);
          if (before) next.set(id, before); else next.delete(id);
          return next;
        });
      }
    });
  }, [status]);
  return { state, status, signedIn, pending, writeError, toggleSaved, retry: () => setAttempt((n) => n + 1) };
}
