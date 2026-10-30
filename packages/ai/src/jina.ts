import {
  ProviderError,
  providerErrorFromResponse,
  providerNetworkError,
} from "@foliomind/contracts";
import { z } from "zod";

const API_URL = "https://api.jina.ai/v1";
const READER_URL = "https://r.jina.ai/";
const PROVIDER = "Jina";

export interface JinaConfig {
  apiKey: string;
  embeddingModel: string;
  embeddingDimension: number;
  rerankerModel: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Passages are indexed, queries are searched (Section 8); never mix the two. */
export type EmbeddingTask = "retrieval.passage" | "retrieval.query";

const embeddingsResponse = z.object({
  model: z.string(),
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })),
  usage: z.object({ total_tokens: z.number() }).loose(),
});

const rerankResponse = z.object({
  model: z.string(),
  results: z.array(z.object({ index: z.number(), relevance_score: z.number() })),
  usage: z.object({ total_tokens: z.number() }).loose(),
});

const readerResponse = z.object({
  code: z.number().optional(),
  data: z
    .object({
      title: z.string().optional(),
      url: z.string().optional(),
      content: z.string().optional(),
      description: z.string().optional(),
      usage: z.object({ tokens: z.number() }).loose().optional(),
    })
    .loose(),
});

export interface EmbedResult {
  model: string;
  dimension: number;
  embeddings: number[][];
  usage: { totalTokens: number };
}

export interface RerankResult {
  model: string;
  results: { index: number; relevanceScore: number }[];
  usage: { totalTokens: number };
}

export interface ReadUrlResult {
  title: string;
  url: string;
  /** Markdown produced by Jina Reader. */
  content: string;
  usage: { tokens: number | undefined };
}

export function createJina(config: JinaConfig) {
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 30_000;

  async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw providerNetworkError(PROVIDER, error);
    }
    if (!response.ok) throw await providerErrorFromResponse(PROVIDER, response);
    return response.json() as Promise<unknown>;
  }

  function invalid(what: string, cause?: unknown): ProviderError {
    return new ProviderError(PROVIDER, `unexpected ${what} response`, { retryable: false, cause });
  }

  return {
    /** Embeds texts with the configured model and dimension (Section 8 step 6). */
    async embed(texts: readonly string[], options: { task: EmbeddingTask }): Promise<EmbedResult> {
      const parsed = embeddingsResponse.safeParse(
        await post(`${API_URL}/embeddings`, {
          model: config.embeddingModel,
          input: texts,
          task: options.task,
          dimensions: config.embeddingDimension,
          normalized: true,
          embedding_type: "float",
          truncate: false,
        }),
      );
      if (!parsed.success) throw invalid("embeddings", parsed.error);
      const embeddings = [...parsed.data.data]
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
      if (
        embeddings.length !== texts.length ||
        embeddings.some((vector) => vector.length !== config.embeddingDimension)
      ) {
        throw invalid("embeddings (count or dimension mismatch)");
      }
      return {
        model: parsed.data.model,
        dimension: config.embeddingDimension,
        embeddings,
        usage: { totalTokens: parsed.data.usage.total_tokens },
      };
    },

    /** Ranks passages for a query; indexes refer to the `documents` array (Section 8 step 4). */
    async rerank(query: string, documents: readonly string[], topN: number): Promise<RerankResult> {
      const parsed = rerankResponse.safeParse(
        await post(`${API_URL}/rerank`, {
          model: config.rerankerModel,
          query,
          documents,
          top_n: topN,
          return_documents: false,
        }),
      );
      if (!parsed.success) throw invalid("rerank", parsed.error);
      return {
        model: parsed.data.model,
        results: parsed.data.results.map((result) => ({
          index: result.index,
          relevanceScore: result.relevance_score,
        })),
        usage: { totalTokens: parsed.data.usage.total_tokens },
      };
    },

    /**
     * Converts one public web page to Markdown with Jina Reader (Section 27
     * step 3). Jina fetches the page; FolioMind never connects to the URL.
     */
    async readUrl(url: string, options: { timeoutSeconds?: number } = {}): Promise<ReadUrlResult> {
      const timeoutSeconds = Math.min(options.timeoutSeconds ?? 20, 180);
      const parsed = readerResponse.safeParse(
        await post(
          READER_URL,
          { url },
          {
            "X-Respond-With": "markdown",
            "X-Retain-Images": "none",
            "X-Timeout": String(timeoutSeconds),
          },
        ),
      );
      if (!parsed.success || parsed.data.data.content === undefined) {
        throw invalid("reader", parsed.success ? undefined : parsed.error);
      }
      const { data } = parsed.data;
      return {
        title: data.title ?? "",
        url: data.url ?? url,
        content: data.content ?? "",
        usage: { tokens: data.usage?.tokens },
      };
    },
  };
}

export type JinaClient = ReturnType<typeof createJina>;
