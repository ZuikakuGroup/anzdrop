import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/contacts/[contactId]/resolve/route";

export const POST = nextAdapter(handlers.POST);
