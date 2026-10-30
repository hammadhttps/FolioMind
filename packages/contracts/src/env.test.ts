import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EnvValidationError,
  parseEnv,
  productionProblems,
  requireVariables,
  resolveAppEnv,
  upstashShape,
} from "./env";
import { ServiceNotConfiguredError } from "./errors";

const schema = z.object({
  ...upstashShape,
  API_KEY: z.string().min(1).optional(),
});

const local = {
  UPSTASH_REDIS_REST_URL: "http://localhost:8079",
  UPSTASH_REDIS_REST_TOKEN: "local-token",
};

describe("resolveAppEnv", () => {
  it("prefers APP_ENV, then maps Vercel environments, else development", () => {
    expect(resolveAppEnv({ APP_ENV: "staging", VERCEL_ENV: "production" })).toBe("staging");
    expect(resolveAppEnv({ VERCEL_ENV: "production" })).toBe("production");
    expect(resolveAppEnv({ VERCEL_ENV: "preview" })).toBe("staging");
    expect(resolveAppEnv({ APP_ENV: "nonsense" })).toBe("development");
    expect(resolveAppEnv({})).toBe("development");
  });
});

describe("parseEnv", () => {
  it("allows missing third-party keys in development", () => {
    const env = parseEnv("test-app", schema, { ...local }, ["API_KEY"]);
    expect(env.appEnv).toBe("development");
    expect(env.API_KEY).toBeUndefined();
  });

  it("fills FolioMind names from Vercel integration aliases", () => {
    const env = parseEnv(
      "test-app",
      schema,
      { KV_REST_API_URL: "https://kv.example.test", KV_REST_API_TOKEN: "kv-token" },
      [],
    );
    expect(env.UPSTASH_REDIS_REST_URL).toBe("https://kv.example.test");
    expect(env.UPSTASH_REDIS_REST_TOKEN).toBe("kv-token");
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv("test-app", schema, { ...local, API_KEY: "" }, []);
    expect(env.API_KEY).toBeUndefined();
  });

  it("requires listed keys in staging and production", () => {
    for (const APP_ENV of ["staging", "production"]) {
      expect(() => parseEnv("test-app", schema, { ...local, APP_ENV }, ["API_KEY"])).toThrow(
        EnvValidationError,
      );
    }
  });

  it("reports variable names only, never values", () => {
    const secretValue = "super-secret-value-123";
    try {
      parseEnv(
        "test-app",
        schema,
        { UPSTASH_REDIS_REST_URL: "not a url", UPSTASH_REDIS_REST_TOKEN: secretValue },
        [],
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const { message, variables } = error as EnvValidationError;
      expect(variables).toEqual(["UPSTASH_REDIS_REST_URL"]);
      expect(message).not.toContain(secretValue);
      expect(message).not.toContain("not a url");
    }
  });
});

describe("productionProblems", () => {
  it("flags missing keys and INNGEST_DEV outside development", () => {
    expect(productionProblems({ A: "x", INNGEST_DEV: "1" }, ["A", "B"])).toEqual([
      "B",
      "INNGEST_DEV (must be unset outside development)",
    ]);
  });
});

describe("requireVariables", () => {
  it("returns the requested values when present", () => {
    expect(requireVariables({ KEY: "value", OTHER: undefined }, "Service", ["KEY"])).toEqual({
      KEY: "value",
    });
  });

  it("throws ServiceNotConfiguredError naming the missing variables", () => {
    expect(() => requireVariables({ KEY: undefined }, "Jina", ["KEY"])).toThrow(
      new ServiceNotConfiguredError("Jina", ["KEY"]),
    );
  });
});
