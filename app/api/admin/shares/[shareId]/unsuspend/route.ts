import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/shares/[shareId]/unsuspend/route";

export const POST = nextAdapter(handlers.POST);
