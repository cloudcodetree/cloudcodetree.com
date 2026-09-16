'use client';

import { useState, useEffect, useMemo } from 'react';
import { Container, Typography, Box, Button, Alert, TextField, Pagination, ToggleButtonGroup, ToggleButton, Grid, Chip, Select, MenuItem } from '@mui/material';
import { GridView, ViewList, VisibilityOff, Bookmark, RssFeed } from '@mui/icons-material';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { SERIF, MONO, ACCENT, LINK, formatLongDate } from './blogShared';
import type { Tutorial } from '../tutorials/manifest';
import SeriesCarouselCard from './SeriesCarouselCard';
import { Corners } from './Blueprint';
import CourseHomeCard from './CourseHomeCard';
import TopicsFlyout from './TopicsFlyout';
import ReaderStateNotice from './ReaderStateNotice';
import { ReadChip, SaveChip } from './ReaderChips';
import { useReaderLibrary } from '../lib/useReaderLibrary';
import { applyReaderState, selectVisiblePosts } from '../lib/readerState';
import { filterTutorials, tutorialReaderId, tutorialTopics } from '../../scripts/lib/tutorial-catalog.mjs';

type View = 'cards' | 'list';
const VIEWS: View[] = ['cards', 'list'];
const PAGE_DEFAULT: Record<View, number> = { cards: 20, list: 40 };
const PAGE_OPTIONS = [5, 10, 20, 40, 50];
const border = '1px solid rgba(148,163,184,0.12)';
const clamp = (n: number) => ({ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: n, overflow: 'hidden' } as const);
const topicTags = (t: Tutorial) => t.tags.filter((x) => x.toLowerCase() !== 'ai' && x.toLowerCase() !== 'tutorial');

interface Props {
  tutorials: Tutorial[];
  /** Canonical "of N" per series, computed on the server — see allSeriesTotals(). */
  seriesTotals: Record<string, number>;
  variant?: 'series' | 'all';
  topic?: { tag: string; slug: string };
  onlySaved?: boolean;
}

