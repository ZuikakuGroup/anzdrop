import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/shares/[shareId]/suspend/route";

export const POST = nextAdapter(handlers.POST);
