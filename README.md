# Elliott+ v6.1 — fixed full version

This build preserves the Elliott+ v6 feature set and removes the accidental JavaScript syntax error in `server.js`.

## Included
- Home, Films, TV, This Week, 2026, Charts, Watchlist and Premium tabs
- Search
- Animated UI/background
- Compact responsive cards
- Local watchlist
- Discord OAuth
- Profile/user ID display
- Stripe subscription checkout
- MetaHub film/series provider
- TVmaze schedule/update data
- Render Blueprint with `/health`
- No TMDB dependency

## Render
Build command: `npm install`
Start command: `npm start`

Render web services should bind to `0.0.0.0` and the `PORT` environment variable; this server does that. The included health check is `/health`.

## Discord
Set:
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
DISCORD_REDIRECT_URI=https://e-qyxq.onrender.com/auth/discord/callback

## Stripe
Set:
STRIPE_SECRET_KEY
STRIPE_PRICE_MONTHLY
STRIPE_PRICE_YEARLY
STRIPE_WEBHOOK_SECRET

The current checkout flow creates Stripe subscription Checkout Sessions. Production subscription entitlement should be persisted/confirmed from Stripe webhooks and a database before being treated as authoritative.

## MetaHub
Set `METAHUB_API_KEY`.

## TVmaze attribution
TV schedule/update data comes from TVmaze. Retain the attribution and comply with its applicable terms when distributing the site.
