function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const ENV = {
  ESOVDB_API_BASE_URL: required("ESOVDB_API_BASE_URL"),
  ESOVDB_KEY: required("ESOVDB_KEY"),
  AIRTABLE_TOKEN: required("AIRTABLE_TOKEN"),
  AIRTABLE_BASE_ID: required("AIRTABLE_BASE_ID"),
  AIRTABLE_ADMIN_BASE_ID: process.env.AIRTABLE_ADMIN_BASE_ID || "appiY4BA1rAyc3nT9",
  AIRTABLE_WATCHLIST_TABLE: process.env.AIRTABLE_WATCHLIST_TABLE || "Watchlist",
  AIRTABLE_SUBMISSIONS_TABLE: process.env.AIRTABLE_SUBMISSIONS_TABLE || "Submissions",
  AIRTABLE_WATCHLIST_RUNS_TABLE: process.env.AIRTABLE_WATCHLIST_RUNS_TABLE || "Watchlist Runs",
  AIRTABLE_WATCHLIST_CANDIDATES_TABLE:
    process.env.AIRTABLE_WATCHLIST_CANDIDATES_TABLE || "Watchlist Submission Candidates",
  WATCHLIST_DISCORD_NOTIFY_PATH: process.env.WATCHLIST_DISCORD_NOTIFY_PATH || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  SMART_FILTER_CONFIG_PATH: process.env.SMART_FILTER_CONFIG_PATH || "smart-filter.config.json",
  SMART_FILTER_MODEL: process.env.SMART_FILTER_MODEL || "",
  SMART_FILTER_OPENAI_BASE_URL: process.env.SMART_FILTER_OPENAI_BASE_URL || "https://api.openai.com/v1",
};
