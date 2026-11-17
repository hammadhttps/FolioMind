/**
 * `pnpm smoke -- <base url>`: post-deploy smoke checks (blueprint Section 14).
 * Read-only requests plus one unsigned webhook POST that must be refused. It
 * needs no credentials and changes nothing, so it can run against production.
 */

interface Check {
  name: string;
  run: (base: string) => Promise<string | null>;
}

const TIMEOUT_MS = 20_000;

async function request(base: string, path: string, init: RequestInit = {}) {
  return fetch(new URL(path, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "foliomind-smoke" },
    ...init,
  });
}

function page(path: string, text: string): Check {
  return {
    name: `GET ${path}`,
    async run(base) {
      const response = await request(base, path);
      if (response.status !== 200) return `status ${response.status}`;
      const body = await response.text();
      return body.includes(text) ? null : `missing "${text}"`;
    },
  };
}

const CHECKS: Check[] = [
  page("/", "FolioMind"),
  page("/library", "A world of ideas"),
  page("/pricing", "Plans for every kind of reader."),
  page("/privacy/retention", "Data retention"),
  {
    name: "GET /dashboard sends guests to sign in",
    async run(base) {
      const response = await request(base, "/dashboard");
      const location = response.headers.get("location") ?? "";
      return response.status >= 300 && response.status < 400 && location.includes("login")
        ? null
        : `status ${response.status}, location ${location || "none"}`;
    },
  },
  {
    name: "GET /manifest.webmanifest",
    async run(base) {
      const response = await request(base, "/manifest.webmanifest");
      return response.status === 200 ? null : `status ${response.status}`;
    },
  },
  {
    name: "POST /api/webhooks/stripe without a signature is refused",
    async run(base) {
      const response = await request(base, "/api/webhooks/stripe", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json", "user-agent": "foliomind-smoke" },
      });
      if (response.status === 400) return null;
      if (response.status === 503) return "503: billing isn't configured on this deployment";
      return `status ${response.status}`;
    },
  },
  {
    // Production Inngest refuses unsigned requests (401); missing or broken is 404 or 5xx.
    name: "GET /api/inngest is served",
    async run(base) {
      const response = await request(base, "/api/inngest");
      return response.status === 200 || response.status === 401
        ? null
        : `status ${response.status}`;
    },
  },
];

async function main() {
  const base = process.argv.slice(2).find((value) => value.startsWith("http"));
  if (!base) throw new Error("Usage: pnpm smoke -- https://your-deployment.example");
  let failed = 0;
  for (const check of CHECKS) {
    const problem = await check.run(base).catch((error: unknown) => (error as Error).message);
    console.log(`${problem ? "FAIL" : "ok  "}  ${check.name}${problem ? `: ${problem}` : ""}`);
    if (problem) failed += 1;
  }
  if (failed > 0) {
    console.error(`\n${failed} of ${CHECKS.length} smoke checks failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${CHECKS.length} smoke checks passed.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
