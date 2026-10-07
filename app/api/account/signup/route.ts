import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/signup/route";

export const POST = nextAdapter(handlers.POST);
