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
    // Only these two public build-time values may enter browser bundles.
    define: {
      'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY': JSON.stringify(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''),
      'process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY': JSON.stringify(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''),
    },
    server: { proxy: { '/api': 'http://127.0.0.1:8788' } },
    resolve: { alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) } },
  },
});
