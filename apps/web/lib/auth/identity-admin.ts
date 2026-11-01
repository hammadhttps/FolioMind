import "server-only";
import type { IdentityProviderAdmin } from "@foliomind/domain";
import { getAuth0Management } from "@/lib/clients";

/**
 * Auth0 Management API calls behind the domain's link, unlink and orphan
 * deletion flows (Section 22 rules 3, 4, 6 and 8). Needs the M2M application's
 * `read:users`, `update:users` and `delete:users` scopes.
 */
export const auth0IdentityAdmin: IdentityProviderAdmin = {
  async link(primarySub, secondary) {
    await getAuth0Management().users.identities.link(primarySub, {
      provider: secondary.provider,
      user_id: secondary.providerUserId,
    });
  },

  async unlink(primarySub, secondary) {
    await getAuth0Management().users.identities.delete(
      primarySub,
      secondary.provider,
      secondary.providerUserId,
    );
  },

  async listIdentities(primarySub) {
    const user = await getAuth0Management().users.get(primarySub, {
      fields: "identities,email",
      include_fields: true,
    });
    return (user.identities ?? []).flatMap((identity) =>
      identity.provider && identity.user_id !== undefined
        ? [
            {
              provider: identity.provider,
              providerUserId: String(identity.user_id),
              email:
                typeof identity.profileData?.email === "string" ? identity.profileData.email : null,
            },
          ]
        : [],
    );
  },

  async deleteUser(sub) {
    await getAuth0Management().users.delete(sub);
  },
};
