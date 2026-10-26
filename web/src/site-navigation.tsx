import { useEffect, useRef } from "react";
import { ROUTES } from "./data";
import "./site-navigation.css";

const PRIMARY_PATHS = ["/catalog", "/mint", "/request", "/fact-check", "/register", "/about"];
const PRIMARY_LINKS = ROUTES.filter(([path]) => PRIMARY_PATHS.includes(path));
const MORE_LINKS = ROUTES.filter(
  ([path]) => path !== "/" && !PRIMARY_PATHS.includes(path),
);

export function SiteNavigation({ route }: { route: string }) {
  const more = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const currentSecondary = MORE_LINKS.find(([path]) => path === route)?.[1];

  useEffect(() => {
    if (more.current) more.current.open = false;
  }, [route]);

  useEffect(() => {
    const closeOutside = (event: Event) => {
      if (more.current?.open && !more.current.contains(event.target as Node)) {
        more.current.open = false;
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
    };
  }, []);

  function closeMore() {
    if (more.current) more.current.open = false;
    summary.current?.focus();
  }

  return (
    <nav className="site-navigation" aria-label="Main navigation">
      {PRIMARY_LINKS.map(([path, name]) => (
        <a
          key={path}
          href={`#${path}`}
          aria-current={route === path ? "page" : undefined}
        >
          {name}
        </a>
      ))}
      <a href="docs/index.html">Docs</a>
      <details
        className="site-more"
        ref={more}
        onKeyDown={(event) => {
          if (event.key === "Escape" && more.current?.open) {
            event.preventDefault();
            event.stopPropagation();
            closeMore();
          }
        }}
      >
        <summary
          ref={summary}
          className={
            currentSecondary
              ? "site-more-summary is-current"
              : "site-more-summary"
          }
        >
          More
          {currentSecondary && (
            <span className="site-more-current">{currentSecondary}</span>
          )}
        </summary>
        <div className="site-more-links">
          {MORE_LINKS.map(([path, name]) => (
            <a
              key={path}
              href={`#${path}`}
              aria-current={route === path ? "page" : undefined}
              onClick={closeMore}
            >
              {name}
            </a>
          ))}
          <a href="agents/sworn/SKILL.md" onClick={closeMore}>
            Agents
          </a>
        </div>
      </details>
    </nav>
  );
}

type RouteDestination = {
  route: string;
  anchor?: string;
  query: URLSearchParams;
};

// An anchor moves the keyboard reading position with the viewport. If its
// content arrives later, abandon the jump as soon as the visitor takes over.
export function focusRouteTarget(route: RouteDestination, samePage: boolean) {
  const main = document.getElementById("main");
  const trait = route.query.get("trait");
  const id =
    route.anchor ||
    (trait ? `${route.route === "/request" ? "pick" : "trait"}-${trait}` : "");
  const interactions = [
    "pointerdown",
    "keydown",
    "focusin",
    "wheel",
    "touchstart",
  ];
  let observer: MutationObserver | undefined;
  let stopped = false;

  function stop() {
    stopped = true;
    observer?.disconnect();
    for (const event of interactions)
      document.removeEventListener(event, stop, true);
  }

  function jump() {
    if (stopped || !id) return false;
    const target = document.getElementById(id);
    if (!target) return false;
    stop();
    const interactive = "input, select, textarea, button, a[href], summary";
    const focusTarget = target.matches(interactive)
      ? target
      : target.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6") || target;
    if (
      !focusTarget.matches(interactive) &&
      !focusTarget.hasAttribute("tabindex")
    ) {
      focusTarget.setAttribute("tabindex", "-1");
    }
    target.scrollIntoView({ block: "start" });
    focusTarget.focus({ preventScroll: true });
    return true;
  }

  if (jump()) return stop;
  if (!id || !samePage) {
    main?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  if (id && main) {
    for (const event of interactions)
      document.addEventListener(event, stop, true);
    observer = new MutationObserver(jump);
    observer.observe(main, { childList: true, subtree: true });
  }
  return stop;
}
