import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/security/totp/setup/route";

export const POST = nextAdapter(handlers.POST);
