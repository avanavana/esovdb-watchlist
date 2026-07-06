# ESOVDB Watchlist Runner

Standalone TypeScript runner for ESOVDB YouTube watchlist ingestion via GitHub Actions.

## What It Does

- Selects the oldest `Active` watchlist row in Airtable (`Last Checked` ascending, blanks first)
- Calls the ESOVDB API YouTube ingestion endpoints (channel or playlist)
- Creates Airtable `Submissions` records in batches of 10
- Optionally classifies candidates with metadata-only smart filtering before creating submissions
- Appends created submission record links onto the watchlist row's `Submissions` field
- Updates `Last Checked` and `Last Checked Notes`
- Fails visibly in GitHub Actions on API/Airtable errors (while still writing an error note when possible)
- Retries transient Airtable failures, including intermittent `406 blocked` responses on non-`POST` requests
- Includes Airtable request method/path/body details in thrown errors to make GitHub Actions failures actionable

## Runtime Rules

- Uses Airtable as state (no local queue/state)
- Does not call the YouTube Data API directly
- Does not implement dedupe (Airtable automation handles it)

## Required GitHub Secrets

- `ESOVDB_API_BASE_URL` (e.g. `https://api.esovdb.org`)
- `ESOVDB_KEY`
- `AIRTABLE_TOKEN`
- `AIRTABLE_BASE_ID`
- `OPENAI_API_KEY` (required only for Watchlist sources with `Smart Filtering` enabled)

Optional secrets (defaults shown):

- `AIRTABLE_WATCHLIST_TABLE` (defaults to `Watchlist`)
- `AIRTABLE_SUBMISSIONS_TABLE` (defaults to `Submissions`)
- `AIRTABLE_ADMIN_BASE_ID` (defaults to `appiY4BA1rAyc3nT9`)
- `AIRTABLE_WATCHLIST_RUNS_TABLE` (defaults to `Watchlist Runs`)
- `AIRTABLE_WATCHLIST_CANDIDATES_TABLE` (defaults to `Watchlist Submission Candidates`)
- `SMART_FILTER_MODEL` (defaults to `smart-filter.config.json` `defaultModel`)
- `SMART_FILTER_CONFIG_PATH` (defaults to `smart-filter.config.json`)

## Smart Filtering

Smart filtering is opt-in per Watchlist source. When `Smart Filtering` is false or missing, the runner uses the existing submission flow.

When enabled, the runner:

- Creates a `Watchlist Runs` record in the Admin base
- Classifies each candidate video with the metadata-only prompt in `smart-filter.config.json`
- Creates `Watchlist Submission Candidates` records for every classified candidate
- Creates Submissions only for `Include` and `Needs Review`
- Sets `Smart Filter Needs Review` on the Submission when the classifier result is `Needs Review`

The per-source Airtable prompt field is `Smart Filter Source Prompt`; it is appended to the classifier user message with the video metadata. The single system prompt lives in `smart-filter.config.json`.

## Smart Filter Dry Run

Manual GitHub Actions runs can enable `smartFilterDryRun` to classify candidate videos without creating or updating Airtable records. The Actions log prints every candidate video with its result, score, reason, dominant topics, and a summary.

Optional manual-run inputs can override dry-run thresholds and source prompt:

- `smartFilterExcludeThreshold`
- `smartFilterAutoIncludeThreshold`
- `smartFilterSourcePrompt`

The same dry run can be run locally after building:

```bash
WATCHLIST_RECORD_ID="rec..." pnpm run smart-filter:dry-run
```

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
