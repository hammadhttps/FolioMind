import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home placeholder", () => {
  it("renders the product name and tagline", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1, name: "FolioMind" })).toBeInTheDocument();
    expect(screen.getByText("Your knowledge, connected.")).toBeInTheDocument();
  });
});
