import { describe, expect, it } from "vitest";
import { isValidEmail } from "@/lib/email";

describe("isValidEmail", () => {
  it("accepts a normal email address", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
  });

  it("rejects a string without an @", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
  });

  it("rejects a string without a domain dot", () => {
    expect(isValidEmail("user@example")).toBe(false);
  });

  it("rejects a string containing whitespace", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });

  it("rejects an empty domain label before the first dot", () => {
    expect(isValidEmail("user@.example.com")).toBe(false);
  });

  it("rejects consecutive dots in the domain", () => {
    expect(isValidEmail("user@example..com")).toBe(false);
  });
});
