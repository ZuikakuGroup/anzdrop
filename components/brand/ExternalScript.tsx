"use client";
import { useEffect } from "react";

// Load once per document. Dynamically inserted scripts inherit the response nonce.
export default function ExternalScript({ src }: { src: string; strategy?: "afterInteractive" }) {
  useEffect(() => {
    if ([...document.scripts].some(script => script.src === src)) return;
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
    document.head.appendChild(script);
  }, [src]);
  return null;
}
