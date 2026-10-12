const NAV_ITEMS = [
  { label: "3D World", href: "/", matches: ["/", "/dashboard"] },
  { label: "Presence", href: "/presence", matches: ["/presence"] },
  { label: "Graph", href: "/presence/graph", matches: ["/presence/graph"] },
  { label: "LTE Lab", href: "/lte", matches: ["/lte"] },
  { label: "XR Board", href: "/vr", matches: ["/vr", "/mr", "/xr"] },
  { label: "Settings", href: "/settings", matches: ["/settings", "/setting"] }
];

export function AppNavigation({ className = "" }: { className?: string }) {
  const rawPathname = typeof window === "undefined" ? "/" : window.location.pathname;
  const pathname = appPathname(rawPathname);
  return (
    <nav className={`app-nav ${className}`.trim()} aria-label="TDS app navigation">
      {NAV_ITEMS.map((item) => {
        const active = item.matches.includes(pathname);
        return (
          <a key={item.href} href={appRouteHref(item.href, rawPathname)} aria-current={active ? "page" : undefined}>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

export function appPathname(pathname = typeof window === "undefined" ? "/" : window.location.pathname): string {
  if (pathname === "/static") {
    return "/";
  }
  if (pathname.startsWith("/static/")) {
    return pathname.slice("/static".length) || "/";
  }
  return pathname || "/";
}

function appRouteHref(href: string, pathname: string): string {
  if (!pathname.startsWith("/static")) {
    return href;
  }
  return href === "/" ? "/static/" : `/static${href}`;
}
