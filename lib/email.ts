import { z } from "zod";

const emailSchema = z.email();

export function isValidEmail(email: string): boolean {
  return emailSchema.safeParse(email).success;
}
