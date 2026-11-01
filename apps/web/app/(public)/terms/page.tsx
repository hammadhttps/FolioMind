import type { Metadata } from "next";
import { LegalPage } from "@/components/foliomind/legal-page";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <section className="space-y-2">
        <h2>Using FolioMind</h2>
        <p>
          FolioMind helps you organize documents, ask questions about them and create PDFs. Upload
          only material you have the right to use, and import web pages only for personal study.
        </p>
      </section>
      <section className="space-y-2">
        <h2>AI-generated content</h2>
        <p>
          Answers and drafts are generated with AI and can be wrong or incomplete. Check citations
          against the original pages, and review drafts before you rely on or share them.
        </p>
      </section>
      <section className="space-y-2">
        <h2>Publishing</h2>
        <p>
          Publishers confirm they are authorized to share each book they submit. Submissions are
          reviewed and can be rejected or taken down.
        </p>
      </section>
      <section className="space-y-2">
        <h2>Plans</h2>
        <p>
          Free and Pro allowances are listed on the Pricing page. Downgrading changes your
          allowances without deleting the work you already have.
        </p>
      </section>
    </LegalPage>
  );
}
