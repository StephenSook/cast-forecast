"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Mark } from "./Mark";

const LINKS = [
  { href: "/", label: "Try" },
  { href: "/compare", label: "Compare" },
  { href: "/evidence", label: "Evidence" },
] as const;

const isCurrent = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

const onScroll = (notify: () => void) => {
  window.addEventListener("scroll", notify, { passive: true });
  return () => window.removeEventListener("scroll", notify);
};

// The pills float over every section, the ink footer included, so a focus ring drawn outside a pill can land
// on ink. Each pill draws its ring inside itself instead: the focus blue on light pills, amber on the ink pill.
// `!` because the global a:focus-visible rule in globals.css is unlayered and would win over a plain utility.
const RING_INSIDE = "focus-visible:outline-offset-[-6px]!";

/**
 * Below md the pills sit on a full-width paper band (blurred, ink rule underneath) that takes taps, so page content
 * scrolled up under the nav is covered instead of showing through between the pills.
 */
const PHONE_BAND = "max-md:top-0 max-md:inset-x-0 max-md:p-3 max-md:pointer-events-auto max-md:bg-paper/85 max-md:backdrop-blur max-md:border-b-2 max-md:border-ink";

/**
 * Pill nav (adapted from Lullabuy src/ui/Nav.tsx): brand pill, three links on desktop, Compare and Evidence pills on
 * phones. From md the pills float over the page as before; on phones they sit on PHONE_BAND.
 */
export function PillNav() {
  const pathname = usePathname();
  const scrolled = useSyncExternalStore(onScroll, () => window.scrollY > 50, () => false);
  return (
    <header data-testid="site-nav" className={`fixed top-3 inset-x-3 z-50 flex items-center justify-between gap-3 pointer-events-none ${PHONE_BAND}`}>
      <Link
        href="/"
        className={`pointer-events-auto flex items-center gap-2 rounded-full bg-paper/90 backdrop-blur px-3 py-2 shadow-[0_2px_0_var(--ink)] border-2 border-ink ${RING_INSIDE}`}
      >
        <Mark size={28} />
        <span
          className={`display text-lg transition-[max-width,opacity] duration-500 overflow-hidden whitespace-nowrap ${scrolled ? "max-w-0 opacity-0 sm:max-w-[12em] sm:opacity-100" : "max-w-[12em]"}`}
        >
          Cast Forecast
        </span>
      </Link>
      <nav aria-label="Main" className="pointer-events-auto hidden md:flex items-center gap-1.5">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isCurrent(pathname, l.href) ? "page" : undefined}
            className={`rounded-full bg-amber-soft aria-[current=page]:bg-amber border-2 border-ink px-4 py-2 font-bold text-sm hover:bg-amber transition-[background-color,transform] shadow-[0_2px_0_var(--ink)] hover:-translate-y-0.5 ${RING_INSIDE}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="pointer-events-auto md:hidden flex items-center gap-1.5">
        <Link
          href="/compare"
          data-testid="phone-compare"
          aria-current={isCurrent(pathname, "/compare") ? "page" : undefined}
          className={`md:hidden rounded-full bg-amber-soft aria-[current=page]:bg-amber border-2 border-ink px-3 py-2 font-bold text-sm ${RING_INSIDE}`}
        >
          Compare
        </Link>
        <Link
          href="/evidence"
          data-testid="phone-pill"
          aria-current={isCurrent(pathname, "/evidence") ? "page" : undefined}
          className={`rounded-full bg-ink text-paper px-4 py-2.5 font-bold text-sm focus-visible:outline-amber! ${RING_INSIDE}`}
        >
          Evidence
        </Link>
      </div>
    </header>
  );
}
