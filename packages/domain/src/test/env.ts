/** Local Compose defaults; CI points these at its service containers. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://foliomind:foliomind@localhost:5433/foliomind_test";

export const TEST_REDIS = {
  url: process.env.TEST_UPSTASH_REDIS_REST_URL || "http://localhost:8079",
  token: process.env.TEST_UPSTASH_REDIS_REST_TOKEN || "foliomind-local-dev-token",
};
