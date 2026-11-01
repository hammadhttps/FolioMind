/**
 * Session field holding the local `users.id`, set by the sign-in callback. It
 * lives only in FolioMind's encrypted session cookie; Auth0 never sees it.
 */
export const LOCAL_USER_CLAIM = "foliomind_user_id";
