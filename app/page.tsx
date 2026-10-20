import { redirect } from "next/navigation";
import { verifySession, getProfile, getConnectedAccount } from "./lib/dal";
import { DashboardView } from "./dashboard-view";

export const instant = false;

interface HomePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const session = await verifySession();

  // Authoritative server-side session check
  // If Supabase is configured and the user is not authenticated, redirect to /login
  if (session.isConfigured && !session.isAuth) {
    redirect("/login");
  }

  const profile = await getProfile();
  const initialInstagramStatus = await getConnectedAccount();
  const params = searchParams ? await searchParams : {};

  return (
    <DashboardView
      profile={profile}
      initialInstagramStatus={initialInstagramStatus}
      isSupabaseConfigured={session.isConfigured}
      searchParams={params}
    />
  );
}
