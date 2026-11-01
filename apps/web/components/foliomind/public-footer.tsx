import Link from "next/link";
import { LogoMark } from "@/components/icons/logo";
import { FooterNote } from "./footer-note";

export function PublicFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-[15px] py-8 sm:px-[18px] md:flex-row md:items-center md:justify-between md:px-[25px] xl:px-9">
        <div className="flex items-center gap-2 font-semibold">
          <LogoMark className="size-5 text-primary" />
          <span>FolioMind</span>
        </div>
        <FooterNote>Your private uploads are visible only to you.</FooterNote>
        <nav aria-label="Legal">
          <ul className="flex items-center gap-5 text-sm">
            <li>
              <Link
                href="/privacy"
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Privacy
              </Link>
            </li>
            <li>
              <Link
                href="/terms"
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Terms
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
