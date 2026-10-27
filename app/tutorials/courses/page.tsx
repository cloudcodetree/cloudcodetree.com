import type { Metadata } from 'next';
import TutorialsList from '../../components/TutorialsList';
import { siteTutorials as tutorials, allSeriesTotals } from '../manifest';

export const metadata: Metadata = {
  title: 'Tutorial Courses · CloudCodeTree',
  description: 'Hand-written, hands-on courses for software engineers getting into agentic AI development and AI engineering — each course rolled into one card.',
  alternates: {
    canonical: 'https://cloudcodetree.com/tutorials/courses/',
    types: { 'application/rss+xml': 'https://cloudcodetree.com/tutorials/feed.xml' },
  },
  openGraph: {
    title: 'Tutorial Courses · CloudCodeTree',
    description: 'Hands-on courses for agentic AI development and AI engineering.',
    url: 'https://cloudcodetree.com/tutorials/courses/',
    siteName: 'CloudCodeTree',
    type: 'website',
  },
};

export default function TutorialCoursesPage() {
  // Newest first (descending order), mirroring the AI News blog.
  const ordered = [...tutorials].sort((a, b) => b.order - a.order);
  return <TutorialsList tutorials={ordered} seriesTotals={allSeriesTotals()} />;
}
