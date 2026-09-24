'use client';

// Like / dislike for one article or tutorial lesson. Works signed in (state in
// reader_state) and signed out (state in localStorage). No counts, ever: the
// reader sees only their own choice.
import { useEffect, useRef, useState } from 'react';
import { Box, Button } from '@mui/material';
import { ThumbDown, ThumbDownOutlined, ThumbUp, ThumbUpOutlined } from '@mui/icons-material';
import { ACCENT, MONO } from './blogShared';
import { loadReaderState, mergeLocalReactions, setReaction, watchReaderAuth, type Reaction } from '../lib/readerState';
import { clearLocalReactions, readLocalReactions, writeLocalReaction } from '../lib/localReactions';
import { nextReaction, reactionDeltas, sendEngagement } from '../lib/engagement';

export default function ReactionBar({ itemId, title }: { itemId: string; title: string }) {
  const [reaction, setReactionState] = useState<Reaction>(0);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  // The settled reaction, updated synchronously. Deltas are computed from this,
  // never from render state, so two fast clicks cannot both start from "none".
  const current = useRef<Reaction>(0);
  const busy = useRef(false);
  const userRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    const show = (r: Reaction) => { current.current = r; setReactionState(r); };
    const stop = watchReaderAuth((userId) => {
      if (!live) return;
      userRef.current = userId;
      if (!userId) {
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
          show(merged.applied[itemId] ?? account.get(itemId)?.reaction ?? 0);
          setReady(true);
        } catch {
          // Unknown account state: leave the buttons disabled rather than
          // compute deltas from a guess.
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
    let ok = true;
    if (userRef.current) ok = await setReaction(itemId, to);
    else writeLocalReaction(itemId, to);
    if (ok) {
      void sendEngagement(itemId, reactionDeltas(from, to));
    } else {
      current.current = from;
      setReactionState(from);
    }
    busy.current = false;
    setPending(false);
  };

  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <ReactionButton kind="like" active={reaction === 1} title={title} disabled={!ready || pending} onClick={() => void click(1)} />
      <ReactionButton kind="dislike" active={reaction === -1} title={title} disabled={!ready || pending} onClick={() => void click(-1)} />
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
