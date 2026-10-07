import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/account/recover/route";

export const POST = nextAdapter(handlers.POST);
