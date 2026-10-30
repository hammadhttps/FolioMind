import { ProviderError } from "@foliomind/contracts";
import { describe, expect, it } from "vitest";
import { createJina } from "./jina";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const base = {
  apiKey: "test-key",
  embeddingModel: "jina-embeddings-v5-text-small",
  embeddingDimension: 3,
  rerankerModel: "jina-reranker-v3.5",
};

describe("createJina", () => {
  it("sends the configured model, task and dimension and orders vectors by index", async () => {
    const { calls, fetchImpl } = fakeFetch(() =>
      Response.json({
        model: base.embeddingModel,
        data: [
          { index: 1, embedding: [0, 1, 0] },
          { index: 0, embedding: [1, 0, 0] },
        ],
        usage: { total_tokens: 7 },
      }),
    );
    const jina = createJina({ ...base, fetch: fetchImpl });
    const result = await jina.embed(["first", "second"], { task: "retrieval.passage" });

    expect(result.embeddings).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(result.usage.totalTokens).toBe(7);
    expect(calls[0]?.url).toBe("https://api.jina.ai/v1/embeddings");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      model: base.embeddingModel,
      task: "retrieval.passage",
      dimensions: 3,
      input: ["first", "second"],
    });
  });

  it("rejects vectors with the wrong dimension as a permanent error", async () => {
    const { fetchImpl } = fakeFetch(() =>
      Response.json({
        model: base.embeddingModel,
        data: [{ index: 0, embedding: [1, 0] }],
        usage: { total_tokens: 1 },
      }),
    );
    const jina = createJina({ ...base, fetch: fetchImpl });
    await expect(jina.embed(["text"], { task: "retrieval.query" })).rejects.toMatchObject({
      retryable: false,
    });
  });

  it("marks rate limits as retryable", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("busy", { status: 429 }));
    const jina = createJina({ ...base, fetch: fetchImpl });
    const error = await jina.rerank("q", ["a"], 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(true);
  });

  it("asks Reader for Markdown without images and posts the URL in the body", async () => {
    const { calls, fetchImpl } = fakeFetch(() =>
      Response.json({
        code: 200,
        data: { title: "Article", url: "https://example.com/a", content: "# Article" },
      }),
    );
    const jina = createJina({ ...base, fetch: fetchImpl });
    const page = await jina.readUrl("https://example.com/a?ref=x");

    expect(page).toMatchObject({ title: "Article", content: "# Article" });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["X-Respond-With"]).toBe("markdown");
    expect(headers["X-Retain-Images"]).toBe("none");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ url: "https://example.com/a?ref=x" });
  });
});
