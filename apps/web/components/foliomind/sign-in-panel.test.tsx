import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SignInPanel } from "./sign-in-panel";

describe("SignInPanel", () => {
  afterEach(() => {
    document.cookie = "fm_last_signin=; Max-Age=0; Path=/";
  });

  it("sends Google and GitHub straight to their connections, never to Auth0's page", () => {
    render(<SignInPanel returnTo="/dashboard/library" />);
    expect(screen.getByRole("link", { name: /Continue with Google/ })).toHaveAttribute(
      "href",
      "/auth/login?connection=google-oauth2&prompt=select_account&returnTo=%2Fdashboard%2Flibrary",
    );
    expect(screen.getByRole("link", { name: /Continue with GitHub/ })).toHaveAttribute(
      "href",
      "/auth/login?connection=github&returnTo=%2Fdashboard%2Flibrary",
    );
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("/auth/login")) expect(href).toMatch(/connection=(google-oauth2|github)/);
    }
  });

  it("offers only Google and GitHub", () => {
    render(<SignInPanel returnTo="/dashboard" />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("marks the last used provider", () => {
    document.cookie = "fm_last_signin=github; Path=/";
    render(<SignInPanel returnTo="/dashboard" />);
    const github = screen.getByRole("link", { name: /Continue with GitHub/ });
    expect(within(github).getByText("Last used")).toBeInTheDocument();
    expect(screen.getAllByText("Last used")).toHaveLength(1);
  });

  it("ignores a last used value that is no longer offered", () => {
    document.cookie = "fm_last_signin=email; Path=/";
    render(<SignInPanel returnTo="/dashboard" />);
    expect(screen.queryByText("Last used")).not.toBeInTheDocument();
  });

  it("shows sign-in errors passed from the callback", () => {
    render(
      <SignInPanel returnTo="/dashboard" error="We couldn't sign you in. Please try again." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn't sign you in. Please try again.",
    );
  });
});