export default function TutorialsList({ tutorials, seriesTotals, variant = 'series', topic, onlySaved = false }: Props) {
  const reader = useReaderLibrary();
  const [view, setView] = useState<View>('cards');
  const [sizes, setSizes] = useState<Partial<Record<View, number>>>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [hideRead, setHideRead] = useState(false);
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tags = new Set(tutorialTopics(tutorials).map((t) => t.tag));
    setSelected((params.get('topics') || '').split(',').filter((tag) => tags.has(tag)));
    setQuery(params.get('q') || '');
    setSeriesFilter(variant === 'all' ? params.get('series') : null);
    const number = Number(params.get('page'));
    setPage(Number.isSafeInteger(number) && number > 0 ? number : 1);
    setOrigin(window.location.origin);
    try {
      const preferred = localStorage.getItem('tut-view') as View;
      if (VIEWS.includes(preferred)) setView(preferred);
      const savedSizes = JSON.parse(localStorage.getItem('tut-pagesize') || '{}');
      setSizes(Object.fromEntries(Object.entries(savedSizes).filter(([v, n]) => VIEWS.includes(v as View) && PAGE_OPTIONS.includes(n as number))));
      setHideRead(localStorage.getItem('tut-hide-read') === '1');
    } catch { /* Restricted storage still allows browsing. */ }
    setHydrated(true);
  }, [tutorials, variant]);

  const base = useMemo(() => tutorials.filter((t) => !t.draft && (!seriesFilter || t.series === seriesFilter)), [tutorials, seriesFilter]);
  const topics = useMemo(() => tutorialTopics(base), [base]);
  const annotated = useMemo(() => applyReaderState(base.map((t) => ({ ...t, id: tutorialReaderId(t.slug) })), reader.state), [base, reader.state]);
  const filtered = useMemo(() => selectVisiblePosts(filterTutorials(annotated, { topics: selected, query }), {
    onlySaved, hideRead: hideRead && reader.signedIn,
  }), [annotated, selected, query, onlySaved, hideRead, reader.signedIn]);

  // Group the (filtered) tutorials by series, parts ascending, series ordered by
  // their newest part — for the rolled-up carousel view.
  const seriesGroups = useMemo(() => {
    const m = new Map<string, Tutorial[]>();
    for (const t of filtered) {
      const arr = m.get(t.series);
      if (arr) arr.push(t); else m.set(t.series, [t]);
    }
    return Array.from(m.entries())
      .map(([series, parts]) => ({ series, parts: [...parts].sort((a, b) => a.part - b.part) }))
      .sort((a, b) => Math.max(...b.parts.map((p) => p.order)) - Math.max(...a.parts.map((p) => p.order)));
  }, [filtered]);

  const pageSize = sizes[view] ?? PAGE_DEFAULT[view];
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const shown = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (!hydrated) return;
    // Wait for private state before clamping a saved/hide-read URL's page.
    if ((onlySaved || (hideRead && reader.signedIn)) && reader.status === 'loading') return;
    if (page !== safePage) setPage(safePage);
    const params = new URLSearchParams(window.location.search);
    if (selected.length) params.set('topics', selected.join(',')); else params.delete('topics');
    if (query.trim()) params.set('q', query.trim()); else params.delete('q');
    if (safePage > 1) params.set('page', String(safePage)); else params.delete('page');
    if (seriesFilter) params.set('series', seriesFilter); else params.delete('series');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [hydrated, selected, query, page, safePage, seriesFilter, onlySaved, hideRead, reader.signedIn, reader.status]);

  const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };
  const chooseView = (v: View | null) => { if (v) { setView(v); setPage(1); remember('tut-view', v); } };
  const toggle = (tag: string) => { setSelected((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]); setPage(1); };
  const selectedSlugs = topics.filter((t) => selected.includes(t.tag)).map((t) => t.slug).sort();
  const feedPath = selectedSlugs.length === 1 ? `/tutorials/topic/${selectedSlugs[0]}/feed.xml`
    : selectedSlugs.length > 1 ? `/tutorials/feed.xml?topics=${selectedSlugs.join(',')}`
    : topic ? `/tutorials/topic/${topic.slug}/feed.xml` : '/tutorials/feed.xml';
  const readerControls = (t: Tutorial) => {
    if (!reader.signedIn) return null;
    const id = tutorialReaderId(t.slug);
    const row = reader.state.get(id);
    return <>
      {row?.read_at && <ReadChip />}
      <SaveChip post={{ title: t.title, isSaved: !!row?.saved }} onToggle={() => reader.toggleSaved(id)} busy={reader.status !== 'ready' || !!reader.pending[id]} />
    </>;
  };

  const meta = (t: Tutorial) => `${formatLongDate(t.date)} · ${t.readTime} min`;
  const Pills = ({ t }: { t: Tutorial }) => (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      {topicTags(t).slice(0, 3).map((tag) => (
        <Chip key={tag} label={tag} size="small" sx={{ height: 22, fontFamily: MONO, fontSize: 10, background: 'rgba(255,178,77,0.08)', color: '#ffb24d', border: '1px solid rgba(255,178,77,0.3)' }} />
      ))}
      {readerControls(t)}
    </Box>
  );

  // The flagship (largest) course gets the explainer "home" card up top, and is
  // its ONLY card — no duplicate carousel. When a topic filter hides the home
  // card, the flagship falls back to a carousel like the rest.
  const flagship = seriesGroups.find((g) => g.parts.length > 10) ?? null;
  const showHome = !!flagship && selected.length === 0 && !query && !(hideRead && reader.signedIn);
  const carouselGroups = showHome ? seriesGroups.filter((g) => g.series !== flagship!.series) : seriesGroups;

  // The newest tutorial or course (highest order) is featured full-width; the
  // rest are 2-up. seriesGroups is sorted newest-first, so [0] is the latest.
  // Any new tutorial/course you add automatically takes the full-width hero.
  const newestName = seriesGroups[0]?.series;

  const seriesCards = (
    <Grid container spacing={3}>
      {carouselGroups.map(({ series, parts }) => {
        const feat = series === newestName;
        return (
          <Grid size={{ xs: 12, sm: feat ? 12 : 6 }} key={series}>
            <Box component={motion.div} initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} sx={{ height: '100%' }}>
              <SeriesCarouselCard series={series} parts={parts} total={seriesTotals[series]} featured={feat} readerControls={readerControls} />
            </Box>
          </Grid>
        );
      })}
    </Grid>
  );

  const cards = (
    <Grid container spacing={3}>
      {shown.map((t, i) => (
        <Grid size={{ xs: 12, sm: 6 }} key={t.slug}>
          <Box component={motion.div} initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: Math.min(i * 0.04, 0.4) }}
            sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 0, border, position: 'relative', background: 'transparent', transition: 'border-color .2s, transform .2s', '&:hover': { borderColor: 'rgba(148,188,227,0.55)', transform: 'translateY(-2px)' } }}>
            <Corners />
            {t.image && (
              <Box component={Link} prefetch={false} href={`/tutorials/${t.slug}/`} sx={{ display: 'block' }}>
                <Box component="img" src={t.image} alt={t.title} loading="lazy" sx={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block' }} />
              </Box>
            )}
            <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.25, flexGrow: 1 }}>
              <Typography sx={{ fontFamily: MONO, fontSize: 11, color: ACCENT, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{`${t.series} · Part ${t.part}/${seriesTotals[t.series]}`}</Typography>
              <Typography component={Link} prefetch={false} href={`/tutorials/${t.slug}/`} sx={{ fontFamily: SERIF, fontWeight: 600, fontSize: '1.3rem', lineHeight: 1.2, color: 'text.primary', textDecoration: 'none', ...clamp(3), '&:hover': { color: LINK } }}>{t.title}</Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: '0.92rem', lineHeight: 1.5, ...clamp(3) }}>{t.excerpt}</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>{meta(t)}</Typography>
              <Box sx={{ mt: 'auto', pt: 0.5 }}><Pills t={t} /></Box>
            </Box>
          </Box>
        </Grid>
      ))}
    </Grid>
  );

  const list = (
    <Box>
      {shown.map((t, i) => (
        <Box key={t.slug} component={motion.div} initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: Math.min(i * 0.025, 0.25) }}
          sx={{ display: 'flex', gap: 2.5, py: 3, borderTop: border, alignItems: 'flex-start' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 13, color: ACCENT, pt: 0.5, flexShrink: 0 }}>{String(t.order).padStart(2, '0')}</Typography>
          <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography sx={{ fontFamily: MONO, fontSize: 10, color: ACCENT, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{`${t.series} · Part ${t.part}/${seriesTotals[t.series]}`}</Typography>
            <Typography component={Link} prefetch={false} href={`/tutorials/${t.slug}/`} sx={{ fontFamily: SERIF, fontWeight: 600, fontSize: { xs: '1.25rem', md: '1.5rem' }, lineHeight: 1.15, color: 'text.primary', textDecoration: 'none', ...clamp(2), '&:hover': { color: LINK } }}>{t.title}</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.95rem', lineHeight: 1.5, ...clamp(2) }}>{t.excerpt}</Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>{meta(t)}</Typography>
            <Pills t={t} />
          </Box>
        </Box>
      ))}
      <Box sx={{ borderTop: border }} />
    </Box>
  );

  const isSeries = variant === 'series';

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 9 } }}>
      {reader.status === 'error' && <ReaderStateNotice onRetry={reader.retry} />}
      {reader.writeError && <Alert severity="warning" sx={{ mb: 2 }}>Your change could not be saved. Please try the Save button again.</Alert>}
      <Box component={motion.div} initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} sx={{ mb: { xs: 4, md: 6 } }}>
        <Typography sx={{ fontFamily: MONO, color: ACCENT, fontSize: 12, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', mb: 1.5 }}>CloudCodeTree&nbsp;·&nbsp;Learn</Typography>
        <Typography component="h1" sx={{ fontFamily: SERIF, fontWeight: 600, fontSize: { xs: '3rem', md: '4.75rem' }, lineHeight: 0.95, letterSpacing: '-0.02em', m: 0, background: 'linear-gradient(180deg,#fff 0%,#cbd5e1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{onlySaved ? 'Saved tutorials' : topic ? `${topic.tag} tutorials` : isSeries ? 'Tutorials' : (seriesFilter ?? 'All tutorials')}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mt: 2.5, flexWrap: 'wrap' }}>
          <Box sx={{ height: 2, width: 56, background: ACCENT, alignSelf: 'center' }} />
          <Typography sx={{ color: 'text.secondary', fontSize: { xs: '1rem', md: '1.12rem' }, maxWidth: 600 }}>
            {onlySaved ? `${filtered.length} tutorial${filtered.length === 1 ? '' : 's'} saved for later.`
              : topic ? `${tutorials.length} hands-on tutorial${tutorials.length === 1 ? '' : 's'} tagged ${topic.tag}.`
              : isSeries
              ? 'Hands-on, hand-written courses — each series rolled into one card you can flip through, part by part.'
              : seriesFilter ? `All ${filtered.length} parts of this course, in order. ` : 'Every tutorial as an individual card. '}
            {!isSeries && <Typography component={Link} prefetch={false} href={seriesFilter ? '/tutorials/all/' : '/tutorials/'} sx={{ color: ACCENT, textDecoration: 'none', fontFamily: MONO, fontSize: 14, '&:hover': { color: LINK } }}>{seriesFilter ? '← All tutorials' : '← Back to series'}</Typography>}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: { xs: 2, md: 3 }, flexWrap: 'wrap' }}>
        {isSeries ? (
          <Typography component={Link} prefetch={false} href="/tutorials/all/" sx={{ fontFamily: MONO, fontSize: 13, color: ACCENT, textDecoration: 'none', border: '1px solid rgba(148,188,227,0.3)', borderRadius: 1, px: 1.5, py: 0.75, '&:hover': { background: 'rgba(148,188,227,0.1)', color: LINK } }}>
            {`See all ${tutorials.length} tutorials →`}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>Per page</Typography>
            <Select value={pageSize} inputProps={{ 'aria-label': 'Tutorials per page' }} onChange={(e) => { const next = { ...sizes, [view]: Number(e.target.value) }; setSizes(next); remember('tut-pagesize', JSON.stringify(next)); setPage(1); }} size="small" sx={{ fontFamily: MONO, fontSize: 12, color: 'text.secondary', '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148,163,184,0.2)' }, '.MuiSvgIcon-root': { color: 'text.secondary' } }}>
              {PAGE_OPTIONS.map((n) => <MenuItem key={n} value={n} sx={{ fontFamily: MONO, fontSize: 12 }}>{n}</MenuItem>)}
            </Select>
          </Box>
        )}
        {!isSeries && (
          <ToggleButtonGroup value={view} exclusive size="small" onChange={(_, v) => chooseView(v)} aria-label="Choose layout" sx={{ '& .MuiToggleButton-root': { color: 'text.secondary', borderColor: 'rgba(148,163,184,0.2)', px: 1.25 }, '& .Mui-selected': { color: `${ACCENT} !important`, background: 'rgba(148,188,227,0.12) !important' } }}>
            <ToggleButton value="cards" aria-label="Cards"><GridView fontSize="small" /></ToggleButton>
            <ToggleButton value="list" aria-label="Compact list"><ViewList fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 4 }}>
        <TextField type="search" size="small" value={query} placeholder="Search tutorials" inputProps={{ 'aria-label': 'Search tutorials' }}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }} sx={{ width: { xs: '100%', sm: 320 } }} />
        <TopicsFlyout topics={topics} selected={selected} onToggle={toggle} onClear={() => { setSelected([]); setPage(1); }}
          topicBasePath="/tutorials/topic" feedUrlForSelection={`${origin}${feedPath}`} />
        <Button component="a" href={feedPath} startIcon={<RssFeed />} size="small" sx={{ color: ACCENT, textTransform: 'none' }}>RSS</Button>
        {reader.signedIn && !onlySaved && <>
          <Button size="small" startIcon={<VisibilityOff />} aria-pressed={hideRead} onClick={() => {
            setHideRead(!hideRead); setPage(1); remember('tut-hide-read', hideRead ? '0' : '1');
          }} sx={{ color: hideRead ? ACCENT : 'text.secondary', textTransform: 'none' }}>Hide read</Button>
          <Button component={Link} prefetch={false} href="/saved/?section=tutorials" size="small" startIcon={<Bookmark />} sx={{ textTransform: 'none' }}>Saved tutorials</Button>
        </>}
      </Box>
      {onlySaved && reader.status === 'signedOut' ? <Box sx={{ py: 6 }}>
        <Typography sx={{ mb: 2 }}>Sign in to save tutorials and find them here.</Typography>
        <Button component="a" href="/saved/?section=tutorials&signin=1" variant="outlined">Sign in</Button>
      </Box> : onlySaved && reader.status === 'loading' ? <Typography role="status">Loading your saved tutorials…</Typography>
      : onlySaved && reader.status === 'error' ? null
      : filtered.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 10 }}><Typography sx={{ fontFamily: MONO, color: 'text.secondary', fontSize: 14 }}>
          {onlySaved && !selected.length && !query ? 'No saved tutorials yet — use Save on a lesson to keep it here.'
            : hideRead && reader.signedIn ? 'No unread tutorials match. Turn off Hide read or clear your filters.'
            : selected.length || query ? 'No tutorials match. Try another search or clear your topics.' : 'No tutorials yet.'}
        </Typography></Box>
      ) : isSeries ? (
        <>
          {showHome && <CourseHomeCard parts={flagship!.parts} allHref={`/tutorials/all/?series=${encodeURIComponent(flagship!.series)}`} />}
          {seriesCards}
        </>
      ) : (
        <>
          {view === 'cards' ? cards : list}
          {pageCount > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
              <Pagination count={pageCount} page={safePage} onChange={(_, v) => { setPage(v); window.scrollTo({ top: 0, behavior: 'smooth' }); }} shape="rounded" sx={{ '& .MuiPaginationItem-root': { fontFamily: MONO, color: 'text.secondary', borderColor: 'rgba(148,163,184,0.2)' }, '& .Mui-selected': { background: `${ACCENT} !important`, color: '#1d1f20', borderColor: ACCENT } }} />
            </Box>
          )}
        </>
      )}
    </Container>
  );
}
