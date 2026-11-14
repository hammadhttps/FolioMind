import { Compass, FilePlus2, Library, Quote, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Hero, HeroLink } from "../hero";

/**
 * Home (Section 20 #1): lavender hero, two entry actions and three benefit
 * cards, then the newest approved books in `featured`. With no approved books
 * that slot renders nothing, rather than placeholders or invented numbers.
 */
export function HomeScreen({
  primaryAction,
  featured,
}: {
  primaryAction: ReactNode;
  featured?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-[15px] py-6 sm:px-[18px] md:px-[25px] md:py-10 xl:px-9">
      <Hero
        eyebrow="A home for curious minds"
        title={
          <>
            Read deeply.
            <br />
            Connect freely.
            <br />
            Create thoughtfully.
          </>
        }
        description="Upload your PDFs, ask questions answered with page citations, and turn what you learn into a polished document."
        actions={
          <>
            {primaryAction}
            <HeroLink href="/library" variant="secondary">
              <Compass aria-hidden="true" />
              Explore the library
            </HeroLink>
          </>
        }
      />

      <section aria-labelledby="benefits-heading" className="mt-10 md:mt-14">
        <h2 id="benefits-heading" className="sr-only">
          What you can do with FolioMind
        </h2>
        <ul className="grid gap-5 md:grid-cols-3">
          <Benefit
            icon={Library}
            title="Your personal library"
            text="Keep course material, articles and saved books together on one private, searchable shelf."
          />
          <Benefit
            icon={Quote}
            title="Answers with page citations"
            text="Ask about your documents and jump straight to the page each answer comes from."
          />
          <Benefit
            icon={FilePlus2}
            title="From idea to document"
            text="Approve an outline, edit the draft it becomes, and export a polished PDF."
          />
        </ul>
      </section>
      {featured}
    </div>
  );
}

function Benefit({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <li>
      <Card className="h-full gap-3 p-6">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary-subtle text-primary-subtle-foreground">
          <Icon className="size-[22px]" aria-hidden="true" />
        </span>
        <h3 className="text-lg font-semibold tracking-[-0.01em]">{title}</h3>
        <p className="text-[0.9375rem]/relaxed text-muted-foreground">{text}</p>
      </Card>
    </li>
  );
}
