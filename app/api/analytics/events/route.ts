import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/analytics/events/route";

export const POST = nextAdapter(handlers.POST);
