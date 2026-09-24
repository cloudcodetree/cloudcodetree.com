'use client';

// Like / dislike for one article or tutorial lesson. Works signed in (state in
// reader_state) and signed out (state in localStorage). No counts, ever: the
// reader sees only their own choice.
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
import { ThumbDown, ThumbDownOutlined, ThumbUp, ThumbUpOutlined } from '@mui/icons-material';
import { ACCENT, MONO } from './blogShared';
import { loadReaderState, mergeLocalReactions, setReaction, watchReaderAuth, type Reaction } from '../lib/readerState';
import { clearLocalReactions, readLocalReactions, writeLocalReaction } from '../lib/localReactions';
import { nextReaction, reactionDeltas, sendEngagement } from '../lib/engagement';

export default function ReactionBar({ itemId, title }: { itemId: string; title: string }) {
  const [reaction, setReactionState] = useState<Reaction>(0);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState(false);
  // The settled reaction, updated synchronously. Deltas are computed from this,
  // never from render state, so two fast clicks cannot both start from "none".
  const current = useRef<Reaction>(0);
  const busy = useRef(false);
  const userRef = useRef<string | null>(null);
  // Where this reader's reaction lives: their account, or this browser. A
  // signed-in reader whose account cannot load (Supabase paused, offline)
  // falls back to this browser, and the next successful load merges it in.
  const modeRef = useRef<'account' | 'local'>('local');

  useEffect(() => {
    let live = true;
    const show = (r: Reaction) => { current.current = r; setReactionState(r); };
    const stop = watchReaderAuth((userId) => {
      if (!live) return;
      userRef.current = userId;
      setWriteError(false);
      if (!userId) {
        modeRef.current = 'local';
        show(readLocalReactions()[itemId] ?? 0);
        setReady(true);
        return;
      }
      setReady(false);
      void (async () => {
        try {
          const account = await loadReaderState();
          const merged = await mergeLocalReactions(readLocalReactions(), account);
          clearLocalReactions(merged.settled);
          if (!live || userRef.current !== userId) return;
          modeRef.current = 'account';
          show(merged.applied[itemId] ?? account.get(itemId)?.reaction ?? 0);
          setReady(true);
        } catch {
          if (!live || userRef.current !== userId) return;
          modeRef.current = 'local';
          show(readLocalReactions()[itemId] ?? 0);
          setReady(true);
        }
      })();
    });
    return () => { live = false; stop(); };
  }, [itemId]);

  const click = async (clicked: 1 | -1) => {
    if (busy.current || !ready) return;
    busy.current = true;
    setPending(true);
    const from = current.current;
    const to = nextReaction(from, clicked);
    current.current = to;
    setReactionState(to);
    setWriteError(false);
    let ok = true;
    if (modeRef.current === 'account') ok = await setReaction(itemId, to);
    else writeLocalReaction(itemId, to);
    if (ok) {
      void sendEngagement(itemId, reactionDeltas(from, to));
    } else {
      // Send nothing, put the button back, and say so: a silent revert just
      // makes the reader click again.
      current.current = from;
      setReactionState(from);
      setWriteError(true);
    }
    busy.current = false;
    setPending(false);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <ReactionButton kind="like" active={reaction === 1} title={title} disabled={!ready || pending} onClick={() => void click(1)} />
        <ReactionButton kind="dislike" active={reaction === -1} title={title} disabled={!ready || pending} onClick={() => void click(-1)} />
      </Box>
      {writeError && <Alert severity="warning" sx={{ mt: 1 }}>Your reaction could not be saved. Please try again.</Alert>}
    </Box>
  );
}

function ReactionButton({ kind, active, title, disabled, onClick }: {
  kind: 'like' | 'dislike'; active: boolean; title: string; disabled: boolean; onClick: () => void;
}) {
  const like = kind === 'like';
  const Icon = like ? (active ? ThumbUp : ThumbUpOutlined) : (active ? ThumbDown : ThumbDownOutlined);
  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<Icon />}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={`${like ? 'Like' : 'Dislike'} “${title}”`}
      sx={{
        fontFamily: MONO, fontSize: 12, textTransform: 'none',
        color: active ? ACCENT : 'text.secondary',
        borderColor: active ? 'rgba(148,188,227,0.45)' : 'rgba(148,163,184,0.25)',
        background: active ? 'rgba(148,188,227,0.12)' : 'transparent',
        '&:hover': { borderColor: ACCENT, color: ACCENT, background: 'rgba(148,188,227,0.08)' },
      }}
    >
      {like ? 'Like' : 'Dislike'}
    </Button>
  );
}
