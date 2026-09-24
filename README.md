# Elliott+

A redesigned Elliott+ entertainment hub.

## What changed

- Removed the AI Games section and game cards.
- Fixed navigation so Home, Films, Charts, This Week and 2026 are real working tabs.
- Added animated page transitions, moving background light, particles, card effects and responsive mobile navigation.
- Added search filtering.
- Added Discord OAuth sign-in.
- Signed-in profile shows Discord avatar, display name, username and Discord user ID.
- Clicking the top-right profile opens the profile menu.

## Render

This is a Node web service.

Build command:
`npm install`

Start command:
`npm start`

The app listens on `0.0.0.0` and `process.env.PORT`.

## Discord OAuth setup

Create a Discord application in the Discord Developer Portal.

Add this Redirect URI to the OAuth2 settings:

`https://YOUR-RENDER-SERVICE.onrender.com/auth/discord/callback`

Then add these Render environment variables:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `SESSION_SECRET`

Never put the Discord client secret in GitHub.

`DISCORD_REDIRECT_URI` must exactly match the Redirect URI registered in Discord.
