import type { CitationRef, NoteDoc } from "@foliomind/contracts";
import type { WorkspaceCardData, WorkspaceNoteView } from "@foliomind/domain";

/** The serializable shapes the Research Workspace's client components receive. */
export interface WorkspaceCardView {
  id: string;
  name: string;
  description: string | null;
  sourceCount: number;
  updatedAt: string;
}

export interface NoteView {
  id: string;
  body: NoteDoc;
  sourceMessageId: string | null;
  citations: CitationRef[];
  updatedAt: string;
}

export const toWorkspaceCard = (card: WorkspaceCardData): WorkspaceCardView => ({
  ...card,
  updatedAt: card.updatedAt.toISOString(),
});

export const toNoteView = (note: WorkspaceNoteView): NoteView => ({
  ...note,
  updatedAt: note.updatedAt.toISOString(),
});
