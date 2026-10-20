import { redirect } from "next/navigation";

export const instant = false;

interface DashboardPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Route handler page for /dashboard.
 * Seamlessly forwards incoming navigation and OAuth callback redirects to the root / page
 * while preserving all query parameters (e.g. ?success=instagram_connected or ?error=...).
 */
export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = searchParams ? await searchParams : {};
  const sp = new URLSearchParams();

  for (const [key, val] of Object.entries(params)) {
    if (typeof val === "string") {
      sp.set(key, val);
    } else if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string") {
          sp.append(key, v);
        }
      }
    }
  }

  const queryString = sp.toString();
  redirect(queryString ? `/?${queryString}` : "/");
}
