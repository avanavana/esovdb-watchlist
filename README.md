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
- Sets `Trigger Source` on the run to `Scheduled`, `Manual GitHub`, or `API`
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
- `smartFilterCandidateLimit`
- `smartFilterSourcePrompt`

The same dry run can be run locally after building:

```bash
WATCHLIST_RECORD_ID="rec..." pnpm run smart-filter:dry-run
```

The ESOVDB API can also queue dry runs and return JSON results for Postman-style testing:

```bash
curl -X POST "$ESOVDB_API_BASE_URL/watch/smart-filter/dry-run" \
  -H "x-esovdb-key: $ESOVDB_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "watchlistRecordId": "rec...",
    "smartFilterCandidateLimit": 10,
    "smartFilterExcludeThreshold": 0.5,
    "smartFilterAutoIncludeThreshold": 0.85,
    "smartFilterSourcePrompt": "Prioritize lectures and field-trip videos."
  }'
```

The response includes a `dryRunId`. Poll the result with:

```bash
curl "$ESOVDB_API_BASE_URL/watch/smart-filter/dry-run/sfdr_..." \
  -H "x-esovdb-key: $ESOVDB_KEY"
```

## Overturning an Excluded Candidate

The Admin base can include an excluded `Watchlist Submission Candidates` record with one click without storing an API key in a Scripting Extension. The button's Script Extension at `airtable-scripts/include-excluded-candidate.js` validates the candidate and checks its `Flag for Inclusion` field. An Airtable Automation watches that field and runs `airtable-scripts/process-excluded-candidate-override.js`, which reads the existing ESOVDB API key from Airtable's secret store and makes one request to create the cross-base submission.

- verifies that the candidate is excluded and has no linked submission
- retrieves fresh YouTube metadata
- creates a main-base `Submissions` record with the original run, candidate, relevance, and watchlist-source links

After the API returns the submission record ID, the Automation changes `Classifier Result` to `Include`, replaces `Classifier Reason` with an audit message that preserves the original exclusion reason, stores the created `Submission Record ID`, and clears `Flag for Inclusion`. If the request fails, the Automation clears the flag and reports a failed run so the button can be tried again. A retry after the API created a submission but before Airtable was updated recovers the existing submission by `Candidate ID`.

Set up the button as follows:

1. Add a `Flag for Inclusion` checkbox field to `Watchlist Submission Candidates`.
2. Add an Airtable Automation secret named `ESOVDB_API_KEY` containing the existing ESOVDB API key matching the API server's `ESOVDB_KEY`.
3. Create an Automation triggered when `Flag for Inclusion` is checked, `Classifier Result` is `Exclude`, and `Submission Record ID` is empty.
4. Add a **Run a script** Automation action using `airtable-scripts/process-excluded-candidate-override.js`. Add a `candidateRecordId` input variable mapped to the triggering record's Airtable record ID.
5. Add a Scripting Extension to the Admin base using `airtable-scripts/include-excluded-candidate.js`.
6. Add an `Include` button field, choose **Run script**, and select the Scripting Extension.
7. Use a view filtered to `Classifier Result = Exclude` and an empty `Submission Record ID`, because Airtable button fields do not support per-row conditional visibility.

The Scripting Extension uses the active table and its first `input.recordAsync` call, so it works from either the connected button or the standalone extension. It rejects other tables, non-excluded candidates, and candidates that already contain a submission record ID. The secret syntax belongs only in the Automation script: `input.secret('ESOVDB_API_KEY')`.

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
