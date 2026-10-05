import { describe, expect, it } from "vitest";
import {
  parseAdminStatusFilter,
  resolvedAtWhereClause,
} from "@/lib/admin/statusFilter";

describe("parseAdminStatusFilter", () => {
  it("defaults to open", () => {
    expect(parseAdminStatusFilter(null)).toBe("open");
    expect(parseAdminStatusFilter("unknown")).toBe("open");
  });

  it("accepts resolved and all", () => {
    expect(parseAdminStatusFilter("resolved")).toBe("resolved");
    expect(parseAdminStatusFilter("all")).toBe("all");
  });
});

describe("resolvedAtWhereClause", () => {
  it("builds the expected SQL fragment", () => {
    expect(resolvedAtWhereClause("open")).toBe("WHERE resolved_at IS NULL");
    expect(resolvedAtWhereClause("resolved")).toBe(
      "WHERE resolved_at IS NOT NULL"
    );
    expect(resolvedAtWhereClause("all")).toBe("");
  });
});
