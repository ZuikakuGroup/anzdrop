import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/security/cancel/route";

export const POST = nextAdapter(handlers.POST);
