import { SIGN_IN_PROVIDERS } from "@foliomind/contracts";
import { getNotificationPreferences, listIdentities, parseSub } from "@foliomind/domain";
import type { Metadata } from "next";
import { SettingsScreen, type SignInMethodView } from "@/components/foliomind/screens/settings";
import { getDb } from "@/lib/clients";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Sign-in methods come from the account's mirrored Auth0 identities (Section 22). */
export default async function SettingsPage({ searchParams }: PageProps<"/dashboard/settings">) {
  const user = await requireUser();
  const [identities, notificationPreferences, params] = await Promise.all([
    listIdentities(getDb(), user.id),
    getNotificationPreferences(getDb(), user.id),
    searchParams,
  ]);
  const primary = parseSub(user.auth0Sub);

  const methods: SignInMethodView[] = SIGN_IN_PROVIDERS.map((provider) => {
    const identity = identities.find((row) => row.provider === provider);
    return {
      provider,
      connected: Boolean(identity),
      email: identity?.email ?? null,
      primary:
        primary?.provider === provider && identity?.providerUserId === primary.providerUserId,
    };
  });

  return (
    <SettingsScreen
      methods={methods}
      identityResult={first(params.identity) ?? null}
      notificationPreferences={notificationPreferences}
    />
  );
}
