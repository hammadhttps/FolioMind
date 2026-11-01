import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startEmailSignIn, verifyEmailCode } from "@/lib/auth/email-sign-in";
import { SignInPanel } from "./sign-in-panel";

vi.mock("@/lib/auth/email-sign-in", () => ({
  startEmailSignIn: vi.fn(),
  verifyEmailCode: vi.fn(),
}));

const start = vi.mocked(startEmailSignIn);
const verify = vi.mocked(verifyEmailCode);

describe("SignInPanel", () => {
  beforeEach(() => {
    start.mockReset();
    verify.mockReset();
  });

  it("sends Google and GitHub straight to their connections, never to Auth0's page", () => {
    render(<SignInPanel returnTo="/dashboard/library" />);
    expect(screen.getByRole("link", { name: /Continue with Google/ })).toHaveAttribute(
      "href",
      "/auth/login?connection=google-oauth2&returnTo=%2Fdashboard%2Flibrary",
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

  it("validates the email address before calling the server", async () => {
    const user = userEvent.setup();
    render(<SignInPanel returnTo="/dashboard" />);
    await user.type(screen.getByLabelText("Email address"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it("asks for the code after sending it, and shows server errors on the field", async () => {
    const user = userEvent.setup();
    start.mockResolvedValue({ ok: true, data: undefined });
    verify.mockResolvedValue({
      ok: false,
      code: "invalid_grant",
      fieldErrors: { code: ["That code didn't work. Check it, or send a new code."] },
    });
    render(<SignInPanel returnTo="/dashboard" />);

    await user.type(screen.getByLabelText("Email address"), " Ada@Example.com ");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
    expect(start).toHaveBeenCalledWith({ email: "ada@example.com" });
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();

    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(verify).toHaveBeenCalledWith({ email: "ada@example.com", code: "123456" });
    expect(
      await screen.findByText("That code didn't work. Check it, or send a new code."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();
  });

  it("shows a form-level message when email sign-in is unavailable", async () => {
    const user = userEvent.setup();
    start.mockResolvedValue({
      ok: false,
      code: "not_configured",
      formError:
        "Email sign-in isn't available right now. Try Google or GitHub, or try again later.",
    });
    render(<SignInPanel returnTo="/dashboard" />);
    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
    expect(await screen.findByText(/Email sign-in isn't available right now/)).toBeInTheDocument();
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
