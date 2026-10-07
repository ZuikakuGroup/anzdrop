import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/security/reauth/verify/route";

export const POST = nextAdapter(handlers.POST);
