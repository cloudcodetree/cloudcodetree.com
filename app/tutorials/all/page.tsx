import type { Metadata } from 'next';
import TutorialsList from '../../components/TutorialsList';
import { siteTutorials as tutorials, allSeriesTotals } from '../manifest';

export const metadata: Metadata = {
  title: 'All Tutorials · CloudCodeTree',
  description: 'Every released CloudCodeTree tutorial as an individual card — RAG, embeddings, fine-tuning, agents, and more.',
  alternates: {
    canonical: 'https://cloudcodetree.com/tutorials/all/',
    types: { 'application/rss+xml': 'https://cloudcodetree.com/tutorials/feed.xml' },
  },
  openGraph: {
    title: 'All Tutorials · CloudCodeTree',
    description: 'Every CloudCodeTree tutorial as an individual card.',
    url: 'https://cloudcodetree.com/tutorials/all/',
    siteName: 'CloudCodeTree',
    type: 'website',
  },
};

export default function AllTutorialsPage() {
  // Ascending (course order) so each course reads Part 1 -> last, not reversed.
  const ordered = [...tutorials].sort((a, b) => a.order - b.order);
  return <TutorialsList tutorials={ordered} seriesTotals={allSeriesTotals()} variant="all" />;
}
