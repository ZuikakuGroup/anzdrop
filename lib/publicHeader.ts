import { getCurrentAccount } from "@/lib/account/me-client";

// Public pages need menu controls and an account lookup, not a React renderer.
export function initPublicHeader(root: HTMLElement): () => void {
  const events = new AbortController();
  const options = { signal: events.signal };
  let active = true;
  let loggingOut = false;
  const find = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

  function setAccountMenu(open: boolean) {
    const button = root.querySelector<HTMLElement>('[data-action="account-menu"]');
    if (!button) return;
    button.setAttribute("aria-expanded", String(open));
    if (open) button.setAttribute("aria-controls", "desktop-account-menu");
    else button.removeAttribute("aria-controls");
    find("#desktop-account-menu").hidden = !open;
    button.querySelector("svg")?.classList.toggle("rotate-180", open);
  }

  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
    if (!button || !root.contains(button)) return;
    if (button.dataset.action === "mobile-menu") {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
      const panel = find("#mobile-menu-panel");
      panel.inert = !open;
      panel.classList.toggle("max-h-0", !open);
      panel.classList.toggle("max-h-[480px]", open);
      const content = find("[data-mobile-content]");
      content.classList.toggle("opacity-0", !open);
      content.classList.toggle("opacity-100", open);
      content.classList.toggle("delay-100", open);
      find("[data-menu-open-icon]").hidden = open;
      find("[data-menu-close-icon]").hidden = !open;
    } else if (button.dataset.action === "account-menu") {
      setAccountMenu(button.getAttribute("aria-expanded") !== "true");
    } else if (button.dataset.action === "logout" && !loggingOut) {
      loggingOut = true;
      root.querySelectorAll<HTMLButtonElement>('[data-action="logout"]').forEach(item => { item.disabled = true; });
      void fetch("/api/account/logout", { method: "POST" })
        .catch(() => {})
        .finally(() => { if (active) window.location.assign("/"); });
    }
  }, options);

  document.addEventListener("mousedown", (event) => {
    if (!root.querySelector("[data-account-menu]")?.contains(event.target as Node)) setAccountMenu(false);
  }, options);

  void getCurrentAccount().catch(() => null).then((account) => {
    if (!active) return;
    const accountId = account?.success ? account.accountId : null;
    for (const size of ["desktop", "mobile"]) {
      const template = find<HTMLTemplateElement>(`[data-${size}-${accountId ? "account" : "guest"}]`);
      const content = template.content.cloneNode(true) as DocumentFragment;
      content.querySelectorAll("[data-account-id]").forEach(item => { item.textContent = accountId; });
      find(`[data-${size}-auth]`).replaceChildren(content);
    }
  });

  return () => {
    active = false;
    events.abort();
  };
}
