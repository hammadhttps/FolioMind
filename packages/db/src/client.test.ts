import { describe, expect, it } from "vitest";
import { withoutClientOnlyParams } from "./client";

describe("withoutClientOnlyParams", () => {
  it("drops channel_binding from Neon connection strings and keeps sslmode", () => {
    expect(
      withoutClientOnlyParams(
        "postgresql://app:p%40ss@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
      ),
    ).toBe("postgresql://app:p%40ss@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require");
  });

  it("returns other URLs unchanged", () => {
    const url = "postgres://foliomind:foliomind@localhost:5433/foliomind";
    expect(withoutClientOnlyParams(url)).toBe(url);
  });
});
