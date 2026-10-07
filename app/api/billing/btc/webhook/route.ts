import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/billing/btc/webhook/route";

export const POST = nextAdapter(handlers.POST);
