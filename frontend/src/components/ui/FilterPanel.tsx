import clsx from "clsx";
import { SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./Button";

/**
 * Wraps a list page's filter card. On phones the filters collapse behind a
 * "Filters (n)" toggle so results are visible first; from md upwards they always show.
 */
export function FilterPanel({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mb-3 md:hidden">
        <Button
          variant={activeCount ? "primary" : "secondary"}
          size="sm"
          icon={<SlidersHorizontal className="h-4 w-4" />}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "Hide filters" : "Filters"}
          {activeCount > 0 && ` (${activeCount})`}
        </Button>
      </div>
      <div className={clsx(!open && "hidden md:block")}>{children}</div>
    </>
  );
}
