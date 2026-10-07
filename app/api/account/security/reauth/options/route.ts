import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/security/reauth/options/route";

export const POST = nextAdapter(handlers.POST);
