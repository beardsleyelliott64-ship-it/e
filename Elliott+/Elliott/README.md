# Elliott+ v6 — Full build, no TMDB

This is the restored/full version. TMDB is completely removed.

## Included
- Home
- Films
- TV
- This Week
- 2026
- Charts
- Search entry
- Watchlist
- Discord login
- Account menu
- Premium page
- Stripe subscription checkout
- Automatic server-side feed caching
- Render configuration
- Responsive premium UI
- Trailer buttons when the provider supplies YouTube trailer IDs

## Data
### MetaHub
Set `METAHUB_API_KEY` in Render. MetaHub's current API docs provide `/v1/find` for popular movies/series and `/v1/search` and `/v1/get`; its current pricing page says its plans include a commercial-use license. The current plans are $3.49/month, $39.99/year, or $199.99 lifetime, with request quotas. Verify the provider's current terms before launch.

### TVmaze
TV data also uses TVmaze's public API. TVmaze currently documents its public API as CC BY-SA with attribution/ShareAlike requirements.

## Discord
For your Render site:
`https://e-qyxq.onrender.com/auth/discord/callback`

Put that exact URI in Discord Developer Portal and in `DISCORD_REDIRECT_URI`.

## Stripe
Create two recurring Stripe prices and put their Price IDs in:
- STRIPE_PRICE_MONTHLY
- STRIPE_PRICE_YEARLY

Put the secret key in `STRIPE_SECRET_KEY`.

The checkout flow is included. For production subscriptions, add a Stripe webhook/database before relying on Premium status for protected features.

## Important
- Never commit API keys or Stripe secrets to GitHub.
- This package contains no TMDB integration.
- Render's free plan is suitable for initial testing but is not the same as production-scale hosting.
