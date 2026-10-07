import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/reports/[reportId]/resolve/route";

export const POST = nextAdapter(handlers.POST);
