import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/accounts/[accountId]/route";

export const GET = nextAdapter(handlers.GET);
export const POST = nextAdapter(handlers.POST);
export const DELETE = nextAdapter(handlers.DELETE);
