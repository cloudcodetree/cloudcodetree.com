import ClientLayout from '../components/ClientLayout';

// Wraps the list page and every tutorial (.mdx) in the site chrome.
export default function TutorialsLayout({ children }: { children: React.ReactNode }) {
  const preview = process.env.NEXT_PUBLIC_CONTENT_PREVIEW === '1';
  return <ClientLayout>
    {preview && <div role="status" style={{ padding: '10px 16px', textAlign: 'center', background: '#ffb24d', color: '#1d1f20', fontFamily: 'monospace', fontWeight: 700 }}>
      BETA PREVIEW · Includes unfinished tutorials that are not published on cloudcodetree.com
    </div>}
    {children}
  </ClientLayout>;
}
