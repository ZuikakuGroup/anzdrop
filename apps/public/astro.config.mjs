import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  site: 'https://anzdrop.com',
  output: 'server',
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [react()],
  publicDir: '../../public',
  build: { assets: '_public-astro' },
  vite: {
    plugins: [tailwind()],
    resolve: { alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) } },
  },
});
