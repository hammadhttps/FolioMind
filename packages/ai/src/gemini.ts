import { ProviderError, isRetryableStatus } from "@foliomind/contracts";
import { GoogleGenAI, type GenerateContentResponseUsageMetadata } from "@google/genai";
import { z } from "zod";

const PROVIDER = "Gemini";

export interface GeminiConfig {
  apiKey: string;
  timeoutMs?: number;
}

export interface GenerateOptions {
  /** Model IDs are configuration (Section 2), recorded on every AI run. */
  model: string;
  prompt: string;
  /** Evidence rules and instructions (Section 8 step 5). */
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TextResult {
  model: string;
  text: string;
  usage: TokenUsage;
}

export interface StructuredResult<T> {
  model: string;
  data: T;
  usage: TokenUsage;
}

function toUsage(metadata: GenerateContentResponseUsageMetadata | undefined): TokenUsage {
  return {
    inputTokens: metadata?.promptTokenCount ?? 0,
    outputTokens: metadata?.candidatesTokenCount ?? 0,
    totalTokens: metadata?.totalTokenCount ?? 0,
  };
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(PROVIDER, `${PROVIDER} request failed: ${message}`, {
    ...(status !== undefined && Number.isFinite(status) ? { status } : {}),
    // No HTTP status means a network failure or timeout, which is retryable.
    retryable: status === undefined || !Number.isFinite(status) ? true : isRetryableStatus(status),
    cause: error,
  });
}

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
          model: options.model,
          text: response.text ?? "",
          usage: toUsage(response.usageMetadata),
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },

    /** Streams text chunks; the final chunk carries token usage. */
    async *streamText(
      options: GenerateOptions,
    ): AsyncGenerator<{ text: string; usage?: TokenUsage }> {
      let stream: AsyncGenerator<{
        text?: string | undefined;
        usageMetadata?: GenerateContentResponseUsageMetadata | undefined;
      }>;
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
      try {
        for await (const chunk of stream) {
          if (chunk.usageMetadata) usage = toUsage(chunk.usageMetadata);
          if (chunk.text) yield { text: chunk.text };
        }
      } catch (error) {
        throw toProviderError(error);
      }
      yield { text: "", usage: usage ?? toUsage(undefined) };
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
      return { model: options.model, data: parsed.data, usage };
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
