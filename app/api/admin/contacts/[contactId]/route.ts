import { nextAdapter } from "@/lib/api/nextAdapter";
import * as handlers from "@/server/routes/admin/contacts/[contactId]/route";

export const DELETE = nextAdapter(handlers.DELETE);
