'use client';

import { useEffect, useState } from 'react';
import { Box, Container, Tab, Tabs } from '@mui/material';
import dynamic from 'next/dynamic';
import SavedPosts from './SavedPosts';
import type { BlogPost } from './blogShared';
import type { PostArchive } from '../lib/usePostArchive';
import type { Tutorial } from '../tutorials/manifest';
const TutorialsList = dynamic(() => import('./TutorialsList'));

export default function SavedLibrary({ posts, archive, tutorials, seriesTotals }: { posts: BlogPost[]; archive: PostArchive; tutorials: Tutorial[]; seriesTotals: Record<string, number> }) {
  const [section, setSection] = useState<'blog' | 'tutorials'>('blog');
  useEffect(() => {
    const sync = () => setSection(new URLSearchParams(window.location.search).get('section') === 'tutorials' ? 'tutorials' : 'blog');
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const select = (value: 'blog' | 'tutorials') => {
    const params = new URLSearchParams(window.location.search);
    if (value === 'tutorials') params.set('section', value); else params.delete('section');
    for (const key of ['page', 'q', 'topics', 'series']) params.delete(key);
    const qs = params.toString();
    window.history.pushState(null, '', `/saved/${qs ? `?${qs}` : ''}`);
    setSection(value);
  };
  return <>
    <Container maxWidth="lg" sx={{ pt: 3 }}>
      <Tabs value={section} onChange={(_, value) => select(value)} aria-label="Saved content">
        <Tab value="blog" label="Blog" id="saved-blog" aria-controls="saved-blog-panel" />
        <Tab value="tutorials" label="Tutorials" id="saved-tutorials" aria-controls="saved-tutorials-panel" />
      </Tabs>
    </Container>
    <Box role="tabpanel" id={`saved-${section}-panel`} aria-labelledby={`saved-${section}`}>
      {section === 'blog' ? <SavedPosts posts={posts} archive={archive} /> : <TutorialsList tutorials={tutorials} seriesTotals={seriesTotals} variant="all" onlySaved />}
    </Box>
  </>;
}
