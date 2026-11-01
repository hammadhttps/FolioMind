import { describe, expect, it } from "vitest";
import { emailSignInStartSchema, emailSignInVerifySchema } from "./forms";

describe("emailSignInStartSchema", () => {
  it("trims and lowercases the address", () => {
    expect(emailSignInStartSchema.parse({ email: "  Ada@Example.COM " })).toEqual({
      email: "ada@example.com",
    });
  });

  it("rejects invalid or overlong addresses with a readable message", () => {
    const result = emailSignInStartSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Enter a valid email address.");
    expect(emailSignInStartSchema.safeParse({ email: `${"a".repeat(250)}@x.io` }).success).toBe(
      false,
    );
  });
});

describe("emailSignInVerifySchema", () => {
  it("accepts exactly six digits", () => {
    expect(emailSignInVerifySchema.parse({ email: "a@b.co", code: " 012345 " }).code).toBe(
      "012345",
    );
    for (const code of ["12345", "1234567", "12a456", ""]) {
      expect(emailSignInVerifySchema.safeParse({ email: "a@b.co", code }).success).toBe(false);
    }
  });
});
