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
  /** Changes per deploy (e.g. the git commit) so Inngest can roll deploys. */
  appVersion?: string | undefined;
  /**
   * Serverless hosts: how long one request may keep running steps before
   * handing back to Inngest, so it never reaches the host's time limit.
   */
  checkpointing?: { maxRuntime: `${number}s` } | undefined;
  logger?: InngestLogger | undefined;
}

export function createInngest(config: InngestConfig): Inngest {
  return new Inngest({
    id: config.appId,
    isDev: config.isDev,
    ...(config.eventKey ? { eventKey: config.eventKey } : {}),
    ...(config.signingKey ? { signingKey: config.signingKey } : {}),
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.appVersion ? { appVersion: config.appVersion } : {}),
    ...(config.checkpointing ? { checkpointing: config.checkpointing } : {}),
    ...(config.logger ? { logger: config.logger } : {}),
  });
}
