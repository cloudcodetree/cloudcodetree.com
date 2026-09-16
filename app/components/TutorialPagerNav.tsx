'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Box, Typography } from '@mui/material';
import type { LessonRef } from '../tutorials/lessonRef';
import { LINK } from './blogShared';

/**
 * Previous/Next navigation at the bottom of every tutorial article.
 * Series-aware: neighbors are the adjacent parts of the same series (by
 * `part`), so DealFinder Part 9 links to Parts 8 and 10 even if the global
 * manifest order interleaves other series. Standalone or unknown slugs
 * render nothing. Client component: layouts get no slug param under the
 * static export, so the pathname is the lookup key. The lessons come from the
 * server layout already gated — this never sees a held lesson.
 */

function findNeighbors(pathname: string, lessons: LessonRef[]): { prev?: LessonRef; next?: LessonRef } {
  const slug = pathname.replace(/\/+$/, '').split('/').pop() || '';
  const current = lessons.find((t) => t.slug === slug);
  if (!current) return {};
  const siblings = lessons
    .filter((t) => t.series === current.series)
    .sort((a, b) => a.part - b.part);
  const i = siblings.findIndex((t) => t.slug === slug);
  return { prev: siblings[i - 1], next: siblings[i + 1] };
}

function PagerCard({ t, dir }: { t: LessonRef; dir: 'prev' | 'next' }) {
  const arrow = dir === 'prev' ? '←' : '→';
  return (
    <Box
      component={Link}
      href={`/tutorials/${t.slug}/`}
      sx={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'block',
        textDecoration: 'none',
        border: '1px solid #222a35',
        borderRadius: 2,
        p: 2,
        backgroundColor: 'rgba(22,27,34,0.6)',
        textAlign: dir === 'prev' ? 'left' : 'right',
        transition: 'border-color 0.2s, background-color 0.2s',
        '&:hover': { borderColor: LINK, backgroundColor: 'rgba(22,27,34,0.9)' },
      }}
    >
      <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {dir === 'prev' ? `${arrow} Previous` : `Next ${arrow}`}
      </Typography>
      <Typography sx={{ fontSize: '0.9rem', color: LINK, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Part {t.part}: {t.title}
      </Typography>
    </Box>
  );
}

export default function TutorialPagerNav({ lessons }: { lessons: LessonRef[] }) {
  const pathname = usePathname();
  const { prev, next } = findNeighbors(pathname, lessons);
  if (!prev && !next) return null;

  return (
    <Box
      component="nav"
      aria-label="Tutorial series navigation"
      sx={{ display: 'flex', gap: 2, mt: 6, pt: 3, borderTop: '1px solid #222a35', flexDirection: { xs: 'column', sm: 'row' } }}
    >
      {prev ? <PagerCard t={prev} dir="prev" /> : <Box sx={{ flex: '1 1 0', display: { xs: 'none', sm: 'block' } }} />}
      {next ? <PagerCard t={next} dir="next" /> : <Box sx={{ flex: '1 1 0', display: { xs: 'none', sm: 'block' } }} />}
    </Box>
  );
}
