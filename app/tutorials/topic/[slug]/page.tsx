import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import TutorialsList from '../../../components/TutorialsList';
import { siteTutorials, allSeriesTotals } from '../../manifest';
import { tutorialTopics } from '../../../../scripts/lib/tutorial-catalog.mjs';

const topics = tutorialTopics(siteTutorials);
export const dynamicParams = false;
export function generateStaticParams() { return topics.map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const topic = topics.find((t) => t.slug === slug);
  if (!topic) notFound();
  const url = `https://cloudcodetree.com/tutorials/topic/${slug}/`;
  const title = `${topic.tag} Tutorials · CloudCodeTree`;
  const description = `${topic.count} hands-on tutorials about ${topic.tag}, with working code and interactive examples.`;
  return {
    title, description,
    alternates: { canonical: url, types: { 'application/rss+xml': `${url}feed.xml` } },
    openGraph: { title, description, url, siteName: 'CloudCodeTree', type: 'website' },
  };
}

export default async function TutorialTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const topic = topics.find((t) => t.slug === slug);
  if (!topic) notFound();
  const tutorials = siteTutorials.filter((t) => t.tags.includes(topic.tag)).sort((a, b) => a.order - b.order);
  return <TutorialsList tutorials={tutorials} seriesTotals={allSeriesTotals()} variant="all" topic={topic} />;
}
