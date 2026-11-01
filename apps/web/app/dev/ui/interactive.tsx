"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { FilterPills, FilterTabs } from "@/components/foliomind/filter-tabs";
import { SearchField } from "@/components/foliomind/search-field";
import { Button } from "@/components/ui/button";

export function GalleryThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="outline"
      size="sm"
      className="ml-auto"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="dark:hidden" aria-hidden="true" />
      <Moon className="hidden dark:block" aria-hidden="true" />
      Toggle theme
    </Button>
  );
}

/** Stateful demos for controlled components in the gallery. */
export function InteractiveDemos() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [categories, setCategories] = useState<string[]>(["design"]);
  return (
    <div className="space-y-4">
      <SearchField
        value={query}
        onValueChange={setQuery}
        label="Sample search"
        placeholder="Search titles"
        className="max-w-md"
      />
      <FilterTabs
        label="Sample type filter"
        value={type}
        onValueChange={setType}
        options={[
          { value: "all", label: "All" },
          { value: "uploads", label: "Uploads" },
          { value: "saved", label: "Saved" },
        ]}
      />
      <FilterPills
        label="Sample categories"
        value={categories}
        onValueChange={setCategories}
        options={[
          { value: "environment", label: "Environment" },
          { value: "design", label: "Design" },
          { value: "research", label: "Research" },
        ]}
      />
    </div>
  );
}
