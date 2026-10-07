import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/billing/stripe/sync/route";

export const POST = nextAdapter(handlers.POST);
