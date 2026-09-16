import { Container, Box, Button } from '@mui/material';
import Link from 'next/link';
import { SERIF, LINK } from '../../components/blogShared';
import TutorialPagerNav from '../../components/TutorialPagerNav';
import TutorialReaderControls from '../../components/TutorialReaderControls';
import { siteTutorials } from '../manifest';
import type { LessonRef } from '../lessonRef';

// Styles raw MDX elements (the author writes the H1, so unlike the blog we keep
// it). Mobile-safe: long URLs/code wrap or scroll instead of overflowing.
const tutorialSx = {
  lineHeight: 1.8,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  '& h1': { fontFamily: SERIF, fontSize: { xs: '1.9rem', md: '2.6rem' }, fontWeight: 600, lineHeight: 1.12, mb: 2 },
  '& h2': { fontFamily: SERIF, fontSize: { xs: '1.3rem', md: '1.6rem' }, fontWeight: 600, mt: 5, mb: 1.5 },
  '& h3': { fontSize: { xs: '1.1rem', md: '1.2rem' }, fontWeight: 600, mt: 3, mb: 1 },
  '& p': { mb: 2, lineHeight: 1.8 },
  '& strong': { color: '#ffffff', fontWeight: 700 },
  '& a': { color: LINK, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
  '& img': { maxWidth: '100%', height: 'auto', borderRadius: 1 },
  '& ul, & ol': { mb: 2, pl: 3 },
  '& li': { mb: 1, lineHeight: 1.8 },
  '& blockquote': { m: '28px 0', p: '16px 20px', backgroundColor: '#2b2b2d', border: '1px solid #222a35', borderLeft: `3px solid ${LINK}`, borderRadius: 2, color: 'text.secondary', '& p': { m: 0 } },
  '& hr': { border: 0, borderTop: '1px solid #222a35', my: 4 },
  '& pre': { backgroundColor: 'rgba(43,43,45,0.8)', borderRadius: 1, p: 2, maxWidth: '100%', overflowX: 'auto', mb: 2, fontSize: { xs: '0.78rem', md: '0.875rem' }, '& code': { whiteSpace: 'pre', overflowWrap: 'normal', wordBreak: 'normal', background: 'none', p: 0 } },
  '& code': { backgroundColor: 'rgba(43,43,45,0.6)', px: 0.75, py: 0.25, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.9em' },
  '& table': { display: 'block', maxWidth: '100%', overflowX: 'auto', borderCollapse: 'collapse', mb: 2, '& th, & td': { border: '1px solid #222a35', p: 1, textAlign: 'left' } },
} as const;

// Gated on the server, so held lessons never reach the browser. The children are
// client components (they read the pathname, which a layout has no param for under
// the static export), and this is the only tutorial data they receive.
const lessons: LessonRef[] = siteTutorials.map(({ slug, title, series, part }) => ({ slug, title, series, part }));

export default function TutorialArticleLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, md: 4 } }}>
      <Button component={Link} href="/tutorials/" sx={{ mb: 3 }}>← Back to Tutorials</Button>
      <TutorialReaderControls lessons={lessons} />
      <Box sx={tutorialSx}>{children}</Box>
      <TutorialPagerNav lessons={lessons} />
    </Container>
  );
}
