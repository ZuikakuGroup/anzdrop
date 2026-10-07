import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/revalidate/microcms/route";

export const POST = nextAdapter(handlers.POST);
