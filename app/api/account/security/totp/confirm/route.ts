import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/security/totp/confirm/route";

export const POST = nextAdapter(handlers.POST);
