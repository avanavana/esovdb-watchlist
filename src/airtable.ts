import { ENV } from "./env.js";
import type {
  AirtableCreateRecord,
  AirtableRecord,
  SubmissionFields,
  WatchlistFields,
} from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function airtableUrl(path: string): string {
  const u = new URL(`https://api.airtable.com/v0/${ENV.AIRTABLE_BASE_ID}${path}`);
  return u.toString();
}

async function airtableFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let res: Response;

    try {
      res = await fetch(airtableUrl(path), {
        ...init,
        headers: {
          Authorization: `Bearer ${ENV.AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    } catch (err) {
      lastError = err;
      if (attempt === 4) break;
      await sleep(1000 * attempt);
      continue;
    }

    if (res.ok) {
      return (await res.json()) as T;
    }

    const text = await res.text().catch(() => "");
    const retryAfter = Number(res.headers.get("retry-after") || "");
    const shouldRetry = res.status === 408 || res.status === 429 || res.status >= 500;
    lastError = new Error(`Airtable error ${res.status}: ${text}`);

    if (!shouldRetry || attempt === 4) {
      throw lastError;
    }

    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * attempt);
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("Airtable request failed.");
}

export async function getNextWatchlistRecord(): Promise<AirtableRecord<WatchlistFields> | null> {
  const table = encodeURIComponent(ENV.AIRTABLE_WATCHLIST_TABLE);

  const params = new URLSearchParams();
  params.set("maxRecords", "1");
  params.set("filterByFormula", "AND({Status}='Active', {ID}!='')");
  params.set("sort[0][field]", "Last Checked");
  params.set("sort[0][direction]", "asc");
  const url = `/${table}?${params.toString()}`;

  const data = await airtableFetch<{ records: AirtableRecord<WatchlistFields>[] }>(url);
  return data.records[0] || null;
}

export async function getWatchlistRecordById(
  recordId: string
): Promise<AirtableRecord<WatchlistFields> | null> {
  if (!recordId) return null;
  const table = encodeURIComponent(ENV.AIRTABLE_WATCHLIST_TABLE);

  try {
    return await airtableFetch<AirtableRecord<WatchlistFields>>(`/${table}/${encodeURIComponent(recordId)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Airtable error 404")) return null;
    throw err;
  }
}

export async function updateWatchlistRecord(
  recordId: string,
  fields: Partial<WatchlistFields>
): Promise<void> {
  const table = encodeURIComponent(ENV.AIRTABLE_WATCHLIST_TABLE);

  await airtableFetch(`/${table}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

export async function createSubmissions(records: AirtableCreateRecord<SubmissionFields>[]): Promise<number> {
  if (records.length === 0) return 0;
  const table = encodeURIComponent(ENV.AIRTABLE_SUBMISSIONS_TABLE);

  let created = 0;
  const pending = records.slice();

  while (pending.length) {
    const batch = pending.splice(0, 10);
    
    const createdBatch = await airtableFetch<{ records: unknown[] }>(`/${table}`, {
      method: "POST",
      body: JSON.stringify({ records: batch }),
    });
    
    created += Array.isArray(createdBatch.records) ? createdBatch.records.length : batch.length;
  }

  return created;
}
