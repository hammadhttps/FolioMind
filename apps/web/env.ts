import {
  aliasedVariables,
  auth0Shape,
  baseShape,
  databaseShape,
  geminiShape,
  inngestShape,
  jinaShape,
  PRODUCTION_REQUIRED,
  productionProblems,
  rateLimitShape,
  requiresServices,
  resolveAppEnv,
  stripeWebShape,
  upstashShape,
  uploadthingShape,
  variableNamesFromIssues,
} from "@foliomind/contracts";
import { createEnv } from "@t3-oss/env-nextjs";

/*
 * Web environment (blueprint Section 13). Local infrastructure variables are
 * always required; third-party keys are optional in development and required
 * once APP_ENV is staging or production. CI builds set SKIP_ENV_VALIDATION.
 */

const skipValidation = Boolean(process.env.SKIP_ENV_VALIDATION);

export const env = createEnv({
  server: {
    ...baseShape,
    ...auth0Shape,
    ...databaseShape,
    ...upstashShape,
    ...rateLimitShape,
    ...inngestShape,
    ...uploadthingShape,
    ...jinaShape,
    ...geminiShape,
    ...stripeWebShape,
  },
  client: {},
  experimental__runtimeEnv: {
    // Vercel integration names (KV_REST_API_*, AUTH0_MANAGEMENT_API_*) fill unset FolioMind names.
    ...aliasedVariables(process.env),
  },
  emptyStringAsUndefined: true,
  skipValidation,
  onValidationError: (issues) => {
    // Names only, so build and server logs never contain secret values.
    throw new Error(
      `Invalid or missing environment variables: ${variableNamesFromIssues(issues).join(", ")}`,
    );
  },
});

export const appEnv = resolveAppEnv(process.env);

if (!skipValidation && typeof window === "undefined" && requiresServices(appEnv)) {
  const problems = productionProblems(env, PRODUCTION_REQUIRED.web);
  if (problems.length > 0) {
    throw new Error(`Missing variables required in ${appEnv}: ${problems.join(", ")}`);
  }
}
