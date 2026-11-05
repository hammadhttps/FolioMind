import { ProviderError, isRetryableStatus } from "@foliomind/contracts";
import {
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
import { z } from "zod";

const PROVIDER = "Gemini";

export interface GeminiConfig {
  apiKey: string;
  timeoutMs?: number;
}

/**
 * Thinking is on by default at `medium` and counts toward maxOutputTokens: a
 * 256-token limit at `low` used 241 on thoughts and truncated the answer
 * (measured 2026-11-05 on gemini-3.6-flash). `minimal` used none. Every call
 * should choose a level on purpose.
 */
export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

const THINKING_LEVELS: Record<GeminiThinkingLevel, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export interface GenerateOptions {
  /** Model IDs are configuration (Section 2), recorded on every AI run. */
  model: string;
  prompt: string;
  /** Evidence rules and instructions (Section 8 step 5). */
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinking?: GeminiThinkingLevel;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  /** Text returned to the caller. */
  outputTokens: number;
  /** Billed at the output rate, on top of `outputTokens`. */
  thoughtTokens: number;
  totalTokens: number;
}

export interface TextResult {
  /** The model that actually served the request, which can differ from the one asked for. */
  model: string;
  text: string;
  usage: TokenUsage;
}

export interface StructuredResult<T> {
  model: string;
  data: T;
  usage: TokenUsage;
}

/** The last item of a text stream. */
export interface StreamEnd {
  text: "";
  usage: TokenUsage;
  model: string;
  finishReason: string | undefined;
}

function toUsage(metadata: GenerateContentResponseUsageMetadata | undefined): TokenUsage {
  return {
    inputTokens: metadata?.promptTokenCount ?? 0,
    outputTokens: metadata?.candidatesTokenCount ?? 0,
    thoughtTokens: metadata?.thoughtsTokenCount ?? 0,
    totalTokens: metadata?.totalTokenCount ?? 0,
  };
}

/**
 * A 429's body says how long to wait: seconds for a per-minute limit, hours for
 * the free tier's daily one (20 requests per model per project, measured
 * 2026-11-05). The SDK only passes it along inside the message text.
 */
export function retryAfterFrom(message: string): number | undefined {
  const match = /retryDelay[\\": ]+(\d+(?:\.\d+)?)s/.exec(message);
  return match ? Number(match[1]) * 1000 : undefined;
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const retryAfterMs = retryAfterFrom(message);
  return new ProviderError(PROVIDER, `${PROVIDER} request failed: ${message}`, {
    ...(status !== undefined && Number.isFinite(status) ? { status } : {}),
    // No HTTP status means a network failure or timeout, which is retryable.
    retryable: status === undefined || !Number.isFinite(status) ? true : isRetryableStatus(status),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    cause: error,
  });
}

/** True when waiting a moment won't help: this model's quota is gone for the day. */
export function isDailyQuotaError(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    error.status === 429 &&
    (error.retryAfterMs ?? 0) > 60 * 60 * 1000
  );
}

/** These reject `minimal` with a 400; their lowest level is `low` (measured 2026-11-05). */
const NO_MINIMAL_THINKING = /^gemini-3\.[78]-flash/;

const thinkingLevelFor = (model: string, level: GeminiThinkingLevel): ThinkingLevel =>
  THINKING_LEVELS[level === "minimal" && NO_MINIMAL_THINKING.test(model) ? "low" : level];

export function createGemini(config: GeminiConfig) {
  const ai = new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: { timeout: config.timeoutMs ?? 60_000 },
  });

  function requestConfig(options: GenerateOptions) {
    return {
      ...(options.system ? { systemInstruction: options.system } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens !== undefined
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
      ...(options.thinking
        ? { thinkingConfig: { thinkingLevel: thinkingLevelFor(options.model, options.thinking) } }
        : {}),
      ...(options.signal ? { abortSignal: options.signal } : {}),
    };
  }

  return {
    async generateText(options: GenerateOptions): Promise<TextResult> {
      try {
        const response = await ai.models.generateContent({
          model: options.model,
          contents: options.prompt,
          config: requestConfig(options),
        });
        return {
          model: response.modelVersion ?? options.model,
          text: response.text ?? "",
          usage: toUsage(response.usageMetadata),
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },

    /** Streams text chunks; the final item carries token usage, the serving model and why it ended. */
    async *streamText(options: GenerateOptions): AsyncGenerator<{ text: string } | StreamEnd> {
      let stream: Awaited<ReturnType<typeof ai.models.generateContentStream>>;
      try {
        stream = await ai.models.generateContentStream({
          model: options.model,
          contents: options.prompt,
          config: requestConfig(options),
        });
      } catch (error) {
        throw toProviderError(error);
      }
      let usage: TokenUsage | undefined;
      let model = options.model;
      let finishReason: string | undefined;
      try {
        for await (const chunk of stream) {
          if (chunk.usageMetadata) usage = toUsage(chunk.usageMetadata);
          if (chunk.modelVersion) model = chunk.modelVersion;
          const reason = chunk.candidates?.[0]?.finishReason;
          if (reason) finishReason = reason;
          if (chunk.text) yield { text: chunk.text };
        }
      } catch (error) {
        throw toProviderError(error);
      }
      yield { text: "", usage: usage ?? toUsage(undefined), model, finishReason };
    },

    /**
     * Requests JSON shaped by the Zod schema, then re-parses it with the same
     * schema: schema-shaped output is untrusted until parsed (Section 8).
     */
    async generateStructured<TSchema extends z.ZodType>(
      schema: TSchema,
      options: GenerateOptions,
    ): Promise<StructuredResult<z.infer<TSchema>>> {
      let text: string;
      let usage: TokenUsage;
      let model = options.model;
      try {
        const response = await ai.models.generateContent({
          model: options.model,
          contents: options.prompt,
          config: {
            ...requestConfig(options),
            responseMimeType: "application/json",
            responseJsonSchema: z.toJSONSchema(schema),
          },
        });
        text = response.text ?? "";
        usage = toUsage(response.usageMetadata);
        model = response.modelVersion ?? options.model;
      } catch (error) {
        throw toProviderError(error);
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        throw new ProviderError(PROVIDER, "structured output was not valid JSON", {
          retryable: false,
          cause: error,
        });
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new ProviderError(PROVIDER, "structured output did not match the schema", {
          retryable: false,
          cause: parsed.error,
        });
      }
      return { model, data: parsed.data, usage };
    },

    /** Model names available to this API key (used by the connectivity check). */
    async listModelNames(): Promise<string[]> {
      try {
        const names: string[] = [];
        const pager = await ai.models.list({ config: { pageSize: 100 } });
        for await (const model of pager) {
          if (model.name) names.push(model.name.replace(/^models\//, ""));
        }
        return names;
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}

export type GeminiClient = ReturnType<typeof createGemini>;
