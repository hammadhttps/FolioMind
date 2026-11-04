import type { Metadata } from "next";
import { LegalPage } from "@/components/foliomind/legal-page";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <section className="space-y-2">
        <h2>What FolioMind stores</h2>
        <ul>
          <li>
            Your account details from your sign-in provider: name, email address and profile photo.
          </li>
          <li>
            Files you upload or import, and the documents, notes and projects you create from them.
          </li>
          <li>Usage counts needed to apply your plan&apos;s allowances.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2>Who processes it</h2>
        <p>
          Sign-in is handled by Auth0. Files are stored with UploadThing. Document text is sent to
          Jina AI and Google Gemini to index it and answer your questions. Payments, when available,
          are handled by Stripe; FolioMind never receives your card details.
        </p>
      </section>
      <section className="space-y-2">
        <h2>Your private files</h2>
        <p>
          Uploads, imports, chats and exports are visible only to you. Administrators do not browse
          private files; any exceptional support access must be authorized and recorded.
        </p>
      </section>
      <section className="space-y-2">
        <h2>Your choices</h2>
        <p>
          You can delete documents at any time and request deletion of your account from Settings.
        </p>
      </section>
    </LegalPage>
  );
}
