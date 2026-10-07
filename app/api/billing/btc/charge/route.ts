import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/billing/btc/charge/route";

export const POST = nextAdapter(handlers.POST);
