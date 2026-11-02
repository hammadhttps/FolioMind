"use client";

import "pdfjs-dist/web/pdf_viewer.css";
import type { HighlightColor, ReadingProgressInput } from "@foliomind/contracts";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  MessageSquareText,
  PanelLeft,
  Search,
  StickyNote,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { saveProgressAction } from "@/lib/reader/actions";
import type { AnnotationItem } from "@/lib/reader/view";
import { cn } from "@/lib/utils";
import { StatusAlert } from "../status-alert";
import { anchorFromSelection, type SelectionAnchor } from "./anchors";

/*
 * The PDF.js reader (blueprint Sections 7, 8 and 19): the file loads from the
 * delivery URL the access route returns (FolioMind's authorized streaming
 * route, which re-checks access on every range request); PDF.js's own
 * viewer provides pages, text layer, links and find. Highlights are drawn from
 * stored page fractions on every render, and reading progress is saved while
 * reading and when the page is hidden. Embedded scripts never run: no
 * scripting manager is attached, and XFA forms are off.
 */

/** cMaps, standard fonts and image decoders, fetched only for PDFs that need them. */
const PDFJS_ASSETS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/";
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const HIGHLIGHT_LABELS: Record<HighlightColor, string> = {
  yellow: "Yellow",
  mint: "Mint",
  lavender: "Lavender",
};

export interface ReaderApi {
  goToPage: (page: number) => void;
  /** The current text selection as an anchor, if any. */
  selection: () => SelectionAnchor | null;
  clearSelection: () => void;
}

export interface SavedPosition {
  pageNumber: number;
  position: ReadingProgressInput["position"];
}

type LoadState =
  { kind: "loading" } | { kind: "ready" } | { kind: "error"; title: string; message: string };

interface Viewer {
  pdf: PDFDocumentProxy;
  viewer: PDFViewer;
  eventBus: EventBus;
}

