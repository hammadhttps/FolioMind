# Auth0 sign-in setup

FolioMind uses its own sign-in screen: the `/login` page and the sign-in dialog share one panel with **Continue with Google** and **Continue with GitHub**. The first sign-in creates the account, so there is no separate registration, and there is no email or password sign-in. Auth0's hosted Universal Login page is never part of the flow:

- Google and GitHub buttons send `connection=google-oauth2` or `connection=github`, so Auth0 forwards the user straight to the provider. Google links also send `prompt=select_account`, so Google always shows its account chooser.
- `/auth/login` without one of those two connections redirects to `/login`. Guests on signed-in pages go to `/login?returnTo=…`. Sign-in errors return to `/login?auth_error=…`.
- Only `GET /auth/login`, `/auth/logout`, `/auth/callback` and `/auth/profile` are served; the SDK's other routes (MFA, passkeys, passwordless HTTP endpoints, access tokens) return 404.

Do the steps below in each Auth0 tenant (development, staging, production). If the tenant came from the Vercel integration, open it from **Vercel → Integrations → Auth0**.

## 1. Google

**Authentication → Social → Google**

1. Turn it on for the FolioMind application (**Applications** tab).
2. For production, enter FolioMind's own Google OAuth client ID and secret (see `third-party-services.md`). Auth0's development keys work for testing but show Auth0 on Google's consent screen.

## 2. GitHub

**Authentication → Social → GitHub** (create it if it isn't listed)

1. Turn it on for the FolioMind application.
2. Tick the **Email address** attribute so GitHub users who hide their public email can still sign in.

If GitHub stays off, the GitHub button leads back to `/login` with "We couldn't sign you in.", so either enable it or tell your developer to hide the button.

## 3. Turn off the other connections

FolioMind only offers Google and GitHub, so no other way in should stay open on the Auth0 side:

1. **Authentication → Database → Username-Password-Authentication → Applications**: turn the FolioMind application off.
2. **Authentication → Passwordless → Email** (and **SMS**): turn them off, or turn the FolioMind application off on their **Applications** tab.
3. Optional: **Applications → Applications → FolioMind → Settings → Advanced Settings → Grant Types**: untick **Passwordless OTP** and **Password**, then **Save**.

## 4. Application URLs

**Applications → Applications → FolioMind → Settings**

| Setting               | Value                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Application Login URI | `https://<your-domain>/login` (Auth0 sends users here when it needs a fresh sign-in, keeping them on FolioMind's screen) |
| Allowed Callback URLs | `https://<your-domain>/auth/callback`, plus `http://localhost:3000/auth/callback` in development                         |
| Allowed Logout URLs   | `https://<your-domain>`, plus `http://localhost:3000` in development                                                     |
| Allowed Web Origins   | `https://<your-domain>`, plus `http://localhost:3000` in development                                                     |

`<your-domain>` is the deployed site, for example `folio-mind-two.vercel.app` until a custom domain is set. Set the application name to `FolioMind`; Google and GitHub show it on their consent screens.

## 5. Optional: Universal Login fallback

FolioMind never links to Auth0's hosted page, but someone could still open it directly on the Auth0 domain. To keep it on brand anyway, in **Branding → Universal Login → Customization Options** set the logo to `https://<your-domain>/icons/icon-192.png`, the primary button color to `#4338CA` and the page background to `#F8FAFC`.

## Check

1. Open `https://<your-domain>/login` in a private window: FolioMind's screen appears, never Auth0's.
2. **Continue with Google** shows Google's account chooser and returns to the dashboard.
3. **Continue with GitHub** goes straight to GitHub and returns to the dashboard.
4. Visit `https://<your-domain>/dashboard/library` signed out: you are sent to `/login`, and after signing in you return to My Library.
