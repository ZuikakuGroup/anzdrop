import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/download/[shareId]/route";

export const GET = nextAdapter(handlers.GET);
