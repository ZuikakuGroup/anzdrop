import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/login/otp/route";

export const POST = nextAdapter(handlers.POST);
