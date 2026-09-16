import type { Metadata } from 'next';
import ClientLayout from '../components/ClientLayout';
import SavedLibrary from '../components/SavedLibrary';
import { siteTutorials, allSeriesTotals } from '../tutorials/manifest';
import { blogListing } from '../lib/blogArchive';

// Per-reader, so never indexed and never linked from the sitemap. The exported
// HTML is the empty shell every reader shares; the saved set arrives after
// hydration from the reader's own JWT, so this file can never carry one
// reader's list to another.
export const metadata: Metadata = {
  title: 'Saved · CloudCodeTree',
  description: 'Blog posts and tutorials you saved to read later.',
  robots: { index: false, follow: false },
};

export default function SavedPage() {
  const { initial, archive } = blogListing();
  return (
    <ClientLayout>
      <SavedLibrary posts={initial} archive={archive} tutorials={siteTutorials} seriesTotals={allSeriesTotals()} />
    </ClientLayout>
  );
}
