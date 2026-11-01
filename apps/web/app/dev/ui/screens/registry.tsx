import type { ReactNode } from "react";
import {
  AdminAccessRequired,
  AdminOverviewScreen,
  ModerationScreen,
} from "@/components/foliomind/screens/admin";
import { BillingScreen } from "@/components/foliomind/screens/billing";
import { BookDetailsScreen } from "@/components/foliomind/screens/book-details";
import { DashboardScreen } from "@/components/foliomind/screens/dashboard";
import { MyLibraryScreen } from "@/components/foliomind/screens/my-library";
import { MyProjectsScreen } from "@/components/foliomind/screens/my-projects";
import { PdfStudioScreen } from "@/components/foliomind/screens/pdf-studio";
import { PublisherProfileScreen } from "@/components/foliomind/screens/publisher-profile";
import { PublishingScreen } from "@/components/foliomind/screens/publishing";
import { ReaderScreen } from "@/components/foliomind/screens/reader";
import { ResearchWorkspaceScreen } from "@/components/foliomind/screens/research-workspace";
import { SettingsScreen } from "@/components/foliomind/screens/settings";
import { SAMPLE_BOOK, SAMPLE_PROJECTS, SAMPLE_PUBLISHER } from "../sample-data";

interface ScreenPreview {
  title: string;
  shell: "app" | "public";
  render: () => ReactNode;
}

/** Development-only previews of templates that need a session or data to render for real. */
export const SCREEN_PREVIEWS: Record<string, ScreenPreview> = {
  dashboard: { title: "Dashboard", shell: "app", render: () => <DashboardScreen /> },
  "my-library": { title: "My Library", shell: "app", render: () => <MyLibraryScreen /> },
  reader: { title: "Reader", shell: "app", render: () => <ReaderScreen /> },
  "research-workspace": {
    title: "Research workspace",
    shell: "app",
    render: () => <ResearchWorkspaceScreen />,
  },
  "my-projects": { title: "My Projects (empty)", shell: "app", render: () => <MyProjectsScreen /> },
  "my-projects-sample": {
    title: "My Projects (sample rows)",
    shell: "app",
    render: () => <MyProjectsScreen projects={SAMPLE_PROJECTS} />,
  },
  "pdf-studio": { title: "PDF Studio", shell: "app", render: () => <PdfStudioScreen /> },
  publishing: { title: "Publishing", shell: "app", render: () => <PublishingScreen /> },
  settings: { title: "Settings", shell: "app", render: () => <SettingsScreen /> },
  billing: { title: "Billing", shell: "app", render: () => <BillingScreen /> },
  "admin-overview": {
    title: "Admin overview",
    shell: "app",
    render: () => <AdminOverviewScreen />,
  },
  moderation: { title: "Moderation", shell: "app", render: () => <ModerationScreen /> },
  "admin-access": {
    title: "Admin access required",
    shell: "app",
    render: () => <AdminAccessRequired />,
  },
  "book-details": {
    title: "Book Details (sample)",
    shell: "public",
    render: () => <BookDetailsScreen book={SAMPLE_BOOK} />,
  },
  "publisher-profile": {
    title: "Publisher Profile (sample)",
    shell: "public",
    render: () => <PublisherProfileScreen publisher={SAMPLE_PUBLISHER} />,
  },
};
