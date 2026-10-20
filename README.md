# CreatorPilot AI

> **Unified Instagram Creator Intelligence, Analytics & Multi-Format AI Studio**

CreatorPilot AI is an editorial-grade web application engineered for Instagram creators and digital influencers. It pairs authoritative Meta Graph API analytics telemetry with an AI creative studio, drafts vault, trend research, and multi-format content planning.

---

## Key Features

- **Authoritative Audience Telemetry:** Real-time Reach, Views, and historical Follower tracking via official Meta Graph API endpoints with resilient 15-minute server-side telemetry caching.
- **AI Creative Studio:**
  - **Idea Lab:** Context-aware content ideation tailored to creator niche and audience tone.
  - **Caption Studio:** Engagement-optimized captions with multi-language and hook options.
  - **Carousel Generator:** Multi-slide storyboards with structured visual direction.
  - **Repurposing Studio:** Cross-format content transposition across Reels, Carousels, Stories, and Feed posts.
  - **Creator AI Chat:** Interactive creator persona assistant with prompt sanitization.
  - **Drafts Vault:** Full-featured, schema-validated draft management.
- **Real-Time Internet Trend Research:** Live RSS and trend ingestion (Google News, Google Trends, Meta Newsroom) paired with Gemini synthesis.
- **Production-Grade Theme System:** Seamless Light Mode, Dark Mode, and System OS preference with zero Flash of Unstyled Content (FOUC).
- **Security & Privacy:** Server-side token exchange, AES-256-GCM encrypted credential storage, strict Supabase Row Level Security (RLS), and zero telemetry leakage.

---

## Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org) (App Router, Turbopack & Webpack support)
- **UI & Styling:** [Tailwind CSS v4](https://tailwindcss.com) with adaptive design tokens
- **Runtime:** React 19
- **Backend & Auth:** [Supabase](https://supabase.com) (SSR Cookie Session Management, PostgreSQL RLS)
- **AI Engine:** Google Gemini (default: `gemini-3.5-flash-lite`)
- **API Integration:** Meta Graph API (Instagram Business & Creator Accounts)
- **Typography:** Self-hosted Geist Sans & Geist Mono via `next/font/local` (SIL OFL 1.1)

---

## Prerequisites

Before setting up CreatorPilot AI, ensure you have:

- **Node.js:** v20.x or v22.x LTS installed
- **Package Manager:** `npm` (bundled with Node.js)
- **Git:** Version 2.30+ installed
- **Accounts & Services:**
  1. A [Supabase](https://supabase.com) account (free tier is fully supported)
  2. A [Google AI Studio](https://aistudio.google.com) account for a Gemini API key
  3. A [Meta for Developers](https://developers.facebook.com) account with access to an Instagram Professional (Business or Creator) account

---

## Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/naman-sharma-hsp/creatorpilot_ai.git
   cd creatorpilot_ai
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Copy the provided environment template to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Open `.env.local` and fill in your Supabase, Meta, and Gemini credentials (detailed in the next section). **Never commit `.env.local` to version control.**

4. **Run database migrations:**
   Apply the SQL migrations located in `supabase/migrations/` to your Supabase project (see [Supabase Database Setup](#supabase-database-setup)).

5. **Start the development server:**
   ```bash
   npm run dev
   ```

6. **Open the application:**
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

## Environment Variables

The project uses `.env.example` as the canonical reference for environment variables. All secrets must remain server-side and should never be exposed with the `NEXT_PUBLIC_` prefix.

| Variable | Scope | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public (Client/Server) | Your Supabase project URL (`https://<project-ref>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (Client/Server) | Supabase publishable anonymous API key. Safe for client exposure; constrained by PostgreSQL RLS. |
| `APP_URL` | Server-Only | Canonical application URL (e.g. `http://localhost:3000` locally, or `https://your-domain.vercel.app` in production). Used to enforce HTTPS callback verification and prevent Host header injection. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-Only | Privileged Supabase key that bypasses RLS. Used strictly for internal server-side credential encryption and OAuth state consumption. |
| `INSTAGRAM_APP_ID` | Server-Only | Meta App ID from the Meta Developer Dashboard. |
| `INSTAGRAM_APP_SECRET` | Server-Only | Meta App Secret from the Meta Developer Dashboard. |
| `INSTAGRAM_TOKEN_ENCRYPTION_KEY` | Server-Only | 64-character hexadecimal string (32-byte key) used for AES-256-GCM access token encryption at rest. |
| `INSTAGRAM_GRAPH_API_VERSION` | Server-Only | Meta Graph API version string (defaults to `v26.0`). |
| `GEMINI_API_KEY` | Server-Only | API key from Google AI Studio. |
| `GEMINI_MODEL` | Server-Only | Optional override for Gemini model (defaults to `gemini-3.5-flash-lite`). |

### Generating the Token Encryption Key
Generate a secure 32-byte AES-256-GCM key using Node.js:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the 64-character hex string and paste it into `INSTAGRAM_TOKEN_ENCRYPTION_KEY` in `.env.local`.

---

## Supabase Database Setup

CreatorPilot AI relies on PostgreSQL Row Level Security (RLS) and triggers to maintain strict data boundaries.

### Applying Migrations
Apply the migrations located in the `supabase/migrations/` directory in sequential order:

1. `20261018000000_init_auth_and_profiles.sql` — Initializes `public.profiles`, `public.connected_accounts`, `public.content_drafts`, and the `on_auth_user_created` trigger.
2. `20261018180000_add_account_credentials.sql` — Creates `public.account_credentials` for encrypted token storage, applies strict RLS (accessible only by `service_role`), and hardens account mutation policies.
3. `20261018190000_add_instagram_oauth_states.sql` — Sets up `public.instagram_oauth_states` for hashed single-use state verification and adds atomic state consumption functions.
4. `20261019000000_add_profile_preferences.sql` — Adds creator persona preferences to `public.profiles`.

#### Option A: Via Supabase Web Dashboard (Recommended for Beginners)
1. Navigate to your Supabase project dashboard at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open the **SQL Editor** from the left navigation.
3. Paste and run each migration file sequentially from `supabase/migrations/`.

#### Option B: Via Supabase CLI
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

---

## Instagram Integration & Meta Setup

### Account Eligibility
- **Supported:** Instagram **Professional** accounts (Business or Creator).
- **Unsupported:** Personal Instagram accounts (the Meta Graph API does not provide telemetry or token exchange for personal profiles).

### Meta Developer App Configuration
1. Log in to the [Meta for Developers](https://developers.facebook.com) dashboard.
2. Click **My Apps** &rarr; **Create App**. Select **Other** &rarr; **Business** (or Consumer).
3. Under **Add Use Cases** or **Add Products**, select **Instagram** / **API Setup with Instagram Login**.
4. Navigate to **Instagram** &rarr; **Basic Display** or **Instagram Business Login Settings**.
5. Register the exact redirect URI in the **Valid OAuth Redirect URIs** field:
   - For local development: `http://localhost:3000/api/auth/instagram/callback` (or your HTTPS tunnel URL)
   - For production: `https://<YOUR-DOMAIN>/api/auth/instagram/callback`
6. In **App Settings** &rarr; **Basic**, copy your **App ID** and **App Secret** into `.env.local`.

### Permissions & App Modes
- **Development Mode:** The app works immediately for accounts added under **App Roles** &rarr; **Roles** &rarr; **Instagram Testers**.
- **Production Mode:** Requires Meta App Review for `instagram_business_basic` and `instagram_business_manage_insights` to allow external Instagram users to connect.

---

## Gemini AI Setup

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Sign in with your Google account and click **Create API Key**.
3. Copy the key and assign it to `GEMINI_API_KEY` in `.env.local`.
4. The application defaults to `gemini-3.5-flash-lite`, which offers fast, high-quality multimodal inference within Google's free-tier limits.

---

## Testing & Quality Verification

Run the test suite and quality verification scripts using the installed Node.js runtime:

```bash
# 1. Run static analysis (ESLint)
npm run lint

# 2. Run TypeScript strict type-checking
npx tsc --noEmit

# 3. Run unit and integration tests (362 tests across 34 suites)
node --test tests/*.test.mjs

# 4. Run production build with Webpack
npx next build --webpack
```

---

## Vercel Deployment

1. **Push your code to GitHub:**
   Ensure `.env.local` and all private notes remain Git-ignored.

2. **Import Project into Vercel:**
   Connect your GitHub repository to [Vercel](https://vercel.com).

3. **Configure Environment Variables in Vercel:**
   In your Vercel project settings (**Settings** &rarr; **Environment Variables**), add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_URL` — Set to your production domain: `https://<your-project>.vercel.app`
   - `INSTAGRAM_APP_ID`
   - `INSTAGRAM_APP_SECRET`
   - `INSTAGRAM_TOKEN_ENCRYPTION_KEY`
   - `INSTAGRAM_GRAPH_API_VERSION` (`v26.0`)
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` (`gemini-3.5-flash-lite`)

4. **Register the Production Callback URI with Meta:**
   Add `https://<your-project>.vercel.app/api/auth/instagram/callback` to your **Valid OAuth Redirect URIs** in the Meta Developer Dashboard.

---

## Security Invariants & Limitations

- **Credential Encryption:** Meta access tokens are never stored in plaintext; they are encrypted using authenticated AES-256-GCM with unique random IVs per record.
- **Row Level Security:** Database queries through client sessions are strictly isolated by `auth.uid() = user_id`.
- **Server Separation:** AI keys, Meta secrets, and service-role keys are guarded by `import "server-only"` and will fail compilation if ever imported into client components.
- **Rate Limits & Budgets:** The platform enforces strict ₹0-budget resilience:
  - Instagram analytics responses are cached for 15 minutes to respect Meta Graph API rate limits.
  - Gemini quota exhaustion (HTTP 429) degrades gracefully with informative UI banners rather than crashing or triggering paid fallbacks.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
Font files (`app/fonts/`) are licensed separately under the [SIL Open Font License 1.1](app/fonts/LICENSE).
