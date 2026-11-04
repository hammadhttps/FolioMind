import type { ImportRefusal } from "@foliomind/domain";

/** Why an import (or re-import) was refused, in Section 20's tone. */
export const IMPORT_REFUSAL_MESSAGES: Record<ImportRefusal, string> = {
  account_inactive: "Your account can't import articles right now.",
  file_limit:
    "You've reached the number of documents your plan allows. Delete one or upgrade to add more.",
  storage_limit: "You're out of storage. Delete something or upgrade to import more.",
  daily_limit: "You've added as many documents as you can today. Try again tomorrow.",
  quota_exceeded: "You've used this month's web imports. Your allowance resets next month.",
  not_found: "We couldn't find that document.",
  busy: "This article is already being imported.",
};

export const importRefusalMessage = (code: ImportRefusal) => IMPORT_REFUSAL_MESSAGES[code];
