/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  distDir: 'out',
  // Let .mdx files under app/ be pages (hand-authored tutorials).
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'mdx'],
  images: {
    unoptimized: true
  },
  // Same-origin assets make the exact production export portable to local previews.
  // Canonical/OG URLs remain absolute in route metadata.
  assetPrefix: process.env.SITE_ORIGIN ?? '',
  basePath: '',
  reactStrictMode: true,
  // Always defined, so every `=== '1'` check on it folds at build time. Left
  // undefined, Next ships the check to the browser with both branches, and a
  // production bundle would carry beta-only values such as the Turnstile test key.
  env: {
    NEXT_PUBLIC_CONTENT_PREVIEW: process.env.NEXT_PUBLIC_CONTENT_PREVIEW === '1' ? '1' : '0',
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  experimental: {
    optimizePackageImports: ['@mui/material', '@mui/icons-material'],
  },
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      // Never watch the symlinked multi-repo workspace (or the ex-submodule
      // path) — thousands of foreign files would swamp the dev watcher.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ['**/node_modules/**', '**/projects/**', '**/companions/**'],
      };
    }
    if (dev && !isServer) {
      // Optimize development builds
      config.optimization.splitChunks = false;
      config.cache = {
        type: 'filesystem',
        buildDependencies: {
          config: [__filename],
        },
      };
    }
    return config;
  },
}

const createMDX = require('@next/mdx').default ?? require('@next/mdx');
// NB: Syntax highlighting is done via a Shiki server component (app/components/mdx/
// CodeBlock.tsx, wired as the `pre` override in mdx-components.tsx), NOT a rehype
// plugin — Turbopack (dev --turbo) can't serialize MDX plugin options. The component
// highlights at build time, so it stays static-export-safe with zero runtime JS.
const withMDX = createMDX({
  extension: /\.mdx?$/,
  // GFM so markdown tables/strikethrough/task-lists render (string form for
  // Turbopack serialization). rehype-slug gives every heading a GitHub-style
  // id so the in-page tables of contents in the tutorials actually resolve.
  // Syntax highlighting stays a component (see above).
  options: { remarkPlugins: [['remark-gfm']], rehypePlugins: [['rehype-slug']] },
});

module.exports = withMDX(nextConfig);
