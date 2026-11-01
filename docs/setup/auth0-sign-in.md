# Auth0 sign-in setup

FolioMind uses its own sign-in screen: the `/login` page and the sign-in dialog share one panel with **Continue with Google**, **Continue with GitHub** and **email codes**. Auth0's hosted Universal Login page is never part of the flow:

- Google and GitHub buttons send `connection=google-oauth2` or `connection=github`, so Auth0 forwards the user straight to the provider.
- Email sign-in uses Auth0 Passwordless: FolioMind's server asks Auth0 to email a 6-digit code, and the code is entered on FolioMind's screen. Requests are rate-limited per visitor and per address (Upstash).
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

If GitHub stays off, the GitHub button leads to an Auth0 error page, so either enable it or tell your developer to hide the button.

## 3. Email codes (Passwordless)

1. **Authentication → Passwordless → Email**: turn it on.
   - **From**: an address on your domain, for example `FolioMind <no-reply@your-domain>`.
   - **Subject**: `Your FolioMind sign-in code`.
   - **OTP Length**: 6. **OTP Expiry**: 300 seconds (the default).
   - **Disable Sign Ups**: leave off, so new readers can create an account with their email.
   - **Body**: Auth0 replaces `{{ code }}` with the code. A minimal branded template:

     ```html
     <div
       style="font-family: Inter, Arial, sans-serif; color: #0f172a; max-width: 480px; margin: 0 auto; padding: 24px"
     >
       <p style="font-size: 18px; font-weight: 700; color: #4338ca">FolioMind</p>
       <p>Use this code to sign in to FolioMind:</p>
       <p
         style="font-size: 32px; font-weight: 700; letter-spacing: 8px; background: #eef2ff; color: #3730a3; padding: 16px; text-align: center; border-radius: 10px"
       >
         {{ code }}
       </p>
       <p style="color: #475569">
         It expires in 5 minutes. If you didn't try to sign in, you can ignore this email.
       </p>
     </div>
     ```

   - **Applications** tab: turn it on for the FolioMind application.
2. **Applications → Applications → FolioMind → Settings → Advanced Settings → Grant Types**: tick **Passwordless OTP**, then **Save**. Without it, codes are sent but cannot be verified.
3. **Branding → Email Provider**: connect a real provider (SMTP, SendGrid, Mailgun, Amazon SES, …) before launch. Auth0's built-in provider is for testing and sends only a small number of emails.

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
2. **Continue with Google** goes straight to Google's account chooser and returns to the dashboard.
3. Enter your email, receive the code, enter it: you land on the dashboard (or the page you came from).
4. Visit `https://<your-domain>/dashboard/library` signed out: you are sent to `/login`, and after signing in you return to My Library.
