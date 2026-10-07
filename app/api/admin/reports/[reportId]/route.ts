import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/reports/[reportId]/route";

export const DELETE = nextAdapter(handlers.DELETE);
