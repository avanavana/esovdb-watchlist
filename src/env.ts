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
  AIRTABLE_WATCHLIST_TABLE: process.env.AIRTABLE_WATCHLIST_TABLE || "Watchlist",
  AIRTABLE_SUBMISSIONS_TABLE: process.env.AIRTABLE_SUBMISSIONS_TABLE || "Submissions",
};
