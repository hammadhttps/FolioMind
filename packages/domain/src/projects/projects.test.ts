import { randomUUID } from "node:crypto";
import {
  docSectionIds,
  EVENT_NAMES,
  readOutline,
  readProjectDoc,
  renumberCitations,
  type OutlineSection,
  type ProjectBlock,
  type ProjectDoc,
} from "@foliomind/contracts";
import {
  assets,
  documents,
  exports as projectExports,
  jobs,
  outboxEvents,
  projectRevisions,
  projects,
  projectSources,
  usageBuckets,
  usageOperations,
} from "@foliomind/db";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { deleteDocument } from "../documents";
import { createNotification, listNotifications } from "../notifications";
import { createBook, createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import {
  acceptSectionProposal,
  addProjectSource,
  checkProjectSources,
  commitProjectUsage,
  completeExport,
  createProject,
  declineSectionProposal,
  deleteProjectExport,
  duplicateProject,
  exportChargeFor,
  failExport,
  failProjectJob,
  finishDraft,
  getDownloadableExport,
  getOwnedProject,
  getStudioState,
  keepTextAsRevision,
  listProjectExports,
  listProjectRevisions,
  listProjects,
  loadExportContext,
  loadGenerationContext,
  overwriteAfterConflict,
  projectAllowance,
  purgeDeletedProjects,
  removeProjectSource,
  renameProject,
  requestProjectExport,
  requestProjectGeneration,
  requestProjectJobCancel,
  restoreProjectRevision,
  saveDraftSection,
  saveGeneratedOutline,
  saveProjectContent,
  saveProjectOutline,
  saveProjectRevision,
  saveSectionProposal,
  saveStudioSettings,
  setProjectArchived,
  softDeleteProject,
  startDraft,
  assertProjectJobCanContinue,
} from ".";

const S1 = "33333333-3333-4333-8333-333333333331";
const S2 = "33333333-3333-4333-8333-333333333332";
const S3 = "33333333-3333-4333-8333-333333333333";
const OUTLINE: OutlineSection[] = [
  { id: S1, heading: "One", notes: "" },
  { id: S2, heading: "Two", notes: "" },
  { id: S3, heading: "Three", notes: "" },
];
const PROMPT = "A report about harbors for council members.";

const heading = (sectionId: string, text: string): ProjectBlock => ({
  type: "heading",
  attrs: { level: 2, sectionId },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): ProjectBlock => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (...content: ProjectBlock[]): ProjectDoc => ({ type: "doc", content });
const SETTINGS = {
  audience: "",
  length: "short" as const,
  pageSize: "A4" as const,
  cover: false,
  contents: false,
  template: "academic-report" as const,
};

describeWithDatabase("projects", () => {
  let db: ReturnType<typeof testDb>;

  beforeAll(() => {
    db = testDb();
  });

  async function owner() {
    const user = await createUser(db);
    return { id: user.id, status: "active" as const };
  }

  async function usage(userId: string, metric: string) {
    const [row] = await db
      .select({ reserved: usageBuckets.reserved, consumed: usageBuckets.consumed })
      .from(usageBuckets)
      .where(and(eq(usageBuckets.userId, userId), eq(usageBuckets.metric, metric)));
    return row ?? { reserved: 0, consumed: 0 };
  }

  /** A project ready to generate from: a prompt, and one ready source in research mode. */
  async function ready(mode: "research" | "general" = "general") {
    const actor = await owner();
    let versionIds: string[] = [];
    if (mode === "research") {
      const source = await createDocument(db, actor.id);
      versionIds = [source.version.id];
    }
    const created = await createProject(db, actor, { title: "Harbor report", mode, versionIds });
    if (!created.ok) throw new Error(created.code);
    await saveStudioSettings(db, actor, {
      projectId: created.projectId,
      prompt: PROMPT,
      mode,
      ...SETTINGS,
    });
    return { actor, projectId: created.projectId, versionIds };
  }

  /** Runs an outline job through to its stored result, as Worker B does. */
  async function generateOutline(actor: { id: string; status: "active" }, projectId: string) {
    const result = await requestProjectGeneration(db, actor, projectId, { kind: "outline" });
    if (!result.ok) throw new Error(result.code);
    const usageKey = await usageKeyOf(result.jobId);
    await saveGeneratedOutline(db, { projectId, jobId: result.jobId, usageKey, outline: OUTLINE });
    await commitProjectUsage(db, usageKey);
    return result.jobId;
  }

  async function usageKeyOf(jobId: string): Promise<string | null> {
    const [event] = await db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(sql`${outboxEvents.payload}->>'jobId' = ${jobId}`);
    return (event?.payload as { usageKey: string | null } | undefined)?.usageKey ?? null;
  }

  /** Writes every section and finishes the draft. */
  async function generateDraft(
    actor: { id: string; status: "active" },
    projectId: string,
    replace = false,
  ) {
    const result = await requestProjectGeneration(db, actor, projectId, { kind: "draft", replace });
    if (!result.ok) throw new Error(result.code);
    await startDraft(db, { projectId, replace });
    let done = 0;
    for (const section of OUTLINE) {
      done += 1;
      await saveDraftSection(db, {
        projectId,
        jobId: result.jobId,
        section: {
          sectionId: section.id,
          nodes: [heading(section.id, section.heading), paragraph(`Text of ${section.heading}.`)],
        },
        outlineIds: OUTLINE.map((item) => item.id),
        done,
        total: OUTLINE.length,
      });
    }
    const usageKey = await usageKeyOf(result.jobId);
    await finishDraft(db, { projectId, jobId: result.jobId, ownerId: actor.id, usageKey });
    await commitProjectUsage(db, usageKey);
    return result.jobId;
  }

  async function drafted() {
    const context = await ready();
    await generateOutline(context.actor, context.projectId);
    await generateDraft(context.actor, context.projectId);
    return context;
  }

  const counterOf = async (actor: { id: string; status: "active" }, projectId: string) =>
    (await getOwnedProject(db, actor, projectId))!.revisionCounter;

  async function finishExport(
    actor: { id: string; status: "active" },
    projectId: string,
    exported: { exportId: string; jobId: string; eventKey: string },
    bytes = 1000,
  ) {
    const usageKey = await usageKeyOf(exported.jobId);
    const saved = await completeExport(db, {
      exportId: exported.exportId,
      jobId: exported.jobId,
      projectId,
      ownerId: actor.id,
      operationKey: exported.eventKey,
      file: { key: `export-${randomUUID()}`, size: bytes },
      checksum: "abc123",
      pageCount: 4,
      acl: "public",
      metrics: { renderMs: 10 },
    });
    if (saved) await commitProjectUsage(db, usageKey);
    return saved;
  }

  /* --- CRUD ------------------------------------------------------------ */

  it("creating charges nothing, and only takes ready sources the owner can read", async () => {
    const actor = await owner();
    const source = await createDocument(db, actor.id);
    const created = await createProject(db, actor, {
      title: "Report",
      mode: "research",
      versionIds: [source.version.id],
    });
    expect(created.ok).toBe(true);
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 0, consumed: 0 });

    const stranger = await createDocument(db, (await owner()).id);
    expect(
      await createProject(db, actor, {
        title: "Report",
        mode: "research",
        versionIds: [stranger.version.id],
      }),
    ).toEqual({ ok: false, code: "source_unavailable" });

    const processing = await createDocument(db, actor.id);
    await db.execute(
      sql`update document_versions set status = 'queued' where id = ${processing.version.id}`,
    );
    expect(
      await createProject(db, actor, {
        title: "Report",
        mode: "research",
        versionIds: [processing.version.id],
      }),
    ).toEqual({ ok: false, code: "source_unavailable" });
  });

  it("general mode keeps no sources, whatever it's given", async () => {
    const actor = await owner();
    const source = await createDocument(db, actor.id);
    const created = await createProject(db, actor, {
      title: "Essay",
      mode: "general",
      versionIds: [source.version.id],
    });
    if (!created.ok) throw new Error(created.code);
    const rows = await db
      .select()
      .from(projectSources)
      .where(eq(projectSources.projectId, created.projectId));
    expect(rows).toEqual([]);
  });

  it("lists the owner's projects with filters and keyset paging both ways", async () => {
    const actor = await owner();
    const titles = ["Delta", "alpha", "Charlie", "bravo", "100%_done"];
    const ids: string[] = [];
    for (const title of titles) {
      const created = await createProject(db, actor, { title, mode: "general", versionIds: [] });
      if (created.ok) ids.push(created.projectId);
    }
    const stranger = await owner();
    expect(
      (await listProjects(db, { userId: stranger.id, sort: "updated", limit: 20 })).items,
    ).toEqual([]);

    const first = await listProjects(db, { userId: actor.id, sort: "title", limit: 2 });
    expect(first.items.map((item) => item.title)).toEqual(["100%_done", "alpha"]);
    expect(first.prevCursor).toBeNull();
    const second = await listProjects(db, {
      userId: actor.id,
      sort: "title",
      limit: 2,
      after: first.nextCursor!,
    });
    expect(second.items.map((item) => item.title)).toEqual(["bravo", "Charlie"]);
    const back = await listProjects(db, {
      userId: actor.id,
      sort: "title",
      limit: 2,
      before: second.prevCursor!,
    });
    expect(back.items.map((item) => item.title)).toEqual(["100%_done", "alpha"]);
    expect(back.prevCursor).toBeNull();
    expect(back.nextCursor).not.toBeNull();
    const last = await listProjects(db, {
      userId: actor.id,
      sort: "title",
      limit: 2,
      after: second.nextCursor!,
    });
    expect(last.items.map((item) => item.title)).toEqual(["Delta"]);
    expect(last.nextCursor).toBeNull();

    const updated = await listProjects(db, { userId: actor.id, sort: "updated", limit: 3 });
    expect(updated.items[0]?.title).toBe("100%_done");
    const page2 = await listProjects(db, {
      userId: actor.id,
      sort: "updated",
      limit: 3,
      after: updated.nextCursor!,
    });
    expect([...updated.items, ...page2.items]).toHaveLength(5);

    // A literal % and _ in a search are matched as characters.
    expect(
      (await listProjects(db, { userId: actor.id, q: "%_", sort: "title", limit: 20 })).items.map(
        (item) => item.title,
      ),
    ).toEqual(["100%_done"]);

    expect(
      (
        await listProjects(db, {
          userId: actor.id,
          status: "complete",
          sort: "title",
          limit: 20,
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await listProjects(db, {
          userId: actor.id,
          mode: "research",
          sort: "title",
          limit: 20,
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await listProjects(db, {
          userId: actor.id,
          template: "study-notes",
          sort: "title",
          limit: 20,
        })
      ).items,
    ).toEqual([]);

    await setProjectArchived(db, actor, { projectId: ids[0]!, archived: true });
    expect(
      (await listProjects(db, { userId: actor.id, sort: "title", limit: 20 })).items,
    ).toHaveLength(4);
    const archived = await listProjects(db, {
      userId: actor.id,
      archived: true,
      sort: "title",
      limit: 20,
    });
    expect(archived.items.map((item) => item.title)).toEqual(["Delta"]);
    expect(archived.items[0]?.archived).toBe(true);
  });

  it("only the owner can read, rename, archive or delete", async () => {
    const { actor, projectId } = await ready();
    const stranger = await owner();
    const admin = { id: (await createUser(db, { role: "admin" })).id, status: "active" as const };
    for (const other of [stranger, admin]) {
      expect(await getOwnedProject(db, other, projectId)).toBeNull();
      expect(await getStudioState(db, other, projectId)).toBeNull();
      expect(await renameProject(db, other, { projectId, title: "Mine" })).toBe(false);
      expect(await setProjectArchived(db, other, { projectId, archived: true })).toEqual({
        ok: false,
        code: "not_found",
      });
      expect(await softDeleteProject(db, other, projectId)).toEqual({
        deleted: false,
        stoppedJobId: null,
      });
      expect(await requestProjectGeneration(db, other, projectId, { kind: "outline" })).toEqual({
        ok: false,
        code: "not_found",
      });
    }
    expect(await renameProject(db, actor, { projectId, title: "Renamed" })).toBe(true);
    expect((await getOwnedProject(db, actor, projectId))?.title).toBe("Renamed");
    expect(await getOwnedProject(db, { id: actor.id, status: "suspended" }, projectId)).toBeNull();
  });

  it("duplicates settings, outline, content and sources, but no exports or credit", async () => {
    const actor = await owner();
    const source = await createDocument(db, actor.id);
    const created = await createProject(db, actor, {
      title: "x".repeat(120),
      mode: "research",
      versionIds: [source.version.id],
    });
    if (!created.ok) throw new Error(created.code);
    const projectId = created.projectId;
    await saveStudioSettings(db, actor, {
      projectId,
      prompt: PROMPT,
      mode: "research",
      ...SETTINGS,
    });
    await generateOutline(actor, projectId);
    await generateDraft(actor, projectId);
    const saved = await saveProjectRevision(db, actor, projectId);
    if (!saved.ok) throw new Error(saved.code);

    const copyId = await duplicateProject(db, actor, projectId);
    const copy = await getOwnedProject(db, actor, copyId!);
    expect(copy?.title).toHaveLength(120);
    expect(copy?.title.endsWith(" (copy)")).toBe(true);
    expect(copy?.prompt).toBe(PROMPT);
    expect(copy?.outline).toEqual(OUTLINE);
    expect(docSectionIds(copy!.content)).toEqual([S1, S2, S3]);
    expect(copy?.creditOperationKey).toBeNull();
    expect(copy?.revisionCounter).toBe(0);
    expect(await listProjectRevisions(db, copyId!)).toEqual([]);
    expect(await listProjectExports(db, copyId!)).toEqual([]);
    const sources = await db
      .select()
      .from(projectSources)
      .where(eq(projectSources.projectId, copyId!));
    expect(sources.map((row) => row.documentVersionId)).toEqual([source.version.id]);
    expect(await duplicateProject(db, await owner(), projectId)).toBeNull();
  });

  it("deleting stops access at once, queues the exports' files, and cleanup removes the row", async () => {
    const { actor, projectId } = await drafted();
    const revision = await saveProjectRevision(db, actor, projectId);
    if (!revision.ok) throw new Error(revision.code);
    const exported = await requestProjectExport(db, actor, projectId, revision.revision.id);
    if (!exported.ok || exported.reused) throw new Error("export");
    await finishExport(actor, projectId, exported);
    const [{ assetId }] = (await db
      .select({ assetId: projectExports.assetId })
      .from(projectExports)
      .where(eq(projectExports.id, exported.exportId))) as [{ assetId: string }];

    expect(await softDeleteProject(db, actor, projectId)).toEqual({
      deleted: true,
      stoppedJobId: null,
    });
    expect(await getOwnedProject(db, actor, projectId)).toBeNull();
    expect(await getDownloadableExport(db, actor, exported.exportId)).toBeNull();
    expect(
      (await listProjects(db, { userId: actor.id, sort: "updated", limit: 20 })).items,
    ).toEqual([]);
    const [asset] = await db
      .select({ state: assets.state })
      .from(assets)
      .where(eq(assets.id, assetId));
    expect(asset?.state).toBe("deleting");

    // Not yet: the row waits a day, in case of a mistake on our side.
    expect(await purgeDeletedProjects(db)).toBe(0);
    await db.execute(
      sql`update projects set deleted_at = now() - interval '2 days' where id = ${projectId}`,
    );
    expect(await purgeDeletedProjects(db)).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(projects).where(eq(projects.id, projectId))).toEqual([]);
    expect(
      await db.select().from(projectRevisions).where(eq(projectRevisions.projectId, projectId)),
    ).toEqual([]);
  });

  it("deleting a project mid-job stops the job and returns what it holds", async () => {
    const { actor, projectId } = await ready();
    const started = await requestProjectGeneration(db, actor, projectId, { kind: "outline" });
    if (!started.ok) throw new Error(started.code);
    const result = await softDeleteProject(db, actor, projectId);
    expect(result).toEqual({ deleted: true, stoppedJobId: started.jobId });
    await expect(assertProjectJobCanContinue(db, started.jobId, projectId)).rejects.toThrow();
  });

  it("archiving keeps a project readable but stops new work on it", async () => {
    const { actor, projectId } = await drafted();
    await setProjectArchived(db, actor, { projectId, archived: true });
    expect(await requestProjectGeneration(db, actor, projectId, { kind: "outline" })).toEqual({
      ok: false,
      code: "archived",
    });
    const counter = await counterOf(actor, projectId);
    expect(
      await saveProjectContent(db, actor, { projectId, baseCounter: counter, content: doc() }),
    ).toEqual({ ok: false, code: "archived" });
    expect((await getStudioState(db, actor, projectId))?.archived).toBe(true);
    await setProjectArchived(db, actor, { projectId, archived: false });
    expect(
      (await saveProjectContent(db, actor, { projectId, baseCounter: counter, content: doc() })).ok,
    ).toBe(true);
  });

  /* --- Sources ---------------------------------------------------------- */

  it("pins sources, up to five, and an inaccessible one blocks new generation", async () => {
    const { actor, projectId, versionIds } = await ready("research");
    const stranger = await createDocument(db, (await owner()).id);
    expect(
      await addProjectSource(db, actor, { projectId, versionId: stranger.version.id }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await addProjectSource(db, actor, { projectId, versionId: versionIds[0]! })).toEqual({
      ok: false,
      code: "already_added",
    });
    const added: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const source = await createDocument(db, actor.id);
      added.push(source.version.id);
      expect(
        (await addProjectSource(db, actor, { projectId, versionId: source.version.id })).ok,
      ).toBe(true);
    }
    const sixth = await createDocument(db, actor.id);
    expect(await addProjectSource(db, actor, { projectId, versionId: sixth.version.id })).toEqual({
      ok: false,
      code: "source_limit",
    });

    // Deleting one of them blocks generating, with its title kept so it can be found.
    const [firstAdded] = await db
      .select({ documentId: documents.id })
      .from(documents)
      .innerJoin(sql`document_versions v`, sql`v.document_id = ${documents.id}`)
      .where(sql`v.id = ${added[0]}`);
    await deleteDocument(db, actor, firstAdded!.documentId);
    const project = (await getOwnedProject(db, actor, projectId))!;
    expect(await checkProjectSources(db, actor, project)).toEqual({
      ok: false,
      code: "source_unavailable",
    });
    expect(await requestProjectGeneration(db, actor, projectId, { kind: "outline" })).toEqual({
      ok: false,
      code: "source_unavailable",
    });
    const state = await getStudioState(db, actor, projectId);
    expect(state?.sources.find((source) => source.versionId === added[0])).toMatchObject({
      available: false,
      title: "Test document",
    });
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 0, consumed: 0 });

    await removeProjectSource(db, actor, { projectId, versionId: added[0]! });
    expect((await requestProjectGeneration(db, actor, projectId, { kind: "outline" })).ok).toBe(
      true,
    );
  });

  it("a background step re-checks access: a source removed mid-run stops it", async () => {
    const { actor, projectId, versionIds } = await ready("research");
    const context = await loadGenerationContext(db, { projectId, ownerId: actor.id });
    expect(context.sources.map((source) => source.versionId)).toEqual(versionIds);

    const [{ documentId }] = (await db
      .select({ documentId: sql<string>`document_id` })
      .from(sql`document_versions`)
      .where(sql`id = ${versionIds[0]}`)) as [{ documentId: string }];
    await deleteDocument(db, actor, documentId);
    await expect(loadGenerationContext(db, { projectId, ownerId: actor.id })).rejects.toThrow(
      "source_unavailable",
    );

    await db.execute(sql`update users set status = 'suspended' where id = ${actor.id}`);
    await expect(loadGenerationContext(db, { projectId, ownerId: actor.id })).rejects.toThrow(
      "missing",
    );
  });

  it("a catalog book's published version can be a source", async () => {
    const actor = await owner();
    const publisher = await createUser(db);
    const published = await createDocument(db, publisher.id);
    await createBook(db, published.version.id, { published: true });
    const created = await createProject(db, actor, {
      title: "Book report",
      mode: "research",
      versionIds: [published.version.id],
    });
    expect(created.ok).toBe(true);
  });

  /* --- Charges (Section 10) --------------------------------------------- */

  it("one credit covers the first outline and first draft", async () => {
    const { actor, projectId } = await ready();
    expect((await getStudioState(db, actor, projectId))?.charges).toEqual({
      outline: "project",
      draft: "project",
    });
    await generateOutline(actor, projectId);
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 0, consumed: 1 });
    expect((await getStudioState(db, actor, projectId))?.charges.draft).toBe("none");

    await generateDraft(actor, projectId);
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 0, consumed: 1 });
    expect(await usage(actor.id, "section_regenerations")).toEqual({ reserved: 0, consumed: 0 });
    const project = await getOwnedProject(db, actor, projectId);
    expect(project?.status).toBe("editing");
    expect(project?.firstDraftAt).not.toBeNull();
  });

  it("a failed outline returns its credit, and trying again charges only once", async () => {
    const { actor, projectId } = await ready();
    const first = await requestProjectGeneration(db, actor, projectId, { kind: "outline" });
    if (!first.ok) throw new Error(first.code);
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 1, consumed: 0 });

    await failProjectJob(db, {
      jobId: first.jobId,
      projectId,
      usageKey: await usageKeyOf(first.jobId),
      code: "generation_failed",
      markProject: true,
    });
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 0, consumed: 0 });
    expect((await getOwnedProject(db, actor, projectId))?.status).toBe("failed");
    const state = await getStudioState(db, actor, projectId);
    expect(state?.job).toMatchObject({ status: "failed", errorCode: "generation_failed" });

    await generateOutline(actor, projectId);
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 0, consumed: 1 });
  });

  it("committing twice, as a retried step would, charges once", async () => {
    const { actor, projectId } = await ready();
    const started = await requestProjectGeneration(db, actor, projectId, { kind: "outline" });
    if (!started.ok) throw new Error(started.code);
    const key = await usageKeyOf(started.jobId);
    await commitProjectUsage(db, key);
    await commitProjectUsage(db, key);
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 0, consumed: 1 });
  });

  it("repeating the outline or draft, or rewriting a section, spends a regeneration", async () => {
    const { actor, projectId } = await drafted();
    await generateOutline(actor, projectId);
    expect(await usage(actor.id, "section_regenerations")).toEqual({ reserved: 0, consumed: 1 });
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 0, consumed: 1 });

    // A finished draft is only replaced when the owner confirms.
    expect(
      await requestProjectGeneration(db, actor, projectId, { kind: "draft", replace: false }),
    ).toEqual({ ok: false, code: "replace_required" });
    await generateDraft(actor, projectId, true);
    expect(await usage(actor.id, "section_regenerations")).toEqual({ reserved: 0, consumed: 2 });

    const section = await requestProjectGeneration(db, actor, projectId, {
      kind: "section",
      sectionId: S2,
    });
    if (!section.ok) throw new Error(section.code);
    expect(await usage(actor.id, "section_regenerations")).toEqual({ reserved: 1, consumed: 2 });
    const key = await usageKeyOf(section.jobId);
    await saveSectionProposal(db, {
      projectId,
      jobId: section.jobId,
      sectionId: S2,
      nodes: [heading(S2, "Two"), paragraph("Rewritten.")],
    });
    await commitProjectUsage(db, key);
    // Declining keeps the owner's text, and the regeneration stays spent.
    await declineSectionProposal(db, actor, { projectId, sectionId: S2 });
    expect(await usage(actor.id, "section_regenerations")).toEqual({ reserved: 0, consumed: 3 });
  });

  it("a duplicate can't draft for free: it has no credit of its own", async () => {
    const { actor, projectId } = await ready();
    await generateOutline(actor, projectId);
    const copyId = (await duplicateProject(db, actor, projectId))!;
    expect((await getStudioState(db, actor, copyId))?.charges.draft).toBe("project");
    await generateDraft(actor, copyId);
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 0, consumed: 2 });
    // Its first draft spent the credit, so a retry of that doesn't spend another.
    expect((await getOwnedProject(db, actor, copyId))?.creditOperationKey).toMatch(
      /^project-credit:/,
    );
  });

  it("refuses at the limit, charging nothing", async () => {
    const actor = await owner();
    for (let index = 0; index < 2; index += 1) {
      const created = await createProject(db, actor, {
        title: `Report ${index}`,
        mode: "general",
        versionIds: [],
      });
      if (!created.ok) throw new Error(created.code);
      await saveStudioSettings(db, actor, {
        projectId: created.projectId,
        prompt: PROMPT,
        mode: "general",
        ...SETTINGS,
      });
      await generateOutline(actor, created.projectId);
    }
    const third = await createProject(db, actor, {
      title: "Third",
      mode: "general",
      versionIds: [],
    });
    if (!third.ok) throw new Error(third.code);
    await saveStudioSettings(db, actor, {
      projectId: third.projectId,
      prompt: PROMPT,
      mode: "general",
      ...SETTINGS,
    });
    expect(await requestProjectGeneration(db, actor, third.projectId, { kind: "outline" })).toEqual(
      {
        ok: false,
        code: "quota_projects",
      },
    );
    expect((await projectAllowance(db, actor.id)).projects).toEqual({ used: 2, limit: 2 });
    const live = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.targetId, third.projectId), eq(jobs.kind, "generate-outline")));
    expect(live).toEqual([]);
  });

  it("needs a prompt and an outline, and runs one job per project at a time", async () => {
    const actor = await owner();
    const created = await createProject(db, actor, {
      title: "Report",
      mode: "general",
      versionIds: [],
    });
    if (!created.ok) throw new Error(created.code);
    const projectId = created.projectId;
    expect(await requestProjectGeneration(db, actor, projectId, { kind: "outline" })).toEqual({
      ok: false,
      code: "no_prompt",
    });
    await saveStudioSettings(db, actor, {
      projectId,
      prompt: PROMPT,
      mode: "general",
      ...SETTINGS,
    });
    expect(
      await requestProjectGeneration(db, actor, projectId, { kind: "draft", replace: false }),
    ).toEqual({ ok: false, code: "no_outline" });

    const results = await Promise.all(
      [0, 1, 2, 3].map(() => requestProjectGeneration(db, actor, projectId, { kind: "outline" })),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    // The rest are refused, as busy or at the limit depending on how they raced.
    expect(results.filter((result) => !result.ok)).toHaveLength(3);
    // Only the one that started holds a charge.
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 1, consumed: 0 });
    expect(await saveProjectOutline(db, actor, { projectId, outline: OUTLINE })).toEqual({
      ok: false,
      code: "busy",
    });
  });

  it("writes one job, one outbox event and the status together", async () => {
    const { actor, projectId } = await ready();
    const started = await requestProjectGeneration(db, actor, projectId, { kind: "outline" });
    if (!started.ok) throw new Error(started.code);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, started.jobId));
    expect(job).toMatchObject({ kind: "generate-outline", targetId: projectId, status: "queued" });
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventKey, started.eventKey));
    expect(event?.topic).toBe(EVENT_NAMES.projectOutlineRequested);
    expect((await getOwnedProject(db, actor, projectId))?.status).toBe("outline");
  });

  it("cancelling returns the charge, keeps finished sections and can continue", async () => {
    const { actor, projectId } = await ready();
    await generateOutline(actor, projectId);
    const started = await requestProjectGeneration(db, actor, projectId, {
      kind: "draft",
      replace: false,
    });
    if (!started.ok) throw new Error(started.code);
    expect((await getOwnedProject(db, actor, projectId))?.status).toBe("drafting");
    await saveDraftSection(db, {
      projectId,
      jobId: started.jobId,
      section: { sectionId: S1, nodes: [heading(S1, "One"), paragraph("Text.")] },
      outlineIds: [S1, S2, S3],
      done: 1,
      total: 3,
    });

    expect(await requestProjectJobCancel(db, (await owner()).id, started.jobId)).toBeNull();
    const cancelled = await requestProjectJobCancel(db, actor.id, started.jobId);
    expect(cancelled?.eventKey).toBe(`cancel:${started.jobId}`);
    await expect(assertProjectJobCanContinue(db, started.jobId, projectId)).rejects.toThrow(
      "cancelled",
    );
    const project = await getOwnedProject(db, actor, projectId);
    expect(project?.status).toBe("editing");
    expect(docSectionIds(project!.content)).toEqual([S1]);

    // A second one has nothing to cancel, and the rest can still be written.
    expect(await requestProjectJobCancel(db, actor.id, started.jobId)).toBeNull();
    expect(
      (await requestProjectGeneration(db, actor, projectId, { kind: "draft", replace: false })).ok,
    ).toBe(true);
  });

  it("an export still queued can be stopped, returning its charge; a rendering one can't", async () => {
    const { actor, projectId } = await drafted();
    const first = await revisionOf(actor, projectId);
    const done = await requestProjectExport(db, actor, projectId, first.revision.id);
    if (!done.ok || done.reused) throw new Error("export");
    await finishExport(actor, projectId, done);
    await edit(actor, projectId, "Edited");
    const second = await revisionOf(actor, projectId);

    const queued = await requestProjectExport(db, actor, projectId, second.revision.id);
    if (!queued.ok || queued.reused) throw new Error("export");
    expect(await usage(actor.id, "reexports")).toEqual({ reserved: 1, consumed: 0 });
    expect((await getStudioState(db, actor, projectId))?.job?.canCancel).toBe(true);
    expect((await requestProjectJobCancel(db, actor.id, queued.jobId))?.eventKey).toBeDefined();
    expect(await usage(actor.id, "reexports")).toEqual({ reserved: 0, consumed: 0 });
    expect((await getOwnedProject(db, actor, projectId))?.status).toBe("editing");
    const views = await listProjectExports(db, projectId);
    expect(views[0]?.status).toBe("failed");

    const running = await requestProjectExport(db, actor, projectId, second.revision.id);
    if (!running.ok || running.reused) throw new Error("export");
    await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, running.jobId));
    expect((await getStudioState(db, actor, projectId))?.job?.canCancel).toBe(false);
    expect(await requestProjectJobCancel(db, actor.id, running.jobId)).toBeNull();
  });

  it("cancelling a regeneration returns it", async () => {
    const { actor, projectId } = await drafted();
    const started = await requestProjectGeneration(db, actor, projectId, {
      kind: "section",
      sectionId: S1,
    });
    if (!started.ok) throw new Error(started.code);
    await requestProjectJobCancel(db, actor.id, started.jobId);
    expect(await usage(actor.id, "section_regenerations")).toEqual({ reserved: 0, consumed: 0 });
    const [job] = await db.select().from(jobs).where(eq(jobs.id, started.jobId));
    expect(job?.status).toBe("cancelled");
  });

  /* --- Editing ----------------------------------------------------------- */

  it("a stale save changes nothing and reports the conflict", async () => {
    const { actor, projectId } = await drafted();
    const counter = await counterOf(actor, projectId);
    const first = await saveProjectContent(db, actor, {
      projectId,
      baseCounter: counter,
      content: doc(paragraph("Tab one")),
    });
    expect(first).toEqual({ ok: true, counter: counter + 1 });

    const second = await saveProjectContent(db, actor, {
      projectId,
      baseCounter: counter,
      content: doc(paragraph("Tab two")),
    });
    expect(second).toEqual({ ok: false, code: "conflict", counter: counter + 1 });
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(JSON.stringify(row?.editorContent)).toContain("Tab one");
  });

  it("two tabs saving at once: exactly one wins", async () => {
    const { actor, projectId } = await drafted();
    const counter = await counterOf(actor, projectId);
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map((tab) =>
        saveProjectContent(db, actor, {
          projectId,
          baseCounter: counter,
          content: doc(paragraph(`Tab ${tab}`)),
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.code === "conflict")).toHaveLength(4);
  });

  it("another user's save finds nothing", async () => {
    const { actor, projectId } = await drafted();
    expect(
      await saveProjectContent(db, await owner(), {
        projectId,
        baseCounter: await counterOf(actor, projectId),
        content: doc(paragraph("Mine now")),
      }),
    ).toEqual({ ok: false, code: "not_found" });
  });

  it("the editor can't save over a draft being written", async () => {
    const { actor, projectId } = await ready();
    await generateOutline(actor, projectId);
    const started = await requestProjectGeneration(db, actor, projectId, {
      kind: "draft",
      replace: false,
    });
    expect(started.ok).toBe(true);
    expect(
      await saveProjectContent(db, actor, {
        projectId,
        baseCounter: await counterOf(actor, projectId),
        content: doc(paragraph("Typed during drafting")),
      }),
    ).toEqual({ ok: false, code: "busy" });
  });

  it("an edit moves a finished project back to editing", async () => {
    const { actor, projectId } = await drafted();
    await db.update(projects).set({ status: "complete" }).where(eq(projects.id, projectId));
    await saveProjectContent(db, actor, {
      projectId,
      baseCounter: await counterOf(actor, projectId),
      content: doc(paragraph("Edited")),
    });
    expect((await getOwnedProject(db, actor, projectId))?.status).toBe("editing");
  });

  it("the first draft creates revision 1, and revisions are immutable numbered copies", async () => {
    const { actor, projectId } = await drafted();
    expect((await listProjectRevisions(db, projectId)).map((row) => row.revisionNo)).toEqual([1]);

    // Nothing changed: no new revision.
    const same = await saveProjectRevision(db, actor, projectId);
    if (!same.ok) throw new Error(same.code);
    expect(same).toMatchObject({ created: false, revision: { revisionNo: 1 } });

    const counter = await counterOf(actor, projectId);
    await saveProjectContent(db, actor, {
      projectId,
      baseCounter: counter,
      content: doc(paragraph("Second version")),
    });
    const second = await saveProjectRevision(db, actor, projectId);
    if (!second.ok) throw new Error(second.code);
    expect(second).toMatchObject({ created: true, revision: { revisionNo: 2 } });

    // Later edits don't reach a saved revision.
    await saveProjectContent(db, actor, {
      projectId,
      baseCounter: second.counter,
      content: doc(paragraph("Third version")),
    });
    const [stored] = await db
      .select({ content: projectRevisions.content })
      .from(projectRevisions)
      .where(eq(projectRevisions.id, second.revision.id));
    expect(JSON.stringify(stored?.content)).toContain("Second version");
    expect(JSON.stringify(stored?.content)).not.toContain("Third version");
  });

  it("a revision freezes its citations and its sources' titles", async () => {
    const { actor, projectId, versionIds } = await ready("research");
    const versionId = versionIds[0]!;
    const counter = await counterOf(actor, projectId);
    const citation = {
      type: "citation" as const,
      attrs: { label: "x", chunkId: null, versionId, pageStart: 3, pageEnd: 4, draftHash: null },
    };
    await saveProjectContent(db, actor, {
      projectId,
      baseCounter: counter,
      content: doc({ type: "paragraph", content: [{ type: "text", text: "Claim" }, citation] }),
    });
    const saved = await saveProjectRevision(db, actor, projectId);
    if (!saved.ok) throw new Error(saved.code);
    const [row] = await db
      .select()
      .from(projectRevisions)
      .where(eq(projectRevisions.id, saved.revision.id));
    expect(row?.citations).toMatchObject([{ label: "1", versionId, pageStart: 3, pageEnd: 4 }]);
    expect(row?.sourceSnapshot).toEqual([{ versionId, title: "Test document" }]);
    // Numbering was tidied in the editor's copy too.
    expect(JSON.stringify(saved.content)).toContain('"label":"1"');

    await db
      .update(documents)
      .set({ title: "Renamed later" })
      .where(
        sql`${documents.id} = (select document_id from document_versions where id = ${versionId})`,
      );
    const context = await loadExportContext(db, {
      exportId: await exportOf(actor, projectId, saved.revision.id),
      ownerId: actor.id,
      revisionId: saved.revision.id,
    });
    expect(context?.sources).toEqual([{ versionId, title: "Test document" }]);
  });

  async function exportOf(
    actor: { id: string; status: "active" },
    projectId: string,
    revisionId: string,
  ): Promise<string> {
    const exported = await requestProjectExport(db, actor, projectId, revisionId);
    if (!exported.ok) throw new Error(exported.code);
    return exported.exportId;
  }

  it("an empty document has nothing to freeze", async () => {
    const { actor, projectId } = await ready();
    expect(await saveProjectRevision(db, actor, projectId)).toEqual({
      ok: false,
      code: "empty_document",
    });
  });

  it("a proposal never changes the text until accepted, and accepting keeps the old text", async () => {
    const { actor, projectId } = await drafted();
    const started = await requestProjectGeneration(db, actor, projectId, {
      kind: "section",
      sectionId: S2,
    });
    if (!started.ok) throw new Error(started.code);
    const before = await getOwnedProject(db, actor, projectId);
    await saveSectionProposal(db, {
      projectId,
      jobId: started.jobId,
      sectionId: S2,
      nodes: [heading(S2, "Two"), paragraph("Rewritten by the model.")],
    });

    const waiting = await getOwnedProject(db, actor, projectId);
    expect(waiting?.content).toEqual(before?.content);
    expect(waiting?.revisionCounter).toBe(before?.revisionCounter);
    expect(waiting?.proposals.map((item) => item.sectionId)).toEqual([S2]);

    // A stale tab can't accept over edits it hasn't seen.
    expect(
      await acceptSectionProposal(db, actor, {
        projectId,
        sectionId: S2,
        baseCounter: waiting!.revisionCounter - 1,
      }),
    ).toEqual({ ok: false, code: "conflict", counter: waiting!.revisionCounter });
    expect(
      await acceptSectionProposal(db, await owner(), {
        projectId,
        sectionId: S2,
        baseCounter: waiting!.revisionCounter,
      }),
    ).toEqual({ ok: false, code: "not_found" });

    const accepted = await acceptSectionProposal(db, actor, {
      projectId,
      sectionId: S2,
      baseCounter: waiting!.revisionCounter,
    });
    if (!accepted.ok) throw new Error(accepted.code);
    expect(JSON.stringify(accepted.content)).toContain("Rewritten by the model.");
    expect(JSON.stringify(accepted.content)).toContain("Text of One.");
    expect(JSON.stringify(accepted.content)).not.toContain("Text of Two.");
    const after = await getOwnedProject(db, actor, projectId);
    expect(after?.proposals).toEqual([]);

    // The text it replaced is still there as a revision.
    const revisions = await db
      .select({ content: projectRevisions.content })
      .from(projectRevisions)
      .where(eq(projectRevisions.projectId, projectId));
    expect(JSON.stringify(revisions)).toContain("Text of Two.");
  });

  it("declining leaves the owner's text exactly as it was", async () => {
    const { actor, projectId } = await drafted();
    const started = await requestProjectGeneration(db, actor, projectId, {
      kind: "section",
      sectionId: S1,
    });
    if (!started.ok) throw new Error(started.code);
    const before = await getOwnedProject(db, actor, projectId);
    await saveSectionProposal(db, {
      projectId,
      jobId: started.jobId,
      sectionId: S1,
      nodes: [heading(S1, "One"), paragraph("Rewritten.")],
    });
    expect(await declineSectionProposal(db, actor, { projectId, sectionId: S1 })).toBe(true);
    const after = await getOwnedProject(db, actor, projectId);
    expect(after?.content).toEqual(before?.content);
    expect(after?.proposals).toEqual([]);
  });

  it("redrafting keeps the current text as a revision first", async () => {
    const { actor, projectId } = await drafted();
    await saveProjectContent(db, actor, {
      projectId,
      baseCounter: await counterOf(actor, projectId),
      content: doc(heading(S1, "One"), paragraph("My careful edit")),
    });
    await generateDraft(actor, projectId, true);
    const project = await getOwnedProject(db, actor, projectId);
    expect(JSON.stringify(project?.content)).not.toContain("My careful edit");
    const revisions = await db
      .select({ content: projectRevisions.content })
      .from(projectRevisions)
      .where(eq(projectRevisions.projectId, projectId));
    expect(JSON.stringify(revisions)).toContain("My careful edit");
  });

  it("restoring a revision keeps the current text as another", async () => {
    const { actor, projectId } = await drafted();
    const [first] = await listProjectRevisions(db, projectId);
    await saveProjectContent(db, actor, {
      projectId,
      baseCounter: await counterOf(actor, projectId),
      content: doc(paragraph("Unsaved thoughts")),
    });
    const restored = await restoreProjectRevision(db, actor, {
      projectId,
      revisionId: first!.id,
      baseCounter: await counterOf(actor, projectId),
    });
    if (!restored.ok) throw new Error(restored.code);
    expect(JSON.stringify(restored.content)).toContain("Text of One.");
    const revisions = await listProjectRevisions(db, projectId);
    expect(revisions.map((row) => row.revisionNo)).toEqual([2, 1]);
    const [kept] = await db
      .select({ content: projectRevisions.content })
      .from(projectRevisions)
      .where(eq(projectRevisions.id, revisions[0]!.id));
    expect(JSON.stringify(kept?.content)).toContain("Unsaved thoughts");
  });

  it("either conflict choice keeps the other version as a revision", async () => {
    const { actor, projectId } = await drafted();
    await saveProjectContent(db, actor, {
      projectId,
      baseCounter: await counterOf(actor, projectId),
      content: doc(paragraph("Other tab")),
    });

    const kept = await overwriteAfterConflict(db, actor, {
      projectId,
      content: doc(paragraph("This tab")),
    });
    if (!kept.ok) throw new Error(kept.code);
    expect(JSON.stringify((await getOwnedProject(db, actor, projectId))?.content)).toContain(
      "This tab",
    );
    let revisions = await db
      .select({ content: projectRevisions.content })
      .from(projectRevisions)
      .where(eq(projectRevisions.projectId, projectId));
    expect(JSON.stringify(revisions)).toContain("Other tab");

    const theirs = await keepTextAsRevision(db, actor, {
      projectId,
      content: doc(paragraph("Unsaved here")),
    });
    if (!theirs.ok) throw new Error(theirs.code);
    expect(JSON.stringify(theirs.content)).toContain("This tab");
    revisions = await db
      .select({ content: projectRevisions.content })
      .from(projectRevisions)
      .where(eq(projectRevisions.projectId, projectId));
    expect(JSON.stringify(revisions)).toContain("Unsaved here");
  });

  it("a retried draft fills in only what's missing", async () => {
    const { actor, projectId } = await ready();
    await generateOutline(actor, projectId);
    const first = await requestProjectGeneration(db, actor, projectId, {
      kind: "draft",
      replace: false,
    });
    if (!first.ok) throw new Error(first.code);
    await saveDraftSection(db, {
      projectId,
      jobId: first.jobId,
      section: { sectionId: S2, nodes: [heading(S2, "Two"), paragraph("Second")] },
      outlineIds: [S1, S2, S3],
      done: 1,
      total: 3,
    });
    await failProjectJob(db, {
      jobId: first.jobId,
      projectId,
      usageKey: null,
      code: "provider_unavailable",
      markProject: true,
    });
    const project = await getOwnedProject(db, actor, projectId);
    expect(project?.status).toBe("failed");
    expect(docSectionIds(project!.content)).toEqual([S2]);
    expect((await getStudioState(db, actor, projectId))?.job?.canRetry).toBe(true);

    // Writing the same section twice replaces it, so a retried step can't duplicate it.
    const retried = await requestProjectGeneration(db, actor, projectId, {
      kind: "draft",
      replace: false,
    });
    if (!retried.ok) throw new Error(retried.code);
    await saveDraftSection(db, {
      projectId,
      jobId: retried.jobId,
      section: { sectionId: S1, nodes: [heading(S1, "One"), paragraph("First")] },
      outlineIds: [S1, S2, S3],
      done: 2,
      total: 3,
    });
    await saveDraftSection(db, {
      projectId,
      jobId: retried.jobId,
      section: { sectionId: S1, nodes: [heading(S1, "One"), paragraph("First, again")] },
      outlineIds: [S1, S2, S3],
      done: 2,
      total: 3,
    });
    const after = await getOwnedProject(db, actor, projectId);
    expect(docSectionIds(after!.content)).toEqual([S1, S2]);
    expect(JSON.stringify(after?.content)).toContain("First, again");
    expect(await usage(actor.id, "generated_projects")).toEqual({ reserved: 0, consumed: 1 });
  });

  /* --- Exports ----------------------------------------------------------- */

  async function revisionOf(actor: { id: string; status: "active" }, projectId: string) {
    const saved = await saveProjectRevision(db, actor, projectId);
    if (!saved.ok) throw new Error(saved.code);
    return saved;
  }

  async function edit(actor: { id: string; status: "active" }, projectId: string, text: string) {
    const saved = await saveProjectContent(db, actor, {
      projectId,
      baseCounter: await counterOf(actor, projectId),
      content: doc(heading(S1, "One"), paragraph(text)),
    });
    if (!saved.ok) throw new Error(saved.code);
  }

  it("the first export comes with the project; edited text spends a re-export", async () => {
    const { actor, projectId } = await drafted();
    const first = await revisionOf(actor, projectId);
    expect(await exportChargeFor(db, projectId, first.revision.id)).toBe("none");
    const exported = await requestProjectExport(db, actor, projectId, first.revision.id);
    if (!exported.ok || exported.reused) throw new Error("export");
    expect(await usage(actor.id, "reexports")).toEqual({ reserved: 0, consumed: 0 });
    expect((await getOwnedProject(db, actor, projectId))?.status).toBe("rendering");
    expect(await finishExport(actor, projectId, exported)).toBe(true);
    expect((await getOwnedProject(db, actor, projectId))?.status).toBe("complete");

    // The same revision and template: its file, no job, no charge.
    const again = await requestProjectExport(db, actor, projectId, first.revision.id);
    expect(again).toEqual({ ok: true, exportId: exported.exportId, reused: true });

    await edit(actor, projectId, "Edited text");
    const second = await revisionOf(actor, projectId);
    expect(await exportChargeFor(db, projectId, second.revision.id)).toBe("reexport");
    const reexport = await requestProjectExport(db, actor, projectId, second.revision.id);
    if (!reexport.ok || reexport.reused) throw new Error("export");
    expect(await usage(actor.id, "reexports")).toEqual({ reserved: 1, consumed: 0 });
    await finishExport(actor, projectId, reexport);
    expect(await usage(actor.id, "reexports")).toEqual({ reserved: 0, consumed: 1 });
  });

  it("a different template of the same revision isn't edited content", async () => {
    const { actor, projectId } = await drafted();
    const first = await revisionOf(actor, projectId);
    const exported = await requestProjectExport(db, actor, projectId, first.revision.id);
    if (!exported.ok || exported.reused) throw new Error("export");
    await finishExport(actor, projectId, exported);
    await saveStudioSettings(db, actor, {
      projectId,
      prompt: PROMPT,
      mode: "general",
      ...SETTINGS,
      template: "study-notes",
    });
    const notes = await requestProjectExport(db, actor, projectId, first.revision.id);
    if (!notes.ok || notes.reused) throw new Error("export");
    expect(await usage(actor.id, "reexports")).toEqual({ reserved: 0, consumed: 0 });
    const [row] = await db
      .select({ templateVersion: projectExports.templateVersion })
      .from(projectExports)
      .where(eq(projectExports.id, notes.exportId));
    expect(row?.templateVersion).toBe("study-notes@1");
  });

  it("a failed export returns its re-export, and trying again charges once", async () => {
    const { actor, projectId } = await drafted();
    const first = await revisionOf(actor, projectId);
    const exported = await requestProjectExport(db, actor, projectId, first.revision.id);
    if (!exported.ok || exported.reused) throw new Error("export");
    await finishExport(actor, projectId, exported);
    await edit(actor, projectId, "Edited");
    const second = await revisionOf(actor, projectId);

    const failing = await requestProjectExport(db, actor, projectId, second.revision.id);
    if (!failing.ok || failing.reused) throw new Error("export");
    expect(await usage(actor.id, "reexports")).toEqual({ reserved: 1, consumed: 0 });
    await failExport(db, {
      exportId: failing.exportId,
      jobId: failing.jobId,
      projectId,
      usageKey: await usageKeyOf(failing.jobId),
      code: "export_failed",
    });
    expect(await usage(actor.id, "reexports")).toEqual({ reserved: 0, consumed: 0 });
    expect((await getOwnedProject(db, actor, projectId))?.status).toBe("failed");
    const views = await listProjectExports(db, projectId);
    expect(views[0]).toMatchObject({
      status: "failed",
      errorMessage: expect.stringContaining("couldn't render"),
    });

    const retried = await requestProjectExport(db, actor, projectId, second.revision.id);
    if (!retried.ok || retried.reused) throw new Error("export");
    await finishExport(actor, projectId, retried);
    expect(await usage(actor.id, "reexports")).toEqual({ reserved: 0, consumed: 1 });
  });

  it("re-exports stop at the limit", async () => {
    const { actor, projectId } = await drafted();
    const first = await revisionOf(actor, projectId);
    const exported = await requestProjectExport(db, actor, projectId, first.revision.id);
    if (!exported.ok || exported.reused) throw new Error("export");
    await finishExport(actor, projectId, exported);
    await db
      .insert(usageBuckets)
      .values({
        userId: actor.id,
        metric: "reexports",
        periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
        periodEnd: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)),
        limit: 10,
        consumed: 10,
      })
      .onConflictDoNothing();
    await edit(actor, projectId, "Edited");
    const second = await revisionOf(actor, projectId);
    expect(await requestProjectExport(db, actor, projectId, second.revision.id)).toEqual({
      ok: false,
      code: "quota_reexports",
    });
    expect((await getOwnedProject(db, actor, projectId))?.status).toBe("editing");
    expect(
      await db
        .select()
        .from(usageOperations)
        .where(
          sql`operation_key like 'project-reexport:%' and status = 'reserved' and bucket_id in (select id from usage_buckets where user_id = ${actor.id})`,
        ),
    ).toEqual([]);
  });

  it("only exports the exact revision asked for, and only the project's own", async () => {
    const { actor, projectId } = await drafted();
    const first = await revisionOf(actor, projectId);
    await edit(actor, projectId, "Editor text after the revision");
    const exported = await requestProjectExport(db, actor, projectId, first.revision.id);
    if (!exported.ok || exported.reused) throw new Error("export");
    const context = await loadExportContext(db, {
      exportId: exported.exportId,
      ownerId: actor.id,
      revisionId: first.revision.id,
    });
    expect(JSON.stringify(context?.content)).toContain("Text of One.");
    expect(JSON.stringify(context?.content)).not.toContain("Editor text after the revision");
    expect(context?.templateVersion).toBe("academic-report@1");
    expect(
      await loadExportContext(db, {
        exportId: exported.exportId,
        ownerId: (await owner()).id,
        revisionId: first.revision.id,
      }),
    ).toBeNull();

    const other = await drafted();
    const otherRevision = await revisionOf(other.actor, other.projectId);
    expect(await requestProjectExport(db, other.actor, other.projectId, first.revision.id)).toEqual(
      { ok: false, code: "no_revision" },
    );
    expect(await requestProjectExport(db, actor, projectId, otherRevision.revision.id)).toEqual({
      ok: false,
      code: "busy",
    });
  });

  it("only the owner can download, and only a finished file", async () => {
    const { actor, projectId } = await drafted();
    const revision = await revisionOf(actor, projectId);
    const exported = await requestProjectExport(db, actor, projectId, revision.revision.id);
    if (!exported.ok || exported.reused) throw new Error("export");
    expect(await getDownloadableExport(db, actor, exported.exportId)).toBeNull();
    await finishExport(actor, projectId, exported);
    expect(await getDownloadableExport(db, actor, exported.exportId)).toMatchObject({
      title: "Harbor report",
      bytes: 1000,
    });
    const admin = { id: (await createUser(db, { role: "admin" })).id, status: "active" as const };
    expect(await getDownloadableExport(db, await owner(), exported.exportId)).toBeNull();
    expect(await getDownloadableExport(db, admin, exported.exportId)).toBeNull();
    expect(await deleteProjectExport(db, await owner(), exported.exportId)).toBe(false);
  });

  it("exports count toward storage, and over the limit nothing is kept", async () => {
    const { actor, projectId } = await drafted();
    const revision = await revisionOf(actor, projectId);
    const exported = await requestProjectExport(db, actor, projectId, revision.revision.id);
    if (!exported.ok || exported.reused) throw new Error("export");
    const huge = 200 * 1024 * 1024;
    expect(await finishExport(actor, projectId, exported, huge)).toBe(false);
    expect(await getDownloadableExport(db, actor, exported.exportId)).toBeNull();

    // At the limit, a new export isn't even queued.
    await db.insert(assets).values({
      ownerId: actor.id,
      fileKey: `full-${randomUUID()}`,
      customId: `full-${randomUUID()}`,
      fileRoute: "sourcePdf",
      acl: "public",
      purpose: "source",
      bytes: 101 * 1024 * 1024,
      mimeType: "application/pdf",
      state: "ready",
    });
    await failExport(db, {
      exportId: exported.exportId,
      jobId: exported.jobId,
      projectId,
      usageKey: null,
      code: "storage_limit",
    });
    expect(await requestProjectExport(db, actor, projectId, revision.revision.id)).toEqual({
      ok: false,
      code: "storage_limit",
    });
  });

  it("a retried completion stores one asset", async () => {
    const { actor, projectId } = await drafted();
    const revision = await revisionOf(actor, projectId);
    const exported = await requestProjectExport(db, actor, projectId, revision.revision.id);
    if (!exported.ok || exported.reused) throw new Error("export");
    const file = { key: `export-${randomUUID()}`, size: 500 };
    const input = {
      exportId: exported.exportId,
      jobId: exported.jobId,
      projectId,
      ownerId: actor.id,
      operationKey: exported.eventKey,
      file,
      checksum: "abc",
      pageCount: 2,
      acl: "public" as const,
      metrics: {},
    };
    await completeExport(db, input);
    await completeExport(db, input);
    const rows = await db.select().from(assets).where(eq(assets.fileKey, file.key));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: "export", checksum: "abc", state: "ready" });
    const views = await listProjectExports(db, projectId);
    expect(views[0]).toMatchObject({ status: "ready", pageCount: 2, bytes: 500, revisionNo: 1 });
  });

  it("deleting an export removes the record and queues its file", async () => {
    const { actor, projectId } = await drafted();
    const revision = await revisionOf(actor, projectId);
    const exported = await requestProjectExport(db, actor, projectId, revision.revision.id);
    if (!exported.ok || exported.reused) throw new Error("export");
    await finishExport(actor, projectId, exported);
    const [row] = await db
      .select({ assetId: projectExports.assetId })
      .from(projectExports)
      .where(eq(projectExports.id, exported.exportId));
    expect(await deleteProjectExport(db, actor, exported.exportId)).toBe(true);
    expect(await listProjectExports(db, projectId)).toEqual([]);
    const [asset] = await db
      .select({ state: assets.state })
      .from(assets)
      .where(eq(assets.id, row!.assetId!));
    expect(asset?.state).toBe("deleting");
  });

  /* --- Notices and the Studio read --------------------------------------- */

  it("project notices carry the project's title and link, respect the switch and skip deleted ones", async () => {
    const { actor, projectId } = await drafted();
    expect(
      await createNotification(db, {
        userId: actor.id,
        type: "export_ready",
        subjectId: projectId,
        eventKey: "export_ready:1",
      }),
    ).toEqual({ created: true });
    const { items } = await listNotifications(db, actor.id, { limit: 10 });
    expect(items[0]).toMatchObject({
      title: "Your PDF is ready.",
      targetPath: `/dashboard/projects/${projectId}`,
    });
    expect(items[0]?.body).toContain("Harbor report");

    // Someone else's project is never named in a notice.
    expect(
      await createNotification(db, {
        userId: (await owner()).id,
        type: "export_ready",
        subjectId: projectId,
        eventKey: "export_ready:2",
      }),
    ).toEqual({ created: false, skipped: "subject_gone" });
    await softDeleteProject(db, actor, projectId);
    expect(
      await createNotification(db, {
        userId: actor.id,
        type: "export_ready",
        subjectId: projectId,
        eventKey: "export_ready:3",
      }),
    ).toEqual({ created: false, skipped: "subject_gone" });
  });

  it("the Studio read leaves out a document the client already holds", async () => {
    const { actor, projectId } = await drafted();
    const state = await getStudioState(db, actor, projectId);
    expect(state?.content).not.toBeNull();
    const same = await getStudioState(db, actor, projectId, {
      knownCounter: state?.revisionCounter,
    });
    expect(same?.content).toBeNull();
    const older = await getStudioState(db, actor, projectId, { knownCounter: 0 });
    expect(older?.content).not.toBeNull();
    expect(readOutline(state?.outline)).toEqual(OUTLINE);
    expect(readProjectDoc(state?.content)).toEqual(renumberCitations(state!.content!));
  });
});
