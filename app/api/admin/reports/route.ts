import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/reports/route";

export const GET = nextAdapter(handlers.GET);
