import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/file/[fileId]/route";

export const GET = nextAdapter(handlers.GET);
