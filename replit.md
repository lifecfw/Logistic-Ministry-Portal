# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 20
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: Replit PostgreSQL (pg driver — standard node-postgres)
- **Validation**: Zod
- **Build**: esbuild

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/afmod build` — build frontend static files to `artifacts/afmod/dist/public`
- `pnpm --filter @workspace/api-server build` — build API server to `artifacts/api-server/dist/index.mjs`
- `node --enable-source-maps artifacts/api-server/dist/index.mjs` — start the server (PORT must be set)

## Workflows

- **`Start application`** — Builds frontend + API server, then starts Express on port 5000

## Required Environment Variables / Secrets

- `PORT` — set to `5000` for API server
- `DISCORD_GUILD_ID` — Discord server ID
- `AFMOD_BOT_URL` — URL of the external AFMOD showroom bot
- `DATABASE_URL` — Replit PostgreSQL connection string (managed secret)
- `SESSION_SECRET` — HMAC secret for signed session cookies (secret)
- `DISCORD_BOT_TOKEN` — Discord bot token for auth DMs (secret)
- `AFMOD_BOT_API_KEY` — API key for the showroom bot (secret)

## City Name

- Arabic: **عرب فيرست**
- English: **Arab First**
- Copyright: © 2026 Arab First — جميع الحقوق محفوظة

## AFMOD Artifact (`artifacts/afmod`)

Arabic RTL ministry portal "وزارة اللوجستيك — Arab First City" with Discord auth. **Pure vanilla HTML / CSS / JavaScript** — no React, no TypeScript, no Tailwind. Vite is used solely to bundle and copy static files to `dist/public`.

- **File structure**:
  - `index.html` — landing portal with system cards
  - `styles.css` — full design system (navy/gold tokens)
  - `houses.js`, `cars.js`, `gas-stations.js` — data + helpers
  - `app.js` — IIFE auth, dashboard, dialogs, purchase events
  - `messages.html`, `social.html` — messaging + social pages
  - `business.html` — business management UI (gas/grocery/barber) with profit chart, inventory store, discount system
  - `manufacture.html` — manufacturing system (mine → quiz → craft weapon) + admin panel (n16q only)
  - `house-manage.html` — house rental management (set rental, stats, bookings, withdraw)
  - `my-properties.html` — owned houses & cars with manage links
  - `public/` — static assets (logo, marble bg, favicon)
  - `vite.config.js` — multi-page static build config

- **Auth flow**: Discord username → POST `/api/auth/request-code` → bot DMs 6-digit code → POST `/api/auth/verify-code` → signed-cookie session (7d)

## API Server (`artifacts/api-server`)

Express 5 server with routes:
- `GET /api/healthz` — health check
- `/api/auth/*` — Discord DM verification auth
- `/api/showroom/*` — proxy to AFMOD bot for purchases
- `/api/messages/*` — in-portal messaging (DMs + groups)
- `/api/twitter/*` — Twitter-like social system (admin: n16q)
- `/api/business/*` — business management (gas/grocery/barber + 9 new types); supports discountPct 0–30% on refill
- `/api/showroom/buy-business` — generic POST endpoint forwarding all non-legacy business purchases to the bot
- `/api/manufacture/*` — mining resources, quiz, table purchase, craft weapon, admin-give (n16q: infinite resources, no cooldown)
- `/api/house/*` — house rental system (set-rental, listings, state, rent, withdraw)

Database schema is auto-created on startup via `initSchema()` in `src/lib/db.ts`.

## Database Tables

- `business_state` — inventory %, accumulated profit, refill timestamps
- `business_profit_log` — earnings history for charts
- `manufacture_resources` — per-user mined resources + discord_username column
- `manufacture_table_purchases` — who bought a crafting table
- `manufacture_crafts` — completed weapon crafts
- `house_rental_listings` — active rental listings per house
- `house_rental_bookings` — rental booking records
- `house_rental_state` — per-property earnings/cooldowns
- `house_rental_profit_log` — rental profit history

## Business System

- **Gas station**: earns $2,083–4,167/hr passively + $300K–500K weekly bonus
- **Grocery store**: earns $833–2,083/hr passively + $100K–300K weekly bonus; 20 specific item types (كرتون مياه, بسكويت, etc.)
- **Barber shop**: earns passively
- **Cafe** (`cafes.html`): Liberty Cafe + Spring Bakery — earns $700–1,500/hr
- **Restaurants** (`restaurants.html`): La Mesa (mexican) + Three Guys (burger) + Rick & John's (rickjohns) — earns $625–1,667/hr
- **Stores** (`stores.html`): Liberty Apparel (apparel) + Dollar Store (dollar) + Tool Store (tools) + Country Market (market) + Family Jewels (jewels) + Liberty Guns & Ammo (guns)
- **Bank** (`bank.html`): Bank of River City — earns $1,250–3,333/hr (highest)
- All new businesses bought via `POST /api/showroom/buy-business` with `{businessType, shopId}` forwarded to bot
- Inventory depletes 4%/hr — profits stop at 0%
- **Discount system**: gas & grocery owners can set 0–30% discount on supplies (validated server-side)
- Supply price shown with strikethrough original + green discounted price in UI
- All 15 business types have full inventory store items defined in `business.html`

## House System

- 6 house types: single-trailer ($55K), log-cabin ($65K), double-trailer ($72K), small-house ($85K), medium-house ($130K), large-house ($220K)
- House rental: owners set daily price (10–15% of house value), manage bookings, withdraw profit
- `house-manage.html` — rental settings, profit chart, bookings list, withdraw button

## Manufacturing System

- Flow: Mine resources → Pass quiz → Buy table ($6K) → Draw weapon path → Get Discord role
- Admin (n16q): gets 9,999 of every resource per mine, no cooldown; has admin panel to give resources to any user
- Admin panel in `manufacture.html` shows only for n16q; uses `/api/manufacture/admin-give`

## Hosting topology (Replit)

- Single workflow: builds frontend into `artifacts/afmod/dist/public`, then Express serves both API and static files on port 5000
- Frontend static assets are served directly by Express from the built dist folder
