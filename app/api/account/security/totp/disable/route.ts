import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/security/totp/disable/route";

export const POST = nextAdapter(handlers.POST);
