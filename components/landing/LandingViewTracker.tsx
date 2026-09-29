"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";

export default function LandingViewTracker() {
  useEffect(() => {
    track("landing_view");
  }, []);

  return null;
}
