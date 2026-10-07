import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/report/route";

export const POST = nextAdapter(handlers.POST);
