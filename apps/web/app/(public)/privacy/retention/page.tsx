import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/foliomind/legal-page";

export const metadata: Metadata = { title: "Data retention" };

/*
 * The public summary of docs/policies/data-retention.md. Change both together,
 * and keep both in step with what the cleanup and deletion code does.
 */

const ACCOUNT_ROWS = [
  {
    what: "Uploads, imports, exports, notes, highlights, chats, workspaces and projects",
    when: "Access ends at once; stored copies are removed within a day",
  },
  { what: "A Pro subscription", when: "Cancelled at once, so it never renews" },
  { what: "Your sign-in identity with Auth0", when: "Deleted right away" },
  {
    what: "Books you published",
    when: "Leave the library at once; the records stay unpublished",
  },
  {
    what: "Billing records and the security log",
    when: "Kept as long as the law requires, without your name or email",
  },
];

const ROUTINE_ROWS = [
  { what: "Notifications", when: "Deleted after 90 days" },
  { what: "Payment event records from Stripe", when: "Deleted after 30 days" },
  { what: "A document or project you delete", when: "Access ends at once; copies within a day" },
];

function RetentionTable({ rows }: { rows: { what: string; when: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/60">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              What
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              How long it&apos;s kept
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.what}>
              <td className="px-4 py-2.5 align-top">{row.what}</td>
              <td className="px-4 py-2.5 align-top text-muted-foreground">{row.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DataRetentionPage() {
  return (
    <LegalPage title="Data retention">
      <section className="space-y-2">
        <p>
          FolioMind keeps your data only while it has a purpose. Deleting something ends access at
          once; stored copies follow within a day. Exports you already downloaded stay with you.
        </p>
      </section>
      <section className="space-y-3">
        <h2>When you delete your account</h2>
        <RetentionTable rows={ACCOUNT_ROWS} />
      </section>
      <section className="space-y-3">
        <h2>Everyday records</h2>
        <RetentionTable rows={ROUTINE_ROWS} />
      </section>
      <section className="space-y-2">
        <h2>Backups</h2>
        <p>
          Database backups keep a short history for recovery. Deleted data leaves them when that
          window passes.
        </p>
      </section>
      <p>
        <Link href="/privacy" className="text-link underline-offset-4 hover:underline">
          Back to the privacy policy
        </Link>
      </p>
    </LegalPage>
  );
}
