/** The narrow signed-in identity the UI receives (safe to pass to Client Components). */
export interface SessionUser {
  name: string;
  email: string | null;
  picture: string | null;
  isAdmin: boolean;
}
