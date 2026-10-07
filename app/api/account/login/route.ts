import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/login/route";

export const POST = nextAdapter(handlers.POST);
