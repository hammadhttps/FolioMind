import { createRouteHandler } from "uploadthing/next";
import { env } from "@/env";
import { fileRouter } from "./core";

/*
 * UploadThing's endpoint: route config, presigned uploads and the signed
 * completion callback. The callback URL is detected from each request, so
 * preview deployments call back to themselves.
 */
export const { GET, POST } = createRouteHandler({
  router: fileRouter,
  config: { token: env.UPLOADTHING_TOKEN, logLevel: "Warning" },
});
