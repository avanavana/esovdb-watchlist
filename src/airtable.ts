import { ENV } from './env.js';
import type {
  AirtableCreateRecord,
  AirtableRecord,
  SubmissionFields,
  WatchlistFields,
} from './types.js';

interface AirtableRecordReference {
  id: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function getRequestMethod(init?: RequestInit): string {
  return (init?.method || 'GET').toUpperCase();
}

function getRequestBodyPreview(body: BodyInit | null | undefined): string {
  if (!body) return '';
  if (typeof body === 'string') return truncate(body, 1200);
  return '[non-text body]';
}

function getRetryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSeconds = Number(retryAfterHeader || '');

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  const jitterMs = Math.floor(Math.random() * 250);
  return 1000 * attempt + jitterMs;
}

function isRetriableAirtableStatus(status: number, method: string): boolean {
  if (status === 408 || status === 429 || status >= 500) return true;
  if (status === 406 && method !== 'POST') return true;
  return false;
}

function getAirtableUserAgent(): string {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  return repository
    ? `esovdb-watchlist-runner (${repository})`
    : 'esovdb-watchlist-runner';
}

function getResponseHeaderSummary(res: Response): string {
  const headerNames = [ 'retry-after', 'x-airtable-request-id', 'cf-ray', 'content-type' ];
  const values = headerNames
    .map((name) => {
      const value = res.headers.get(name);
      if (!value) return null;
      return `${name}=${value}`;
    })
    .filter((value): value is string => Boolean(value));

  return values.join(', ');
}

function airtableUrl(path: string): string {
  const u = new URL(`https://api.airtable.com/v0/${ENV.AIRTABLE_BASE_ID}${path}`);
  return u.toString();
}

async function airtableFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = getRequestMethod(init);
  const requestBodyPreview = getRequestBodyPreview(init?.body);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let res: Response;

    try {
      const headers: HeadersInit = {
        Authorization: `Bearer ${ENV.AIRTABLE_TOKEN}`,
        Accept: 'application/json',
        'User-Agent': getAirtableUserAgent(),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      };

      res = await fetch(airtableUrl(path), {
        ...init,
        headers,
      });
    } catch (err) {
      lastError = err;
      if (attempt === 4) break;
      console.warn(`[AIRTABLE] Request transport error on attempt ${attempt}/4: ${method} ${path}`);
      await sleep(getRetryDelayMs(attempt, null));
      continue;
    }

    if (res.ok) {
      return (await res.json()) as T;
    }

    const text = await res.text().catch(() => '');
    const shouldRetry = isRetriableAirtableStatus(res.status, method);
    const responseHeaderSummary = getResponseHeaderSummary(res);
    const requestSummaryParts = [
      `Airtable ${method} ${path} failed with status ${res.status}`,
      responseHeaderSummary ? `response headers: ${responseHeaderSummary}` : '',
      requestBodyPreview ? `request body: ${requestBodyPreview}` : '',
      text ? `response body: ${truncate(text, 2000)}` : '',
    ].filter(Boolean);
    lastError = new Error(requestSummaryParts.join(' | '));

    if (!shouldRetry || attempt === 4) {
      throw lastError;
    }

    console.warn(
      `[AIRTABLE] Retrying after status ${res.status} on attempt ${attempt}/4: ${method} ${path}`
    );
    await sleep(getRetryDelayMs(attempt, res.headers.get('retry-after')));
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('Airtable request failed.');
}

export async function getNextWatchlistRecord(): Promise<AirtableRecord<WatchlistFields> | null> {
  const table = encodeURIComponent(ENV.AIRTABLE_WATCHLIST_TABLE);

  const params = new URLSearchParams();
  params.set('maxRecords', '1');
  params.set('filterByFormula', "AND({Status}='Active', {ID}!='')");
  params.set('sort[0][field]', 'Last Checked');
  params.set('sort[0][direction]', 'asc');
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
    if (msg.includes('status 404')) return null;
    throw err;
  }
}

export async function updateWatchlistRecord(
  recordId: string,
  fields: Partial<WatchlistFields>
): Promise<void> {
  const table = encodeURIComponent(ENV.AIRTABLE_WATCHLIST_TABLE);

  await airtableFetch(`/${table}/${encodeURIComponent(recordId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

export async function createSubmissions(
  records: AirtableCreateRecord<SubmissionFields>[]
): Promise<string[]> {
  if (records.length === 0) return [];
  const table = encodeURIComponent(ENV.AIRTABLE_SUBMISSIONS_TABLE);

  const createdRecordIds: string[] = [];
  const pending = records.slice();

  while (pending.length) {
    const batch = pending.splice(0, 10);

    const createdBatch = await airtableFetch<{ records: AirtableRecordReference[] }>(`/${table}`, {
      method: 'POST',
      body: JSON.stringify({ records: batch }),
    });

    if (Array.isArray(createdBatch.records)) {
      for (const record of createdBatch.records) {
        if (record?.id) createdRecordIds.push(record.id);
      }
    }
  }

  return createdRecordIds;
}
