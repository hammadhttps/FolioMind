import type { AnnotationAnchor, HighlightColor } from "@foliomind/contracts";
import type { AnnotationView } from "@foliomind/domain";

/** The serializable annotation the Reader's client components receive. */
export interface AnnotationItem {
  id: string;
  kind: "bookmark" | "highlight" | "note";
  pageNumber: number;
  anchor: AnnotationAnchor;
  body: string | null;
  color: HighlightColor | null;
  createdAt: string;
}

export function toAnnotationItem(annotation: AnnotationView): AnnotationItem {
  return { ...annotation, createdAt: annotation.createdAt.toISOString() };
}
