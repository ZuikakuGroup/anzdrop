import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/shares/[shareId]/route";

export const GET = nextAdapter(handlers.GET);
export const DELETE = nextAdapter(handlers.DELETE);
