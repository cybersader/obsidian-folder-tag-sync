// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeFlexoki from 'starlight-theme-flexoki';
import starlightSiteGraph from 'starlight-site-graph';
import starlightImageZoom from 'starlight-image-zoom';
import remarkObsidianCallout from 'remark-obsidian-callout';
import remarkWikiLink from 'remark-wiki-link';
import rehypeExternalLinks from 'rehype-external-links';

export default defineConfig({
  site: 'https://cybersader.github.io',
  base: '/obsidian-folder-tag-sync',
  vite: {
    define: {
      // starlight-site-graph's bundled deps (chroma-js, micromatch) reference
      // Node's `process` global. Without these shims, browsers throw
      // "process is not defined" and the graph component fails to initialize.
      'process.platform': '"browser"',
      'process.version': '"v0.0.0"',
      'process.env': '{}',
    },
    server: {
      // Vite 6+ blocks non-localhost Host headers by default. Opens it for
      // LAN / Tailscale / Docker / cross-device previews. Safe for local dev.
      allowedHosts: true,
      // WSL workaround: inotify doesn't fire reliably on /mnt/c/. Polling is
      // slower but reliable. Remove if the repo moves to Linux-native.
      watch: { usePolling: true, interval: 300 },
    },
  },
  markdown: {
    remarkPlugins: [
      remarkObsidianCallout,
      [remarkWikiLink, { aliasDivider: '|' }],
    ],
    rehypePlugins: [
      [rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }],
    ],
  },
  integrations: [
    starlight({
      title: 'Folder Tag Sync',
      description:
        'Bidirectional sync between folder paths and Obsidian tags using regex patterns and transformation pipelines.',
      favicon: '/favicon.svg',
      head: [
        // Favicons: modern browsers use SVG; older or specific-size contexts
        // (browser tab at 16px, Apple home screen, PWA icons) use the PNGs.
        { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: '/obsidian-folder-tag-sync/favicon.svg' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '16x16',  href: '/obsidian-folder-tag-sync/favicon-16.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32',  href: '/obsidian-folder-tag-sync/favicon-32.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '48x48',  href: '/obsidian-folder-tag-sync/favicon-48.png' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: '/obsidian-folder-tag-sync/apple-touch-icon.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/obsidian-folder-tag-sync/icon-192.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/obsidian-folder-tag-sync/icon-512.png' } },
      ],
      lastUpdated: true,
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        alt: 'Folder Tag Sync',
      },
      editLink: {
        baseUrl: 'https://github.com/cybersader/obsidian-folder-tag-sync/edit/main/docs/',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/cybersader/obsidian-folder-tag-sync' },
      ],
      plugins: [
        starlightThemeFlexoki(),
        starlightSiteGraph(),
        starlightImageZoom(),
      ],
      customCss: [
        './src/styles/brand.css',
      ],
      sidebar: [
        { label: 'Getting started', autogenerate: { directory: 'getting-started' } },
        { label: 'Concepts', autogenerate: { directory: 'concepts', collapsed: true } },
        { label: 'Guides', autogenerate: { directory: 'guides' } },
        { label: 'Features', autogenerate: { directory: 'features' } },
        { label: 'Reference', autogenerate: { directory: 'reference', collapsed: true } },
        { label: 'Development', autogenerate: { directory: 'development', collapsed: true } },
        { label: 'Agent context & exploration', autogenerate: { directory: 'agent-context', collapsed: true } },
        { label: 'About', autogenerate: { directory: 'about' } },
      ],
    }),
  ],
});
