# Hitline

## Deploy
1. Push this folder to GitHub and import it in Netlify (no build command needed; publish dir is `public`).
2. Site settings > Environment variables:
   - `ODDS_API_KEY` (required, from the-odds-api.com; player props need a paid plan)
   - `ODDS_REGIONS` (default `us`; check which books you need)
   - `HORIZON_HOURS` (default `36`, how far ahead to pull games)
   - `REFRESH_KEY` (any secret string, protects the refresh trigger)
3. Deploy. The scheduled refresh runs every 2 hours on the production deploy. To fill data right away:
   `curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/build-background -H "x-refresh-key: YOUR_KEY"`
4. Check function logs in Netlify if `/api/props` says data is still loading.

Odds API credits: each refresh costs roughly games x markets x regions. Change the cron in `netlify/functions/refresh.mjs` to control spend.
