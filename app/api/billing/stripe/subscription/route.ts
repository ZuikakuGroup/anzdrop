import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/billing/stripe/subscription/route";

export const POST = nextAdapter(handlers.POST);
