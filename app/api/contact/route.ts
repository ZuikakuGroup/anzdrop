import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/contact/route";

export const POST = nextAdapter(handlers.POST);
