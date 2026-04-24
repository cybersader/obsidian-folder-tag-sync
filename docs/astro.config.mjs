import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import nova from 'starlight-theme-nova';
import starlightSiteGraph from 'starlight-site-graph';
import starlightImageZoom from 'starlight-image-zoom';
import starlightHeadingBadges from 'starlight-heading-badges';
import remarkObsidianCallout from 'remark-obsidian-callout';
import remarkWikiLink from 'remark-wiki-link';
import rehypeExternalLinks from 'rehype-external-links';

export default defineConfig({
  site: 'https://cybersader.github.io',
  base: '/obsidian-folder-tag-sync',
  vite: {
    plugins: [tailwindcss()],
    define: {
      'process.platform': '"browser"',
      'process.version': '"v0.0.0"',
      'process.env': '{}',
    },
    server: {
      allowedHosts: true,
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
      description: 'Bidirectional sync between folder paths and Obsidian tags using regex patterns and transformation pipelines.',
      favicon: '/favicon.svg',
      lastUpdated: true,
      editLink: {
        baseUrl: 'https://github.com/cybersader/obsidian-folder-tag-sync/edit/main/docs/',
      },
      plugins: [
        nova({
          nav: [
            { label: 'Docs', href: '/obsidian-folder-tag-sync/getting-started/installation/' },
            { label: 'GitHub', href: 'https://github.com/cybersader/obsidian-folder-tag-sync' },
          ],
        }),
        starlightSiteGraph(),
        starlightImageZoom(),
        starlightHeadingBadges(),
      ],
      customCss: [
        './src/styles/global.css',
        './src/styles/brand.css',
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/cybersader/obsidian-folder-tag-sync' },
      ],
      sidebar: [
        { label: 'Getting started', autogenerate: { directory: 'getting-started' } },
        { label: 'Concepts', autogenerate: { directory: 'concepts', collapsed: true } },
        { label: 'Features', autogenerate: { directory: 'features' } },
        { label: 'Reference', autogenerate: { directory: 'reference', collapsed: true } },
        { label: 'Development', autogenerate: { directory: 'development', collapsed: true } },
        { label: 'Agent context & exploration', autogenerate: { directory: 'agent-context', collapsed: true } },
        { label: 'About', autogenerate: { directory: 'about' } },
      ],
    }),
  ],
});
