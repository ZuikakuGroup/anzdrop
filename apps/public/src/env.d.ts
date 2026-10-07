/// <reference types="astro/client" />
declare namespace App {
  interface Locals { nonce: string; }
}
declare namespace Cloudflare {
  interface Env {
    DEPLOYMENT_ENV?: string;
    BLOG_USE_SEED_DATA?: string;
    WEB_AUDIT?: string;
    MICROCMS_SERVICE_DOMAIN?: string;
    MICROCMS_API_KEY?: string;
  }
}
