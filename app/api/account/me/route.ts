import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/me/route";

export const GET = nextAdapter(handlers.GET);
