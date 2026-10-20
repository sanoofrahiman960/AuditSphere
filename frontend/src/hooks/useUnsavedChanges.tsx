import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { ConfirmDialog } from "@/components/ui/Modal";

/**
 * Warns before leaving a page with unsaved changes: in-app navigation (links, back/forward)
 * shows a confirmation dialog; closing or reloading the tab triggers the browser prompt.
 * Render the returned element somewhere in the page.
 */
export function useUnsavedChanges(dirty: boolean, message = "You have unsaved changes. Leave this page and discard them?") {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      onClose={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
      title="Discard unsaved changes?"
      message={message}
      confirmLabel="Leave page"
      tone="danger"
    />
  );
}
