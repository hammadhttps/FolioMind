import { Inngest } from "inngest";

/** One Inngest app per deployable (blueprint Section 9); the web app only sends events. */
export type InngestAppId = "foliomind-web" | "foliomind-ingestion" | "foliomind-generation";

export interface InngestLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export interface InngestConfig {
  appId: InngestAppId;
  /** True for the local Dev Server (`INNGEST_DEV=1`). */
  isDev: boolean;
  eventKey?: string | undefined;
  /** Workers only; the web app never serves functions. */
  signingKey?: string | undefined;
  baseUrl?: string | undefined;
  logger?: InngestLogger | undefined;
}

export function createInngest(config: InngestConfig): Inngest {
  return new Inngest({
    id: config.appId,
    isDev: config.isDev,
    ...(config.eventKey ? { eventKey: config.eventKey } : {}),
    ...(config.signingKey ? { signingKey: config.signingKey } : {}),
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.logger ? { logger: config.logger } : {}),
  });
}
