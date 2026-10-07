import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/security/passkeys/options/route";

export const POST = nextAdapter(handlers.POST);
