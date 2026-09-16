import { Box, Typography } from '@mui/material';
import Link from 'next/link';
import { tutorials, seriesParts, seriesTotal, SERIES_INFO } from '../../tutorials/manifest';
import { MONO, ACCENT, LINK } from '../blogShared';

/**
 * Article header for a tutorial: the cover image, a "Series · Part N of M"
 * eyebrow, and a course panel — a one-line summary of the series plus a
 * clickable table of contents with the current part marked "you are here".
 * The .mdx still writes its own H1 below this.
 * Usage in .mdx:  <TutorialHero slug="vector-database-for-rag" />
 *
 * Server component on purpose: it needs no client hooks, so the manifest lookup
 * stays on the server and unreleased lessons never enter the client bundle.
 */
export default function TutorialHero({ slug }: { slug: string }) {
  const t = tutorials.find((x) => x.slug === slug);
  if (!t) return null;
  const total = seriesTotal(t.series);
  const parts = seriesParts(t.series);
  const blurb = SERIES_INFO[t.series]?.blurb;

  return (
    <Box sx={{ mb: 3 }}>
      {t.image && (
        <Box
          component="img"
          src={t.image}
          alt={`${t.series}: ${t.title}`}
          sx={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 2, mb: 2.5, border: '1px solid rgba(148,163,184,0.12)' }}
        />
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: 12, color: ACCENT, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {t.series} · Part {t.part} of {total}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {parts.map((p) => {
            const here = p.slug === t.slug;
            return (
              <Box
                key={p.slug}
                component={Link}
                href={`/tutorials/${p.slug}/`}
                aria-label={`Part ${p.part}: ${p.title}`}
                aria-current={here ? 'page' : undefined}
                title={`Part ${p.part}: ${p.title}`}
                sx={{
                  width: here ? 11 : 9,
                  height: here ? 11 : 9,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: here ? ACCENT : 'transparent',
                  border: here ? 'none' : '1.5px solid #3a4452',
                  transition: 'border-color .15s, transform .15s',
                  '&:hover': { borderColor: ACCENT, transform: 'scale(1.2)' },
                }}
              />
            );
          })}
        </Box>
      </Box>

      <Box sx={{ mt: 1.5, p: { xs: 2, md: 2.5 }, borderRadius: 2, border: '1px solid rgba(148,163,184,0.14)', background: 'rgba(148,163,184,0.04)' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: 10.5, color: ACCENT, letterSpacing: '0.14em', textTransform: 'uppercase', mb: 0.75 }}>
          The {t.series} course · {total} parts
        </Typography>
        {blurb && (
          <Typography sx={{ color: 'text.secondary', fontSize: '0.92rem', lineHeight: 1.55, mb: 1.5 }}>{blurb}</Typography>
        )}
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, columnGap: { xs: 0, sm: 4 }, columnCount: { xs: 1, sm: 2, md: total > 16 ? 3 : 2 } }}>
          {parts.map((p) => {
            const here = p.slug === t.slug;
            return (
              <Box
                component="li"
                key={p.slug}
                sx={{ breakInside: 'avoid', display: 'flex', alignItems: 'baseline', gap: 1.25, py: 0.5, borderLeft: '2px solid', borderColor: here ? ACCENT : 'transparent', pl: 1.25 }}
              >
                <Box component="span" sx={{ fontFamily: MONO, fontSize: 12, color: here ? ACCENT : 'text.secondary', flexShrink: 0, width: 18 }}>
                  {String(p.part).padStart(2, '0')}
                </Box>
                {here ? (
                  <Typography component="span" sx={{ fontSize: '0.95rem', fontWeight: 700, color: 'text.primary' }}>
                    {p.title}
                    <Box component="span" sx={{ fontFamily: MONO, fontSize: 11, color: ACCENT, ml: 1, fontWeight: 400 }}>← you are here</Box>
                  </Typography>
                ) : (
                  <Typography component={Link} href={`/tutorials/${p.slug}/`} sx={{ fontSize: '0.95rem', color: LINK, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                    {p.title}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
