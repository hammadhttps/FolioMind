/** The narrow signed-in identity the UI receives (safe to pass to Client Components). */
export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  picture: string | null;
  role: "reader" | "publisher" | "admin";
  isAdmin: boolean;
  emailVerified: boolean;
  theme: "light" | "dark" | "system";
}
