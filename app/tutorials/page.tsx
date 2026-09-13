import type { Metadata } from 'next';
import TutorialsList from '../components/TutorialsList';
import { siteTutorials as tutorials } from './manifest';

export const metadata: Metadata = {
  title: 'Tutorials · CloudCodeTree',
  description: 'Hand-written, hands-on tutorials for software engineers getting into agentic AI development and AI engineering — RAG, embeddings, fine-tuning, and more.',
  alternates: {
    canonical: 'https://cloudcodetree.com/tutorials/',
    types: { 'application/rss+xml': 'https://cloudcodetree.com/tutorials/feed.xml' },
  },
  openGraph: {
    title: 'Tutorials · CloudCodeTree',
    description: 'Hands-on tutorials for agentic AI development and AI engineering.',
    url: 'https://cloudcodetree.com/tutorials/',
    siteName: 'CloudCodeTree',
    type: 'website',
  },
};

export default function TutorialsPage() {
  // Newest first (descending order), mirroring the AI News blog.
  const ordered = [...tutorials].sort((a, b) => b.order - a.order);
  return <TutorialsList tutorials={ordered} />;
}
