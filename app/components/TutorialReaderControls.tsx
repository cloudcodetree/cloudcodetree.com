'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Alert, Box, Button } from '@mui/material';
import Link from 'next/link';
import { siteTutorials } from '../tutorials/manifest';
import { tutorialReaderId } from '../../scripts/lib/tutorial-catalog.mjs';
import { useReaderLibrary } from '../lib/useReaderLibrary';
import { markRead } from '../lib/readerState';
import { SaveChip } from './ReaderChips';
import ReaderStateNotice from './ReaderStateNotice';

/** Lives in the article layout so every published MDX lesson gets the controls. */
export default function TutorialReaderControls() {
  const slug = usePathname().replace(/\/$/, '').split('/').pop();
  const tutorial = siteTutorials.find((t) => t.slug === slug);
  const reader = useReaderLibrary();
  const id = tutorial ? tutorialReaderId(tutorial.slug) : null;
  useEffect(() => { if (id && reader.signedIn) markRead(id); }, [id, reader.signedIn]);
  if (!tutorial || !id || !reader.signedIn) return null;
  return <Box sx={{ mb: 3 }}>
    {reader.status === 'error' && <ReaderStateNotice onRetry={reader.retry} />}
    {reader.writeError && <Alert severity="warning" sx={{ mb: 2 }}>This tutorial could not be saved. Please try again.</Alert>}
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <SaveChip post={{ title: tutorial.title, isSaved: !!reader.state.get(id)?.saved }} onToggle={() => reader.toggleSaved(id)} busy={reader.status !== 'ready' || !!reader.pending[id]} />
      <Button component={Link} prefetch={false} href="/saved/?section=tutorials" size="small" sx={{ textTransform: 'none' }}>Saved tutorials</Button>
    </Box>
  </Box>;
}
