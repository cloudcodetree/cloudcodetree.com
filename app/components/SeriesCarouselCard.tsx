'use client';

import { useCallback, useState } from 'react';
import { Box, Typography, IconButton, Chip } from '@mui/material';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { SERIF, MONO, ACCENT, LINK, formatLongDate } from './blogShared';
import type { Tutorial } from '../tutorials/manifest';

const border = '1px solid rgba(148,163,184,0.12)';
const clamp = (n: number) =>
  ({ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: n, overflow: 'hidden' } as const);
const topicTags = (t: Tutorial) => t.tags.filter((x) => x.toLowerCase() !== 'ai' && x.toLowerCase() !== 'tutorial');

const slide = {
  enter: (d: number) => ({ x: d >= 0 ? 48 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d >= 0 ? -48 : 48, opacity: 0 }),
};

/**
 * Rolls a whole tutorial series up into ONE card that carousels through its
 * parts — cover + "Part N of M" + title/excerpt per slide, driven by arrows,
 * a progress bar, drag/swipe, and arrow keys. Each slide links to its part.
 * Degrades to a plain card for a single-part series.
 */
export default function SeriesCarouselCard({ series, parts, total, featured = false, readerControls }: { series: string; parts: Tutorial[]; total: number; featured?: boolean; readerControls?: (tutorial: Tutorial) => React.ReactNode }) {
  const [[i, dir], setState] = useState<[number, number]>([0, 0]);
  const n = parts.length;
  const idx = ((i % n) + n) % n;
  const t = parts[idx];
  const go = useCallback((d: number) => setState(([cur]) => [cur + d, d]), []);
  const multi = n > 1;

  return (
    <Box
      tabIndex={multi ? 0 : -1}
      onKeyDown={(e) => {
        if (!multi) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      }}
      sx={{
        height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 2, border, overflow: 'hidden',
        background: 'rgba(148,163,184,0.03)', outline: 'none', transition: 'border-color .2s, transform .2s',
        '&:hover': { borderColor: 'rgba(148,188,227,0.4)' }, '&:focus-visible': { borderColor: ACCENT },
      }}
    >
      {/* Cover viewport */}
      <Box sx={{ position: 'relative', width: '100%', aspectRatio: featured ? '21 / 9' : '16 / 9', overflow: 'hidden', background: 'rgba(13,17,23,0.5)' }}>
        <AnimatePresence custom={dir} initial={false} mode="popLayout">
          <Box
            key={t.slug}
            component={motion.div}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            drag={multi ? 'x' : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={(_e, info) => { if (info.offset.x < -56) go(1); else if (info.offset.x > 56) go(-1); }}
            sx={{ position: 'absolute', inset: 0, cursor: multi ? 'grab' : 'default', '&:active': { cursor: multi ? 'grabbing' : 'default' } }}
          >
            <Box component={Link} prefetch={false} href={`/tutorials/${t.slug}/`} draggable={false} sx={{ display: 'block', width: '100%', height: '100%' }}>
              {t.image ? (
                <Box component="img" src={t.image} alt={t.title} draggable={false} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <Box sx={{ width: '100%', height: '100%' }} />
              )}
            </Box>
          </Box>
        </AnimatePresence>

        {/* Part badge */}
        <Box sx={{ position: 'absolute', top: 12, left: 12, px: 1, py: 0.4, borderRadius: 1, background: 'rgba(13,17,23,0.72)', backdropFilter: 'blur(4px)', border: '1px solid rgba(148,163,184,0.2)' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: ACCENT, letterSpacing: '0.04em' }}>{`Part ${t.part} / ${total}`}</Typography>
        </Box>

        {multi && (
          <>
            <IconButton aria-label="Previous part" onClick={() => go(-1)} size="small"
              sx={{ position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)', color: '#e5e7eb', background: 'rgba(13,17,23,0.6)', border: '1px solid rgba(148,163,184,0.2)', '&:hover': { background: 'rgba(13,17,23,0.85)', color: ACCENT } }}>
              <ChevronLeft />
            </IconButton>
            <IconButton aria-label="Next part" onClick={() => go(1)} size="small"
              sx={{ position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)', color: '#e5e7eb', background: 'rgba(13,17,23,0.6)', border: '1px solid rgba(148,163,184,0.2)', '&:hover': { background: 'rgba(13,17,23,0.85)', color: ACCENT } }}>
              <ChevronRight />
            </IconButton>
          </>
        )}
      </Box>

      {/* Body */}
      <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.1, flexGrow: 1 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: 11, color: ACCENT, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {`${series} · ${total} parts`}
        </Typography>
        <Typography component={Link} prefetch={false} href={`/tutorials/${t.slug}/`}
          sx={{ fontFamily: SERIF, fontWeight: 600, fontSize: featured ? { xs: '1.5rem', md: '1.9rem' } : '1.3rem', lineHeight: 1.15, color: 'text.primary', textDecoration: 'none', ...clamp(2), '&:hover': { color: LINK } }}>
          {t.title}
        </Typography>
        <Typography sx={{ color: 'text.secondary', fontSize: '0.92rem', lineHeight: 1.5, ...clamp(2) }}>{t.excerpt}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>{`${formatLongDate(t.date)} · ${t.readTime} min`}</Typography>

        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.25 }}>
          {topicTags(t).slice(0, 3).map((tag) => (
            <Chip key={tag} label={tag} size="small" sx={{ height: 22, fontFamily: MONO, fontSize: 10, background: 'rgba(148,188,227,0.1)', color: ACCENT, border: '1px solid rgba(148,188,227,0.25)' }} />
          ))}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.75 }}>{readerControls?.(t)}</Box>

        {multi && (
          <Box sx={{ mt: 'auto', pt: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {/* progress track */}
            <Box sx={{ position: 'relative', height: 4, borderRadius: 2, background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
              <Box component={motion.div} animate={{ width: `${((idx + 1) / n) * 100}%` }} transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
                sx={{ position: 'absolute', inset: 0, right: 'auto', background: ACCENT, borderRadius: 2 }} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>{`${idx + 1} / ${n}`}</Typography>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography component={Link} prefetch={false} href={`/tutorials/${parts[0].slug}/`} sx={{ fontFamily: MONO, fontSize: 11, color: ACCENT, textDecoration: 'none', '&:hover': { color: LINK } }}>
                  Start →
                </Typography>
                <Typography component={Link} prefetch={false} href={`/tutorials/all/?series=${encodeURIComponent(series)}`} sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary', textDecoration: 'none', '&:hover': { color: ACCENT } }}>
                  {`Browse all ${total} parts →`}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
