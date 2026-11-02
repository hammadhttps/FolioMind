import { generateReactHelpers } from "@uploadthing/react";
import type { FolioMindFileRouter } from "@/app/api/uploadthing/core";

/** Typed client helpers for FolioMind's own upload UI (no stock UploadThing styling). */
export const { useUploadThing } = generateReactHelpers<FolioMindFileRouter>();
