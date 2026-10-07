import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/security/passkeys/verify/route";

export const POST = nextAdapter(handlers.POST);
