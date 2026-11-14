"use client";

import {
  ADMIN_PAGE_SIZE,
  AUDIT_ACTION_LABELS,
  AUDIT_PAGE_SIZE,
  INNGEST_DASHBOARD_URL,
} from "@foliomind/contracts";
import {
  ADMIN_JOB_KINDS,
  ADMIN_JOB_STATUSES,
  ADMIN_USER_PLANS,
  ADMIN_USER_ROLES,
  ADMIN_USER_STATUSES,
  SEARCH_MIN_LENGTH,
  type ADMIN_TAB_VALUES,
} from "@foliomind/contracts/search-params";
import {
  Activity,
  CircleCheck,
  Clock,
  ExternalLink,
  FileText,
  Inbox,
  RotateCcw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { debounce, useQueryStates } from "nuqs";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  retryJobAction,
  reviewApplicationAction,
  suspendUserAction,
  unsuspendUserAction,
} from "@/lib/admin/actions";
import type {
  AdminJobRowView,
  AdminUserRowView,
  ApplicationRowView,
  AuditRowView,
  KeysetPageView,
} from "@/lib/admin/view";
import { formatAge, formatDate, formatDateTime } from "@/lib/format";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { adminParsers, FIRST_KEYSET_PAGE } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { EmptyState } from "../empty-state";
import { MetricCard } from "../metric-card";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";
import { SearchField } from "../search-field";
import { StatusChip } from "../status-chip";
import { KeysetPager } from "./keyset-pager";
import { ReasonDialog, type DecisionResult } from "./reason-dialog";

type AdminTab = (typeof ADMIN_TAB_VALUES)[number];

export interface HealthView {
  jobCounts: { kind: string; status: string; count: number }[];
  oldestQueuedAt: string | null;
  failedLast24h: number;
  outbox: { pending: number; oldestAt: string | null };
  webhooks: { backlog: number; oldestAt: string | null };
}

export interface UsageView {
  days: {
    date: string;
    purposes: {
      purpose: string;
      runs: number;
      failed: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCost: number;
    }[];
  }[];
  totals: { runs: number; inputTokens: number; outputTokens: number; estimatedCost: number };
  allowances: { metric: string; users: number; consumed: number; reserved: number }[];
  olderCursor: string | null;
}

export type AdminData =
  | { tab: "health"; health: HealthView; jobs: KeysetPageView<AdminJobRowView> }
  | { tab: "users"; users: KeysetPageView<AdminUserRowView>; selfId: string }
  | { tab: "applications"; applications: KeysetPageView<ApplicationRowView>; decided: boolean }
  | { tab: "usage"; usage: UsageView }
  | { tab: "audit"; audit: KeysetPageView<AuditRowView> };

export interface AdminCounts {
  accounts: number;
  documents: number;
  pendingReviews: number;
  failedJobs: number;
}

const TABS: { value: AdminTab; label: string }[] = [
  { value: "health", label: "Health" },
  { value: "users", label: "Users" },
  { value: "applications", label: "Applications" },
  { value: "usage", label: "Usage" },
  { value: "audit", label: "Audit" },
];

const CLEAR_FILTERS = {
  q: null,
  role: null,
  status: null,
  plan: null,
  kind: null,
  action: null,
  from: null,
  to: null,
  range: null,
  ...FIRST_KEYSET_PAGE,
};

function handle(result: DecisionResult | null, success: string, refresh: () => void) {
  if (result?.ok) {
    toast.success(success);
    refresh();
  } else if (result?.code === "rate_limited") {
    showRateLimitToast(result.retryAfterSeconds);
  }
  return result;
}

/**
 * Admin Overview (Sections 5 row 15 and 20 #15): service and job health with
 * retries, users and suspension, publisher applications, usage and cost, and
 * the audit log. Tables page on the server; nothing here shows private
 * documents, prompts or answers.
 */
