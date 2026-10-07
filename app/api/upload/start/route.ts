import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/upload/start/route";

export const POST = nextAdapter(handlers.POST);
