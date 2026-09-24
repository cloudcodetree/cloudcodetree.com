'use client';

import { useEffect, useRef, useState } from 'react';
import { Corners } from './Blueprint';
import { Container, Typography, Box, Card, CardContent, Chip, Button } from '@mui/material';
import { AccessTime as TimeIcon, Person as PersonIcon, Bookmark, BookmarkBorder } from '@mui/icons-material';
import Link from 'next/link';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { BlogPost as Post, SERIF, MONO, ACCENT, formatPublished, markdownSx, markdownComponents } from './blogShared';
import SearchBox from './SearchBox';
import ReaderStateNotice from './ReaderStateNotice';
import RelatedPosts from './RelatedPosts';
import { loadReaderState, markRead, setSaved, watchReaderAuth } from '../lib/readerState';
import ReactionBar from './ReactionBar';
import { useReadDwell } from '../lib/useReadDwell';

// The post is loaded at build time by app/ai-news/[id]/page.tsx and baked into
// the static HTML — no client-side fetch, no loading state.
export default function BlogPost({ post, related = [] }: { post: Post; related?: Post[] }) {
  // Signed-out readers never leave these defaults, so the prerendered article
  // and the signed-out browser render are the same page.
  const [readerError, setReaderError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const [saved, setSavedState] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const savePendingRef = useRef(false);
  useReadDwell(post.id);

  // Opening the article IS the read event — no extra click. Fire-and-forget:
  // markRead never blocks the render and swallows its own failures.
  //
  // Tracked rather than probed once, so signing out clears the control instead
  // of leaving the previous reader's "Saved" on screen, and signing in here
  // turns it on without a reload.
  // Keyed on the reader, not on every auth event: TOKEN_REFRESHED arrives
  // roughly hourly, and re-running this would blank `saved` and re-read it,
  // flashing the button from "Saved" to "Save" and back under a reader who is
  // simply reading the article.
  const readerRef = useRef<string | null>(null);
  useEffect(() => {
    readerRef.current = null;
    setReaderError(false);
    let live = true;
    const stop = watchReaderAuth((userId) => {
      if (!live) return;
      if (userId === readerRef.current) return;   // same reader, new token
      readerRef.current = userId;
      // Reset first: this effect re-runs when the route changes to another
      // article, and a stale `true` would show "Saved" on a post that is not.
      setReaderError(false);
      setSignedIn(!!userId);
      setSavedState(false);
      setSavePending(false);
      savePendingRef.current = false;
      if (!userId) return;
      markRead(post.id);
      void loadReaderState().then((state) => {
        const row = state.get(post.id);
        if (live && readerRef.current === userId && row) setSavedState(row.saved);
      }).catch(() => { if (live && readerRef.current === userId) setReaderError(true); });
    });
    return () => { live = false; stop(); };
  }, [post.id, retry]);

  // The ref is the guard, the state only disables the button: two clicks in one
  // tick both read the render's captured `savePending`, so state alone would let
  // the second through and `true` could land after `false`.
  const toggleSaved = () => {
    if (savePendingRef.current || readerError) return;
    const userId = readerRef.current;
    savePendingRef.current = true;
    const next = !saved;
    setSavedState(next);                                        // optimistic
    setSavePending(true);
    void setSaved(post.id, next).then((ok) => {
      if (readerRef.current !== userId) return;
      savePendingRef.current = false;
      if (!ok) setSavedState(!next);
      setSavePending(false);
    });
  };

  const backButton = (
    <Button component={Link} href="/ai-news/">
      ← Back to AI News
    </Button>
  );

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, md: 4 } }}>
      {readerError && <ReaderStateNotice onRetry={() => setRetry((n) => n + 1)} />}
      <motion.div initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 4 }}>
          {backButton}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <ReactionBar itemId={post.id} title={post.title} />
            {signedIn && (
              <Button
                size="small"
                variant="outlined"
                startIcon={saved ? <Bookmark /> : <BookmarkBorder />}
                onClick={toggleSaved}
                disabled={savePending || readerError}
                aria-pressed={saved}
                sx={{
                  fontFamily: MONO, fontSize: 12, textTransform: 'none',
                  color: saved ? ACCENT : 'text.secondary',
                  borderColor: saved ? 'rgba(148,188,227,0.45)' : 'rgba(148,163,184,0.25)',
                  background: saved ? 'rgba(148,188,227,0.12)' : 'transparent',
                  '&:hover': { borderColor: ACCENT, color: ACCENT, background: 'rgba(148,188,227,0.08)' },
                }}
              >
                {saved ? 'Saved' : 'Save'}
              </Button>
            )}
            <SearchBox />
          </Box>
        </Box>

        {post.image && (
          <Box sx={{ mb: 3 }}>
            <Box sx={{ position: 'relative', border: '1px solid rgba(242,242,243,0.2)' }}>
              <Corners />
              <Box
                component="img"
                src={post.image}
                alt={post.title}
                sx={{ width: '100%', aspectRatio: '1200 / 630', objectFit: 'cover', display: 'block' }}
              />
            </Box>
            {post.imageCredit && (
              <Typography sx={{ mt: 0.75, fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>
                Photo:{' '}
                <Box component="a" href={post.imageCreditUrl || 'https://www.pexels.com'} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', textDecoration: 'underline' }}>
                  {post.imageCredit}
                </Box>
                {' / '}
                <Box component="a" href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', textDecoration: 'underline' }}>
                  Pexels
                </Box>
              </Typography>
            )}
          </Box>
        )}

        <Typography
          component="h1"
          sx={{
            fontFamily: SERIF, fontWeight: 600, fontSize: { xs: '1.6rem', sm: '2.1rem', md: '3rem' },
            lineHeight: 1.12, letterSpacing: '-0.015em', mb: 2, overflowWrap: 'anywhere',
          }}
        >
          {post.title}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: post.dek ? 2 : 4, color: 'text.secondary' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <PersonIcon fontSize="small" />
            <Typography variant="body2">{post.author}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TimeIcon fontSize="small" />
            <Typography variant="body2">{post.readTime} min read</Typography>
          </Box>
          <Typography variant="body2">{formatPublished(post)}</Typography>
        </Box>

        <Box sx={{ mb: 4 }}>
          {post.tags.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              size="small"
              sx={{ mr: 1, mb: 1, background: 'rgba(116,157,196, 0.1)', color: '#749dc4', border: '1px solid rgba(116,157,196, 0.3)' }}
            />
          ))}
        </Box>

        {post.dek && (
          <Typography sx={{ color: 'text.secondary', fontSize: '1.12rem', lineHeight: 1.6, mb: 4, pb: 3, borderBottom: '1px solid #222a35' }}>
            {post.dek}
          </Typography>
        )}

        <Card className="glass">
          <CardContent sx={{ p: { xs: 2, sm: 3, md: 4 } }}>
            <Box sx={markdownSx}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>{post.content || ''}</ReactMarkdown>
            </Box>
          </CardContent>
        </Card>

        <RelatedPosts posts={related} />
      </motion.div>
    </Container>
  );
}
