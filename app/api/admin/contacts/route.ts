import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/contacts/route";

export const GET = nextAdapter(handlers.GET);
