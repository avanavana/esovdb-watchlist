# ESOVDB Watchlist Runner

Standalone TypeScript runner for ESOVDB YouTube watchlist ingestion via GitHub Actions.

## What It Does

- Selects the oldest `Active` watchlist row in Airtable (`Last Checked` ascending, blanks first)
- Calls the ESOVDB API YouTube ingestion endpoints (channel or playlist)
- Creates Airtable `Submissions` records in batches of 10
- Updates `Last Checked` and `Last Checked Notes`
- Fails visibly in GitHub Actions on API/Airtable errors (while still writing an error note when possible)

## Runtime Rules

- Uses Airtable as state (no local queue/state)
- Does not call the YouTube Data API directly
- Does not implement dedupe (Airtable automation handles it)

## Required GitHub Secrets

- `ESOVDB_API_BASE_URL` (e.g. `https://api.esovdb.org`)
- `ESOVDB_KEY`
- `AIRTABLE_TOKEN`
- `AIRTABLE_BASE_ID`

Optional secrets (defaults shown):

- `AIRTABLE_WATCHLIST_TABLE` (defaults to `Watchlist`)
- `AIRTABLE_SUBMISSIONS_TABLE` (defaults to `Submissions`)

## Local Run

```bash
npm install
npm run build
ESOVDB_API_BASE_URL="https://api.esovdb.org" \
ESOVDB_KEY="..." \
AIRTABLE_TOKEN="..." \
AIRTABLE_BASE_ID="..." \
node dist/index.js
```

## Notes

- `publishedAfter` is chosen as: `Last Checked` -> `Published After` -> `null`
- Channel endpoint receives `length` + `publishedAfter`
- Playlist endpoint receives only `playlist` (no published-after filtering supported by API)