export function AdminOverviewScreen({
  counts = { accounts: 0, documents: 0, pendingReviews: 0, failedJobs: 0 },
  data = {
    tab: "health",
    health: {
      jobCounts: [],
      oldestQueuedAt: null,
      failedLast24h: 0,
      outbox: { pending: 0, oldestAt: null },
      webhooks: { backlog: 0, oldestAt: null },
    },
    jobs: { items: [], nextCursor: null, prevCursor: null },
  },
}: {
  counts?: AdminCounts;
  data?: AdminData;
}) {
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(adminParsers, { shallow: false, startTransition });

  return (
    <div className="space-y-6">
      <PageHeading
        title="Admin overview"
        description="Service health, accounts, applications, usage and audited actions."
      />
      <section aria-label="Overview" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Accounts" value={counts.accounts} icon={Users} />
        <MetricCard label="Active documents" value={counts.documents} icon={FileText} />
        <MetricCard label="Waiting for review" value={counts.pendingReviews} icon={Clock} />
        <MetricCard label="Failed jobs, last 24 h" value={counts.failedJobs} icon={Activity} />
      </section>

      <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((tab) => {
          const current = data.tab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              aria-current={current ? "page" : undefined}
              onClick={() =>
                void setParams({ ...CLEAR_FILTERS, tab: tab.value === "health" ? null : tab.value })
              }
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/70",
                current
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div aria-busy={pending} className={cn("space-y-4", pending && "opacity-60")}>
        {data.tab === "health" ? (
          <HealthTab data={data} params={params} setParams={setParams} />
        ) : null}
        {data.tab === "users" ? (
          <UsersTab data={data} params={params} setParams={setParams} />
        ) : null}
        {data.tab === "applications" ? (
          <ApplicationsTab data={data} params={params} setParams={setParams} />
        ) : null}
        {data.tab === "usage" ? (
          <UsageTab data={data} params={params} setParams={setParams} />
        ) : null}
        {data.tab === "audit" ? (
          <AuditTab data={data} params={params} setParams={setParams} />
        ) : null}
      </div>
    </div>
  );
}

type Params = ReturnType<typeof useQueryStates<typeof adminParsers>>[0];
type SetParams = ReturnType<typeof useQueryStates<typeof adminParsers>>[1];

function useSearch(params: Params, setParams: SetParams) {
  const [term, setTerm] = useState(params.q);
  function onSearch(value: string) {
    setTerm(value);
    const trimmed = value.trim();
    void setParams(
      { q: trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null, ...FIRST_KEYSET_PAGE },
      { history: "replace", limitUrlUpdates: value ? debounce(300) : undefined },
    );
  }
  return { term, onSearch };
}

function Filter<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  const text = (option: string) => {
    if (option === "all") return `All ${label.toLowerCase()}`;
    const words = option.replace(/[-_]/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger className="h-10 w-full bg-card sm:w-44" aria-label={label}>
        <SelectValue>{text(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {text(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="grid gap-1">
      <label className="text-xs text-muted-foreground" htmlFor={`date-${label}`}>
        {label}
      </label>
      <Input
        id={`date-${label}`}
        type="date"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-10 w-full bg-card sm:w-40"
      />
    </div>
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">{children}</div>
  );
}

function TableShell({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border bg-card">{children}</div>;
}

/* --- Health ---------------------------------------------------------------- */

const JOB_STATUS_CHIP: Record<
  string,
  { status: Parameters<typeof StatusChip>[0]["status"]; label: string }
> = {
  queued: { status: "pending", label: "Queued" },
  running: { status: "processing", label: "Running" },
  succeeded: { status: "ready", label: "Succeeded" },
  failed: { status: "failed", label: "Failed" },
  cancelled: { status: "draft", label: "Cancelled" },
};

function HealthTab({
  data,
  params,
  setParams,
}: {
  data: Extract<AdminData, { tab: "health" }>;
  params: Params;
  setParams: SetParams;
}) {
  const router = useRouter();
  const { term, onSearch } = useSearch(params, setParams);
  const { health } = data;
  const kinds = [...new Set(health.jobCounts.map((row) => row.kind))];
  const statuses = ["queued", "running", "succeeded", "failed", "cancelled"];
  const count = (kind: string, status: string) =>
    health.jobCounts.find((row) => row.kind === kind && row.status === status)?.count ?? 0;
  const jobStatus = (ADMIN_JOB_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as (typeof ADMIN_JOB_STATUSES)[number])
    : "all";

  return (
    <div className="space-y-6">
      <section aria-label="Service health" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HealthCard
          title="Oldest queued job"
          value={health.oldestQueuedAt ? formatAge(health.oldestQueuedAt) : "None waiting"}
          good={!health.oldestQueuedAt}
        />
        <HealthCard
          title="Failures, last 24 h"
          value={String(health.failedLast24h)}
          good={health.failedLast24h === 0}
        />
        <HealthCard
          title="Undelivered events"
          value={
            health.outbox.pending === 0
              ? "None"
              : `${health.outbox.pending} · oldest ${formatAge(health.outbox.oldestAt ?? new Date())}`
          }
          good={health.outbox.pending === 0}
        />
        <HealthCard
          title="Webhook backlog"
          value={health.webhooks.backlog === 0 ? "None" : String(health.webhooks.backlog)}
          good={health.webhooks.backlog === 0}
        />
      </section>

      <Panel
        title="Jobs in the last 7 days"
        description="Counts by kind and status. Step-level detail lives in Inngest."
        action={
          <Button asChild variant="outline" size="sm">
            <a href={INNGEST_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              Inngest dashboard
            </a>
          </Button>
        }
      >
        {kinds.length === 0 ? (
          <EmptyState variant="plain" icon={Activity} title="No jobs this week." />
        ) : (
          <div className="overflow-x-auto px-5 pb-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  {statuses.map((status) => (
                    <TableHead key={status} className="text-right capitalize">
                      {status}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {kinds.map((kind) => (
                  <TableRow key={kind}>
                    <TableCell className="font-medium">{kind}</TableCell>
                    {statuses.map((status) => (
                      <TableCell key={status} className="text-right tabular-nums">
                        {count(kind, status)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <h2 className="text-lg font-semibold">Jobs</h2>
      <Toolbar>
        <SearchField
          value={term}
          onValueChange={onSearch}
          label="Search by job ID or owner email"
          placeholder="Job ID or owner email"
          className="sm:max-w-xs"
        />
        <Filter
          label="Kinds"
          value={params.kind}
          options={ADMIN_JOB_KINDS}
          onChange={(kind) =>
            void setParams({ kind: kind === "all" ? null : kind, ...FIRST_KEYSET_PAGE })
          }
        />
        <Filter
          label="Statuses"
          value={jobStatus}
          options={ADMIN_JOB_STATUSES}
          onChange={(status) =>
            void setParams({ status: status === "all" ? null : status, ...FIRST_KEYSET_PAGE })
          }
        />
        <DateFilter
          label="From"
          value={params.from}
          onChange={(from) => void setParams({ from, ...FIRST_KEYSET_PAGE })}
        />
        <DateFilter
          label="To"
          value={params.to}
          onChange={(to) => void setParams({ to, ...FIRST_KEYSET_PAGE })}
        />
      </Toolbar>
      {data.jobs.items.length === 0 ? (
        <EmptyState icon={Inbox} title="No jobs match these filters." />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.jobs.items.map((job) => {
                const chip = JOB_STATUS_CHIP[job.status] ?? {
                  status: "info" as const,
                  label: job.status,
                };
                return (
                  <TableRow key={job.id}>
                    <TableCell>
                      <p className="font-medium">{job.kind}</p>
                      <p className="font-mono text-xs text-muted-foreground">{job.id}</p>
                    </TableCell>
                    <TableCell>
                      <StatusChip status={chip.status} label={chip.label} />
                      {job.safeErrorCode ? (
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {job.safeErrorCode}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate">
                      {job.ownerEmail ?? "System"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(job.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {job.canRetry ? (
                        <RetryButton jobId={job.id} onDone={() => router.refresh()} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableShell>
      )}
      <KeysetPager
        start={params.start}
        count={data.jobs.items.length}
        pageSize={ADMIN_PAGE_SIZE}
        nextCursor={data.jobs.nextCursor}
        prevCursor={data.jobs.prevCursor}
        onPage={(page) => void setParams(page)}
      />
    </div>
  );
}

function HealthCard({ title, value, good }: { title: string; value: string; good: boolean }) {
  return (
    <div className="space-y-2 rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-lg font-semibold">{value}</p>
      {good ? (
        <StatusChip status="ready" label="OK" />
      ) : (
        <StatusChip status="attention" label="Check" />
      )}
    </div>
  );
}

function RetryButton({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await retryJobAction({ jobId }).catch(() => null);
        setBusy(false);
        if (result?.ok) {
          toast.success("Retry queued as a new job.");
          onDone();
        } else if (result?.code === "rate_limited") {
          showRateLimitToast(result.retryAfterSeconds);
        } else {
          toast.error(result?.formError ?? "We couldn't retry that job.");
        }
      }}
    >
      <RotateCcw aria-hidden="true" />
      Retry
    </Button>
  );
}

/* --- Users ----------------------------------------------------------------- */

function UsersTab({
  data,
  params,
  setParams,
}: {
  data: Extract<AdminData, { tab: "users" }>;
  params: Params;
  setParams: SetParams;
}) {
  const router = useRouter();
  const { term, onSearch } = useSearch(params, setParams);
  const userStatus = (ADMIN_USER_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as (typeof ADMIN_USER_STATUSES)[number])
    : "all";
  return (
    <div className="space-y-4">
      <Toolbar>
        <SearchField
          value={term}
          onValueChange={onSearch}
          label="Search by email or name"
          placeholder="Email or name"
          className="sm:max-w-xs"
        />
        <Filter
          label="Roles"
          value={params.role}
          options={ADMIN_USER_ROLES}
          onChange={(role) =>
            void setParams({ role: role === "all" ? null : role, ...FIRST_KEYSET_PAGE })
          }
        />
        <Filter
          label="Statuses"
          value={userStatus}
          options={ADMIN_USER_STATUSES}
          onChange={(status) =>
            void setParams({ status: status === "all" ? null : status, ...FIRST_KEYSET_PAGE })
          }
        />
        <Filter
          label="Plans"
          value={params.plan}
          options={ADMIN_USER_PLANS}
          onChange={(plan) =>
            void setParams({ plan: plan === "all" ? null : plan, ...FIRST_KEYSET_PAGE })
          }
        />
      </Toolbar>
      {data.users.items.length === 0 ? (
        <EmptyState icon={Users} title="No accounts match these filters." />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[16rem]">
                    <p className="truncate font-medium">{row.displayName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {row.email}
                      {row.emailVerified ? "" : " · unverified"}
                    </p>
                  </TableCell>
                  <TableCell className="capitalize">{row.role}</TableCell>
                  <TableCell>
                    {row.status === "active" ? (
                      <StatusChip status="ready" label="Active" />
                    ) : row.status === "suspended" ? (
                      <div className="space-y-1">
                        <StatusChip status="failed" label="Suspended" />
                        <p className="text-xs text-muted-foreground">
                          {row.suspendedUntil
                            ? `Until ${formatDate(row.suspendedUntil)}`
                            : "No end date"}
                        </p>
                      </div>
                    ) : (
                      <StatusChip status="draft" label="Deleting" />
                    )}
                  </TableCell>
                  <TableCell className="capitalize">{row.plan}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(row.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {row.id === data.selfId || row.role === "admin" ? null : row.status ===
                      "active" ? (
                      <SuspendButton user={row} onDone={() => router.refresh()} />
                    ) : row.status === "suspended" ? (
                      <ReasonDialog
                        trigger={
                          <Button variant="outline" size="sm">
                            Lift suspension
                          </Button>
                        }
                        title={`Lift ${row.displayName}'s suspension?`}
                        description="They can sign in again at once."
                        confirmLabel="Lift suspension"
                        required={false}
                        maxLength={500}
                        onSubmit={async (reason) =>
                          handle(
                            await unsuspendUserAction({ userId: row.id, reason }).catch(() => null),
                            "Suspension lifted.",
                            () => router.refresh(),
                          )
                        }
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}
      <KeysetPager
        start={params.start}
        count={data.users.items.length}
        pageSize={ADMIN_PAGE_SIZE}
        nextCursor={data.users.nextCursor}
        prevCursor={data.users.prevCursor}
        onPage={(page) => void setParams(page)}
      />
    </div>
  );
}

function SuspendButton({ user, onDone }: { user: AdminUserRowView; onDone: () => void }) {
  const [endsOn, setEndsOn] = useState("");
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size="sm" className="text-error">
          Suspend
        </Button>
      }
      title={`Suspend ${user.displayName}?`}
      description="They're signed out at once and can't sign in until the suspension ends or is lifted."
      confirmLabel="Suspend"
      required
      destructive
      maxLength={500}
      extra={({ error }) => (
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="suspend-ends">End date (optional)</FieldLabel>
          <Input
            id="suspend-ends"
            type="date"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
            aria-describedby="suspend-ends-hint"
          />
          <p id="suspend-ends-hint" className="text-sm text-muted-foreground">
            Lifts at the start of that day (UTC). Leave empty to keep it until lifted.
          </p>
          <FieldError errors={error ? [{ message: error }] : []} />
        </Field>
      )}
      onSubmit={async (reason) =>
        handle(
          await suspendUserAction({ userId: user.id, reason, endsOn: endsOn || undefined }).catch(
            () => null,
          ),
          "Account suspended.",
          onDone,
        )
      }
    />
  );
}

/* --- Applications ---------------------------------------------------------- */

function ApplicationsTab({
  data,
  params,
  setParams,
}: {
  data: Extract<AdminData, { tab: "applications" }>;
  params: Params;
  setParams: SetParams;
}) {
  const router = useRouter();
  const { term, onSearch } = useSearch(params, setParams);
  return (
    <div className="space-y-4">
      <Toolbar>
        <SearchField
          value={term}
          onValueChange={onSearch}
          label="Search applications"
          placeholder="Name, address or email"
          className="sm:max-w-xs"
        />
        <div className="flex gap-1 sm:ml-auto" role="group" aria-label="Show">
          {(["waiting", "decided"] as const).map((value) => {
            const active = (value === "decided") === data.decided;
            return (
              <Button
                key={value}
                variant={active ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={active}
                onClick={() =>
                  void setParams({
                    status: value === "decided" ? "decided" : null,
                    ...FIRST_KEYSET_PAGE,
                  })
                }
              >
                {value === "waiting" ? "Waiting" : "Decided"}
              </Button>
            );
          })}
        </div>
      </Toolbar>
      {data.applications.items.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={data.decided ? "No decided applications." : "No applications waiting."}
          description={
            data.decided ? undefined : "New publisher applications appear here, oldest first."
          }
        />
      ) : (
        <ul className="space-y-3">
          {data.applications.items.map((row) => (
            <li key={row.id} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium [overflow-wrap:anywhere]">{row.displayName}</p>
                  <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                    /publishers/{row.slug} · {row.email} · {formatDateTime(row.updatedAt)}
                  </p>
                </div>
                {row.status === "applicant" ? (
                  <StatusChip status="pending" label="Waiting" />
                ) : row.status === "approved" ? (
                  <StatusChip status="ready" label="Approved" />
                ) : (
                  <StatusChip status="failed" label="Rejected" />
                )}
              </div>
              <p className="text-sm/relaxed [overflow-wrap:anywhere] whitespace-pre-line">
                {row.bio}
              </p>
              {row.website ? (
                <p className="text-sm">
                  Website:{" "}
                  <a
                    href={row.website}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all text-link underline-offset-4 hover:underline"
                  >
                    {row.website}
                  </a>
                </p>
              ) : null}
              {row.reviewReason ? (
                <p className="text-sm text-muted-foreground">Note: {row.reviewReason}</p>
              ) : null}
              {row.status === "applicant" ? (
                <div className="flex flex-wrap gap-2">
                  <ReasonDialog
                    trigger={
                      <Button size="sm">
                        <CircleCheck aria-hidden="true" />
                        Approve
                      </Button>
                    }
                    title={`Approve ${row.displayName}?`}
                    description="They get the publisher role and can submit books for review. Publishers don't get Pro."
                    confirmLabel="Approve"
                    required={false}
                    onSubmit={async (reason) =>
                      handle(
                        await reviewApplicationAction({
                          profileId: row.id,
                          action: "approve",
                          reason,
                        }).catch(() => null),
                        "Approved. They're now a publisher.",
                        () => router.refresh(),
                      )
                    }
                  />
                  <ReasonDialog
                    trigger={
                      <Button size="sm" variant="outline">
                        <X aria-hidden="true" />
                        Reject
                      </Button>
                    }
                    title={`Reject ${row.displayName}?`}
                    description="They see your reason and can apply again."
                    confirmLabel="Reject"
                    required
                    onSubmit={async (reason) =>
                      handle(
                        await reviewApplicationAction({
                          profileId: row.id,
                          action: "reject",
                          reason,
                        }).catch(() => null),
                        "Rejected. They've been told why.",
                        () => router.refresh(),
                      )
                    }
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <KeysetPager
        start={params.start}
        count={data.applications.items.length}
        pageSize={ADMIN_PAGE_SIZE}
        nextCursor={data.applications.nextCursor}
        prevCursor={data.applications.prevCursor}
        onPage={(page) => void setParams(page)}
      />
    </div>
  );
}

/* --- Usage ----------------------------------------------------------------- */

const numberFormat = new Intl.NumberFormat("en");
const costFormat = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

function UsageTab({
  data,
  params,
  setParams,
}: {
  data: Extract<AdminData, { tab: "usage" }>;
  params: Params;
  setParams: SetParams;
}) {
  const { usage } = data;
  return (
    <div className="space-y-6">
      <Toolbar>
        <Filter
          label="Range"
          value={params.range}
          options={["7", "30", "90"] as const}
          onChange={(range) =>
            void setParams({ range: range === "30" ? null : range, before: null })
          }
        />
        <p className="text-sm text-muted-foreground sm:self-center">
          Days, in UTC. Estimated cost at list prices.
        </p>
      </Toolbar>
      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={`AI runs, last ${params.range} days`}
          value={usage.totals.runs}
          icon={Activity}
        />
        <MetricCard
          label="Input tokens"
          value={numberFormat.format(usage.totals.inputTokens)}
          icon={FileText}
        />
        <MetricCard
          label="Output tokens"
          value={numberFormat.format(usage.totals.outputTokens)}
          icon={FileText}
        />
        <MetricCard
          label="Estimated cost"
          value={costFormat.format(usage.totals.estimatedCost)}
          icon={Activity}
        />
      </section>
      <Panel
        title="This month's allowances"
        description="Across all accounts, by metric (UTC month)."
      >
        {usage.allowances.length === 0 ? (
          <EmptyState variant="plain" icon={Inbox} title="No allowance used this month." />
        ) : (
          <div className="overflow-x-auto px-5 pb-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Accounts</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">Reserved now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.allowances.map((row) => (
                  <TableRow key={row.metric}>
                    <TableCell className="font-medium">{row.metric.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.users}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {numberFormat.format(row.consumed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {numberFormat.format(row.reserved)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
      <Panel
        title="By day and purpose"
        description="Tokens and runs from recorded AI calls; no prompts or text."
      >
        {usage.days.length === 0 ? (
          <EmptyState variant="plain" icon={Inbox} title="No AI calls in this range." />
        ) : (
          <div className="overflow-x-auto px-5 pb-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.days.flatMap((day) =>
                  day.purposes.map((row, index) => (
                    <TableRow key={`${day.date}-${row.purpose}`}>
                      <TableCell className="whitespace-nowrap">
                        {index === 0 ? day.date : ""}
                      </TableCell>
                      <TableCell>{row.purpose}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.runs}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.failed}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {numberFormat.format(row.inputTokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {numberFormat.format(row.outputTokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {costFormat.format(row.estimatedCost)}
                      </TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!params.before}
          onClick={() => void setParams({ before: null })}
        >
          Newest days
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!usage.olderCursor}
          onClick={() => void setParams({ before: usage.olderCursor })}
        >
          Older days
        </Button>
      </div>
    </div>
  );
}

/* --- Audit ----------------------------------------------------------------- */

function AuditTab({
  data,
  params,
  setParams,
}: {
  data: Extract<AdminData, { tab: "audit" }>;
  params: Params;
  setParams: SetParams;
}) {
  const { term, onSearch } = useSearch(params, setParams);
  const actions = Object.keys(AUDIT_ACTION_LABELS);
  return (
    <div className="space-y-4">
      <Toolbar>
        <SearchField
          value={term}
          onValueChange={onSearch}
          label="Search by actor email or target ID"
          placeholder="Actor email or target ID"
          className="sm:max-w-xs"
        />
        <Select
          value={params.action ?? "all"}
          onValueChange={(action) =>
            void setParams({ action: action === "all" ? null : action, ...FIRST_KEYSET_PAGE })
          }
        >
          <SelectTrigger className="h-10 w-full bg-card sm:w-56" aria-label="Action">
            <SelectValue>
              {params.action
                ? (AUDIT_ACTION_LABELS[params.action] ?? params.action)
                : "All actions"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((action) => (
              <SelectItem key={action} value={action}>
                {AUDIT_ACTION_LABELS[action]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateFilter
          label="From"
          value={params.from}
          onChange={(from) => void setParams({ from, ...FIRST_KEYSET_PAGE })}
        />
        <DateFilter
          label="To"
          value={params.to}
          onChange={(to) => void setParams({ to, ...FIRST_KEYSET_PAGE })}
        />
      </Toolbar>
      {data.audit.items.length === 0 ? (
        <EmptyState icon={Inbox} title="No audit entries match these filters." />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.audit.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="soft">{AUDIT_ACTION_LABELS[row.action] ?? row.action}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[14rem] truncate">
                    {row.actorEmail ?? (row.actorId ? row.actorId : "System")}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{row.targetType}</p>
                    <p className="font-mono text-xs text-muted-foreground">{row.targetId}</p>
                  </TableCell>
                  <TableCell className="max-w-[20rem]">
                    <MetadataList metadata={row.metadata} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}
      <KeysetPager
        start={params.start}
        count={data.audit.items.length}
        pageSize={AUDIT_PAGE_SIZE}
        nextCursor={data.audit.nextCursor}
        prevCursor={data.audit.prevCursor}
        onPage={(page) => void setParams(page)}
      />
    </div>
  );
}

function MetadataList({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <dl className="space-y-0.5 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-1">
          <dt className="text-muted-foreground">{key}:</dt>
          <dd className="truncate font-mono">{value === null ? "—" : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
