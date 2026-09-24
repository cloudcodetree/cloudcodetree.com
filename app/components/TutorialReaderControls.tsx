'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Alert, Box, Button } from '@mui/material';
import Link from 'next/link';
import type { LessonRef } from '../tutorials/lessonRef';
import { tutorialReaderId } from '../../scripts/lib/tutorial-catalog.mjs';
import { useReaderLibrary } from '../lib/useReaderLibrary';
import { markRead } from '../lib/readerState';
import { SaveChip } from './ReaderChips';
import ReaderStateNotice from './ReaderStateNotice';
import ReactionBar from './ReactionBar';
import { useReadDwell } from '../lib/useReadDwell';

/** Lives in the article layout so every published MDX lesson gets the controls.
 *  `lessons` arrives already gated from the server layout. Reactions show for
 *  every reader. Save and the saved link need an account. */
export default function TutorialReaderControls({ lessons }: { lessons: LessonRef[] }) {
  const slug = usePathname().replace(/\/$/, '').split('/').pop();
  const tutorial = lessons.find((t) => t.slug === slug);
  const reader = useReaderLibrary();
  const id = tutorial ? tutorialReaderId(tutorial.slug) : null;
  useEffect(() => { if (id && reader.signedIn) markRead(id); }, [id, reader.signedIn]);
  useReadDwell(id);
  if (!tutorial || !id) return null;
  return <Box sx={{ mb: 3 }}>
    {reader.signedIn && reader.status === 'error' && <ReaderStateNotice onRetry={reader.retry} />}
    {reader.signedIn && reader.writeError && <Alert severity="warning" sx={{ mb: 2 }}>This tutorial could not be saved. Please try again.</Alert>}
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      <ReactionBar itemId={id} title={tutorial.title} />
      {reader.signedIn && <SaveChip post={{ title: tutorial.title, isSaved: !!reader.state.get(id)?.saved }} onToggle={() => reader.toggleSaved(id)} busy={reader.status !== 'ready' || !!reader.pending[id]} />}
      {reader.signedIn && <Button component={Link} prefetch={false} href="/saved/?section=tutorials" size="small" sx={{ textTransform: 'none' }}>Saved tutorials</Button>}
    </Box>
  </Box>;
}
