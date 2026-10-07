"use client";

// Astro islands navigate with full documents, preserving the same-origin cookies.
const navigation = {
  replace(path: string) { window.location.replace(path); },
};
export function useRouter() { return navigation; }
