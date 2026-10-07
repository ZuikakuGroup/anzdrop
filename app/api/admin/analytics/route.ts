import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/analytics/route";

export const GET = nextAdapter(handlers.GET);