export function PdfReader({
  documentId,
  highlights,
  initialPosition,
  aiUnavailableReason,
  onPageChange,
  onHighlight,
  onNote,
  apiRef,
  preview = false,
}: {
  documentId: string;
  /** Annotations that carry rectangles: highlights and selection notes. */
  highlights: AnnotationItem[];
  initialPosition: SavedPosition | null;
  aiUnavailableReason: string;
  onPageChange: (page: number, pageCount: number) => void;
  onHighlight: (anchor: SelectionAnchor, color: HighlightColor) => void;
  onNote: (anchor: SelectionAnchor | null) => void;
  apiRef?: Ref<ReaderApi>;
  preview?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElementRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const highlightsRef = useRef(highlights);
  const [state, setState] = useState<LoadState>(
    preview
      ? {
          kind: "error",
          title: "Preview only",
          message: "The gallery has no document file to show.",
        }
      : { kind: "loading" },
  );
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [loadedPdf, setLoadedPdf] = useState<PDFDocumentProxy | null>(null);
  const [scaleLabel, setScaleLabel] = useState("100%");
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{ current: number; total: number } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selection, setSelection] = useState<{
    anchor: SelectionAnchor;
    top: number;
    left: number;
  } | null>(null);
  const findInput = useRef<HTMLInputElement>(null);

  /* --- Highlights ------------------------------------------------------ */

  const paint = useCallback((pageNumber: number) => {
    const pageView = viewerRef.current?.viewer.getPageView(pageNumber - 1) as
      { div?: HTMLDivElement } | undefined;
    const pageDiv = pageView?.div;
    if (!pageDiv) return;
    pageDiv.querySelector(":scope > .fm-highlight-layer")?.remove();
    const items = highlightsRef.current.filter(
      (item) => item.pageNumber === pageNumber && item.anchor.rects?.length,
    );
    if (items.length === 0) return;
    const layer = document.createElement("div");
    layer.className = "fm-highlight-layer";
    layer.setAttribute("aria-hidden", "true");
    for (const item of items) {
      for (const rect of item.anchor.rects ?? []) {
        const mark = document.createElement("div");
        mark.className = "fm-highlight";
        mark.dataset.color = item.color ?? "yellow";
        mark.style.left = `${rect.x * 100}%`;
        mark.style.top = `${rect.y * 100}%`;
        mark.style.width = `${rect.w * 100}%`;
        mark.style.height = `${rect.h * 100}%`;
        layer.append(mark);
      }
    }
    // Above the canvas, below the selectable text layer.
    const canvasWrapper = pageDiv.querySelector(":scope > .canvasWrapper");
    if (canvasWrapper) canvasWrapper.after(layer);
    else pageDiv.prepend(layer);
  }, []);

  useEffect(() => {
    highlightsRef.current = highlights;
    const current = viewerRef.current;
    if (!current) return;
    for (let n = 1; n <= current.pdf.numPages; n += 1) paint(n);
  }, [highlights, paint]);

  /* --- Progress -------------------------------------------------------- */

  const positionNow = useCallback((): SavedPosition | null => {
    const current = viewerRef.current;
    const container = containerRef.current;
    if (!current || !container) return null;
    const pageNumber = current.viewer.currentPageNumber;
    const pageDiv = (
      current.viewer.getPageView(pageNumber - 1) as { div?: HTMLDivElement } | undefined
    )?.div;
    const offset = pageDiv
      ? Math.min(1, Math.max(0, (container.scrollTop - pageDiv.offsetTop) / pageDiv.offsetHeight))
      : 0;
    const value = current.viewer.currentScaleValue;
    const named = ["page-width", "page-fit", "auto"] as const;
    const scale = (named as readonly string[]).includes(value)
      ? (value as (typeof named)[number])
      : Math.min(10, Math.max(0.1, current.viewer.currentScale));
    return { pageNumber, position: { scale, offset, pageCount: current.pdf.numPages } };
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    if (preview) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const position = positionNow();
      if (position) void saveProgressAction({ documentId, ...position }).catch(() => {});
    }, 2500);
  }, [documentId, positionNow, preview]);

  useEffect(() => {
    if (preview) return;
    // Server Actions cannot run during unload; the beacon route takes the last position.
    function flush() {
      const position = positionNow();
      if (!position) return;
      navigator.sendBeacon(
        `/api/documents/${documentId}/progress`,
        new Blob([JSON.stringify(position)], { type: "application/json" }),
      );
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [documentId, positionNow, preview]);

  /* --- Loading ---------------------------------------------------------- */

  useEffect(() => {
    if (preview) return;
    const container = containerRef.current;
    const viewerElement = viewerElementRef.current;
    if (!container || !viewerElement) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;

    (async () => {
      const response = await fetch(`/api/documents/${documentId}/access`, { cache: "no-store" });
      if (!response.ok) {
        setState({
          kind: "error",
          title: "We couldn't open this document.",
          message:
            response.status === 404
              ? "It may have been deleted, or you no longer have access to it."
              : "Please try again in a moment.",
        });
        return;
      }
      const { url } = (await response.json()) as { url: string };
      // The viewer module reads the library from globalThis.pdfjsLib, so it loads second.
      const pdfjs = await import("pdfjs-dist/webpack.mjs");
      const global = globalThis as typeof globalThis & { pdfjsLib?: unknown };
      global.pdfjsLib ??= pdfjs;
      const viewerModule = await import("pdfjs-dist/web/pdf_viewer.mjs");
      if (cancelled) return;

      const eventBus = new viewerModule.EventBus();
      const linkService = new viewerModule.PDFLinkService({
        eventBus,
        externalLinkTarget: viewerModule.LinkTarget.BLANK,
        externalLinkRel: "noopener noreferrer nofollow",
      });
      const findController = new viewerModule.PDFFindController({ eventBus, linkService });
      const viewer = new viewerModule.PDFViewer({
        container,
        viewer: viewerElement,
        eventBus,
        linkService,
        findController,
        textLayerMode: 1,
      });
      linkService.setViewer(viewer);

      const task = pdfjs.getDocument({
        url,
        cMapUrl: `${PDFJS_ASSETS}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
        wasmUrl: `${PDFJS_ASSETS}wasm/`,
        enableXfa: false,
        // Large chunks keep range requests well inside the read rate limit.
        rangeChunkSize: 1024 * 1024,
      });
      task.onPassword = () => {
        setState({
          kind: "error",
          title: "This PDF is password-protected.",
          message:
            "FolioMind can only open PDFs without a password. Remove it and upload the file again.",
        });
        void task.destroy();
      };
      destroy = () => {
        viewer.setDocument(null as unknown as PDFDocumentProxy);
        void task.destroy();
      };

      const pdf = await task.promise;
      if (cancelled) return;
      viewer.setDocument(pdf);
      linkService.setDocument(pdf, null);
      viewerRef.current = { pdf, viewer, eventBus };

      eventBus.on("pagesinit", () => {
        if (initialPosition) {
          const { scale } = initialPosition.position;
          if (typeof scale === "number") viewer.currentScale = scale;
          else viewer.currentScaleValue = scale;
          viewer.currentPageNumber = Math.min(initialPosition.pageNumber, pdf.numPages);
          const pageDiv = (
            viewer.getPageView(viewer.currentPageNumber - 1) as { div?: HTMLDivElement }
          )?.div;
          if (pageDiv)
            container.scrollTop =
              pageDiv.offsetTop + initialPosition.position.offset * pageDiv.offsetHeight;
        } else {
          viewer.currentScaleValue = "page-width";
        }
        setPageCount(pdf.numPages);
        setLoadedPdf(pdf);
        setState({ kind: "ready" });
      });
      eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
        setPage(pageNumber);
        onPageChange(pageNumber, pdf.numPages);
        scheduleSave();
      });
      eventBus.on("scalechanging", ({ scale }: { scale: number }) => {
        setScaleLabel(`${Math.round(scale * 100)}%`);
        scheduleSave();
      });
      eventBus.on("textlayerrendered", ({ pageNumber }: { pageNumber: number }) =>
        paint(pageNumber),
      );
      eventBus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => paint(pageNumber));
      eventBus.on(
        "updatefindmatchescount",
        ({ matchesCount }: { matchesCount: { current: number; total: number } }) =>
          setMatches(matchesCount),
      );
      eventBus.on(
        "updatefindcontrolstate",
        ({
          state: findState,
          matchesCount,
        }: {
          state: number;
          matchesCount?: { current: number; total: number };
        }) => {
          setNotFound(findState === viewerModule.FindState.NOT_FOUND);
          if (matchesCount) setMatches(matchesCount);
        },
      );
      onPageChange(1, pdf.numPages);
    })().catch(() => {
      if (cancelled) return;
      setState({
        kind: "error",
        title: "We couldn't open this document.",
        message: "The file couldn't be read. If it keeps happening, try uploading it again.",
      });
    });

    return () => {
      cancelled = true;
      viewerRef.current = null;
      destroy?.();
    };
    // The document loads once per page view; later prop changes are handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, preview]);

  /* --- Controls -------------------------------------------------------- */

  const goToPage = useCallback((target: number) => {
    const current = viewerRef.current;
    if (!current) return;
    current.viewer.currentPageNumber = Math.min(Math.max(1, target), current.pdf.numPages);
  }, []);

  function zoom(direction: 1 | -1) {
    const current = viewerRef.current;
    if (!current) return;
    const scale = current.viewer.currentScale;
    const next =
      direction > 0
        ? (ZOOM_STEPS.find((step) => step > scale + 0.001) ?? ZOOM_STEPS.at(-1)!)
        : ([...ZOOM_STEPS].reverse().find((step) => step < scale - 0.001) ?? ZOOM_STEPS[0]!);
    current.viewer.currentScale = next;
  }

  function fitWidth() {
    if (viewerRef.current) viewerRef.current.viewer.currentScaleValue = "page-width";
  }

  function find(previous = false, again = false) {
    viewerRef.current?.eventBus.dispatch("find", {
      source: null,
      type: again ? "again" : "",
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  }

  function openFind() {
    setFindOpen(true);
    requestAnimationFrame(() => findInput.current?.select());
  }

  function closeFind() {
    setFindOpen(false);
    setMatches(null);
    setNotFound(false);
    viewerRef.current?.eventBus.dispatch("findbarclose", { source: null });
  }

  useImperativeHandle(
    apiRef,
    () => ({
      goToPage,
      selection: () =>
        containerRef.current
          ? anchorFromSelection(containerRef.current, window.getSelection())
          : null,
      clearSelection: () => {
        window.getSelection()?.removeAllRanges();
        setSelection(null);
      },
    }),
    [goToPage],
  );

  // Keyboard: n/j next page, p/k previous page, / or Ctrl/Cmd+F to find.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']") !==
        null;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openFind();
        return;
      }
      if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "n" || event.key === "j") goToPage(page + 1);
      else if (event.key === "p" || event.key === "k") goToPage(page - 1);
      else if (event.key === "/") {
        event.preventDefault();
        openFind();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToPage, page]);

  // The selection toolbar follows the current selection inside the document.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function update() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const container = containerRef.current;
        const frame = frameRef.current;
        const selected = window.getSelection();
        const anchor = container ? anchorFromSelection(container, selected) : null;
        if (!anchor || !frame || !selected || selected.rangeCount === 0) {
          setSelection(null);
          return;
        }
        const rects = selected.getRangeAt(0).getClientRects();
        const last = rects[rects.length - 1];
        const box = frame.getBoundingClientRect();
        if (!last) return;
        setSelection({
          anchor,
          top: Math.min(box.height - 56, Math.max(8, last.bottom - box.top + 8)),
          left: Math.min(box.width - 300, Math.max(8, last.left - box.left)),
        });
      }, 200);
    }
    document.addEventListener("selectionchange", update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", update);
    };
  }, []);

  /* --- Render ------------------------------------------------------------ */

  const ready = state.kind === "ready";
  return (
    <section
      aria-label="Document"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-reader-chrome"
    >
      <div
        role="toolbar"
        aria-label="Document tools"
        className="flex items-center gap-1 overflow-x-auto border-b bg-card px-2 py-1.5"
      >
        <ToolButton
          label={showThumbnails ? "Hide thumbnails" : "Show thumbnails"}
          pressed={showThumbnails}
          disabled={!ready}
          onClick={() => setShowThumbnails((value) => !value)}
        >
          <PanelLeft />
        </ToolButton>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <ToolButton
          label="Previous page"
          shortcut="P"
          disabled={!ready || page <= 1}
          onClick={() => goToPage(page - 1)}
        >
          <ChevronLeft />
        </ToolButton>
        <PageInput page={page} pageCount={pageCount} disabled={!ready} onGo={goToPage} />
        <ToolButton
          label="Next page"
          shortcut="N"
          disabled={!ready || page >= pageCount}
          onClick={() => goToPage(page + 1)}
        >
          <ChevronRight />
        </ToolButton>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <ToolButton label="Zoom out" disabled={!ready} onClick={() => zoom(-1)}>
          <ZoomOut />
        </ToolButton>
        <button
          type="button"
          onClick={fitWidth}
          disabled={!ready}
          aria-label={`Zoom ${scaleLabel}. Fit to width`}
          className="min-w-14 rounded-md px-1 text-sm text-muted-foreground tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/70 disabled:opacity-50"
        >
          {scaleLabel}
        </button>
        <ToolButton label="Zoom in" disabled={!ready} onClick={() => zoom(1)}>
          <ZoomIn />
        </ToolButton>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <ToolButton
          label="Find in document"
          shortcut="/"
          pressed={findOpen}
          disabled={!ready}
          onClick={() => (findOpen ? closeFind() : openFind())}
        >
          <Search />
        </ToolButton>
      </div>

      {findOpen ? (
        <form
          role="search"
          className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            find(false, true);
          }}
        >
          <Input
            ref={findInput}
            value={query}
            aria-label="Find in document"
            placeholder="Find in document"
            className="h-9 max-w-64"
            onChange={(event) => {
              setQuery(event.target.value);
              viewerRef.current?.eventBus.dispatch("find", {
                source: null,
                type: "",
                query: event.target.value,
                caseSensitive: false,
                entireWord: false,
                highlightAll: true,
                findPrevious: false,
                matchDiacritics: false,
              });
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeFind();
              if (event.key === "Enter" && event.shiftKey) {
                event.preventDefault();
                find(true, true);
              }
            }}
          />
          <ToolButton label="Previous match" disabled={!query} onClick={() => find(true, true)}>
            <ChevronUp />
          </ToolButton>
          <ToolButton label="Next match" disabled={!query} onClick={() => find(false, true)}>
            <ChevronDown />
          </ToolButton>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {query && notFound
              ? "No matches"
              : query && matches && matches.total > 0
                ? `${matches.current} of ${matches.total}`
                : ""}
          </p>
          <ToolButton label="Close find" onClick={closeFind} className="ml-auto">
            <X />
          </ToolButton>
        </form>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {showThumbnails && loadedPdf ? (
          <Thumbnails pdf={loadedPdf} current={page} onSelect={goToPage} />
        ) : null}
        <div ref={frameRef} className="relative min-h-0 min-w-0 flex-1">
          <div
            ref={containerRef}
            className="absolute inset-0 overflow-auto"
            tabIndex={0}
            aria-label="Document pages"
            onScroll={() => {
              setSelection(null);
              scheduleSave();
            }}
          >
            <div ref={viewerElementRef} className="pdfViewer py-3" />
          </div>

          {state.kind === "loading" ? (
            <div
              className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Spinner aria-hidden="true" />
              Opening your document…
            </div>
          ) : null}
          {state.kind === "error" ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <StatusAlert
                tone={preview ? "info" : "error"}
                title={state.title}
                className="max-w-md bg-card"
              >
                {state.message}
              </StatusAlert>
            </div>
          ) : null}

          {selection ? (
            <div
              role="toolbar"
              aria-label="Selected text"
              className="absolute z-20 flex items-center gap-1 rounded-xl border bg-card p-1 shadow-lg"
              style={{ top: selection.top, left: selection.left }}
            >
              {(Object.keys(HIGHLIGHT_LABELS) as HighlightColor[]).map((color) => (
                <Tooltip key={color}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Highlight in ${HIGHLIGHT_LABELS[color].toLowerCase()}`}
                      className="flex size-9 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/70"
                      onClick={() => {
                        onHighlight(selection.anchor, color);
                        window.getSelection()?.removeAllRanges();
                        setSelection(null);
                      }}
                    >
                      <span
                        className="fm-highlight-swatch size-5 rounded-full border border-foreground/15"
                        data-color={color}
                        style={{ background: `var(--highlight-${color})` }}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Highlight</TooltipContent>
                </Tooltip>
              ))}
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onNote(selection.anchor);
                  setSelection(null);
                }}
              >
                <StickyNote aria-hidden="true" />
                Add note
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-disabled="true"
                    className="opacity-60"
                    onClick={(event) => event.preventDefault()}
                  >
                    <MessageSquareText aria-hidden="true" />
                    Ask about selection
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{aiUnavailableReason}</TooltipContent>
              </Tooltip>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PageInput({
  page,
  pageCount,
  disabled,
  onGo,
}: {
  page: number;
  pageCount: number;
  disabled: boolean;
  onGo: (page: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <form
      className="flex items-center gap-1.5 px-1 text-sm whitespace-nowrap text-muted-foreground"
      onSubmit={(event) => {
        event.preventDefault();
        const value = Number(draft);
        if (Number.isInteger(value)) onGo(value);
        setDraft(null);
      }}
    >
      <label htmlFor="reader-page" className="sr-only">
        Page number
      </label>
      Page
      <Input
        id="reader-page"
        inputMode="numeric"
        disabled={disabled}
        value={draft ?? String(page)}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
        onBlur={() => setDraft(null)}
        className="h-8 w-14 px-1.5 text-center tabular-nums"
      />
      of <span className="tabular-nums">{pageCount || "—"}</span>
    </form>
  );
}

function ToolButton({
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          aria-keyshortcuts={shortcut}
          disabled={disabled}
          onClick={onClick}
          className={cn("[&_svg]:size-[18px]", pressed && "bg-muted", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? <span className="ml-1.5 text-muted-foreground">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** Lazily rendered page thumbnails; a page renders when it scrolls into view. */
function Thumbnails({
  pdf,
  current,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  current: number;
  onSelect: (page: number) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rendered = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const canvas = entry.target as HTMLCanvasElement;
          const pageNumber = Number(canvas.dataset.page);
          if (rendered.has(pageNumber)) continue;
          rendered.add(pageNumber);
          void pdf.getPage(pageNumber).then((pdfPage) => {
            const viewport = pdfPage.getViewport({
              scale: 120 / pdfPage.getViewport({ scale: 1 }).width,
            });
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            return pdfPage.render({ canvas, viewport }).promise;
          });
        }
      },
      { root: list, rootMargin: "200px" },
    );
    list.querySelectorAll("canvas").forEach((canvas) => observer.observe(canvas));
    return () => observer.disconnect();
  }, [pdf]);

  return (
    <nav aria-label="Page thumbnails" className="w-40 shrink-0 border-r bg-card">
      <ol ref={listRef} className="h-full space-y-3 overflow-y-auto p-3">
        {Array.from({ length: pdf.numPages }, (_, index) => index + 1).map((pageNumber) => (
          <li key={pageNumber}>
            <button
              type="button"
              onClick={() => onSelect(pageNumber)}
              aria-current={pageNumber === current ? "page" : undefined}
              aria-label={`Page ${pageNumber}`}
              className={cn(
                "flex w-full flex-col items-center gap-1 rounded-lg p-1.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/70",
                pageNumber === current && "bg-primary-subtle",
              )}
            >
              <canvas data-page={pageNumber} className="h-auto w-full bg-white shadow-sm" />
              <span className="text-xs text-muted-foreground tabular-nums">{pageNumber}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
