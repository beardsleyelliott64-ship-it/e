# Elliott+ v3

A compact, animated entertainment hub with live TMDB data.

## Live automatic data
The server fetches:
- Trending films
- Popular films
- Now playing
- Upcoming
- Trending TV
- Popular TV
- Airing today
- On the air
- Weekly mixed trending feed

Data is cached for 20 minutes and the browser refreshes the feeds every 30 minutes.

TMDB credentials are server-side only. Do not put the API key in `index.html`.

## Render
Build: `npm install`
Start: `npm start`

Required Render environment variable:
`TMDB_API_KEY`

Optional Discord environment variables:
`DISCORD_CLIENT_ID`
`DISCORD_CLIENT_SECRET`
`DISCORD_REDIRECT_URI`

The app automatically uses Render's `RENDER_EXTERNAL_URL` when building the default Discord callback, but setting `DISCORD_REDIRECT_URI` explicitly is recommended.

Example callback:
`https://YOUR-SERVICE.onrender.com/auth/discord/callback`

Never commit secrets to GitHub.
