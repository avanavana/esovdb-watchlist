import { getNextWatchlistRecord, getWatchlistRecordById } from './airtable.js';
import { ENV } from './env.js';
import { fetchEsovdbVideos } from './esovdb.js';
import {
  classifyVideoMetadata,
  getSmartFilterMode,
  getSmartFilterSourcePrompt,
  getSmartFilterThresholds,
  loadSmartFilterConfig,
  type SmartFilterThresholds
} from './smartFilter.js';
import type { ClassifierResult, EsovdbVideo, WatchlistFields } from './types.js';
import { countLabel, pickPublishedAfter } from './utils.js';

interface DryRunResult {
  video: {
    id: string;
    title: string;
    url: string;
    channel: string;
    channelId: string;
    date: string | null;
    runningTime: number | string | null;
  };
  result: ClassifierResult;
  relevanceScore: number | null;
  reason: string;
  dominantTopics: string[];
  error: string;
}

interface DryRunSummary {
  include: number;
  needsReview: number;
  exclude: number;
  error: number;
}

interface DryRunPayload {
  ok: boolean;
  dryRunId: string;
  status: 'Completed';
  completedAt: string;
  source: {
    recordId: string;
    id: string;
    type: string;
    name: string;
  };
  filters: {
    duration: string;
    publishedAfter: string | null;
  };
  thresholds: SmartFilterThresholds;
  candidateLimit: number | null;
  apiReturnedVideos: number;
  classifiedVideos: number;
  summary: DryRunSummary;
  results: DryRunResult[];
}

interface FailedDryRunPayload {
  ok: false;
  dryRunId: string;
  status: 'Failed';
  completedAt: string;
  error: string;
}

export type SmartFilterDryRunCallbackPayload = DryRunPayload | FailedDryRunPayload;

function parseOptionalThreshold(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number from 0.0 to 1.0.`);
  }

  return value;
}

function getDryRunCandidateLimit(): number | null {
  const raw = process.env.SMART_FILTER_DRY_RUN_CANDIDATE_LIMIT?.trim();
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('SMART_FILTER_DRY_RUN_CANDIDATE_LIMIT must be a positive integer.');
  }

  return value;
}

function getDryRunThresholds(fields: WatchlistFields): SmartFilterThresholds {
  const thresholds = getSmartFilterThresholds(fields);
  const excludeOverride = parseOptionalThreshold('SMART_FILTER_DRY_RUN_EXCLUDE_THRESHOLD');
  const autoIncludeOverride = parseOptionalThreshold('SMART_FILTER_DRY_RUN_AUTO_INCLUDE_THRESHOLD');
  const exclude = excludeOverride ?? thresholds.exclude;
  const autoInclude = autoIncludeOverride ?? thresholds.autoInclude;

  if (autoInclude < exclude) {
    throw new Error('Dry-run auto-include threshold must be greater than or equal to exclude threshold.');
  }

  return {
    exclude,
    autoInclude
  };
}

function getDryRunSourcePrompt(fields: WatchlistFields): string {
  return process.env.SMART_FILTER_DRY_RUN_SOURCE_PROMPT || getSmartFilterSourcePrompt(fields);
}

function formatScore(value: number | null): string {
  if (value === null) return 'n/a';
  return value.toFixed(2);
}

function formatVideoUrl(video: EsovdbVideo): string {
  return `https://youtu.be/${video.id}`;
}

function toDryRunVideo(video: EsovdbVideo): DryRunResult['video'] {
  return {
    id: video.id,
    title: video.title || '',
    url: formatVideoUrl(video),
    channel: video.channel || '',
    channelId: video.channelId || '',
    date: video.date || null,
    runningTime: video.duration ?? null
  };
}

function getResultCounts(results: DryRunResult[]): DryRunSummary {
  return results.reduce<DryRunSummary>(
    (counts, result) => {
      if (result.result === 'Include') counts.include += 1;
      if (result.result === 'Needs Review') counts.needsReview += 1;
      if (result.result === 'Exclude') counts.exclude += 1;
      if (result.result === 'Error') counts.error += 1;
      return counts;
    },
    {
      include: 0,
      needsReview: 0,
      exclude: 0,
      error: 0
    }
  );
}

function printDryRunResults(payload: DryRunPayload): void {
  const counts = payload.summary;

  console.log('');
  console.log('[SMART FILTER DRY RUN] Results');

  for (const [index, result] of payload.results.entries()) {
    console.log(
      `${index + 1}. ${result.result} score=${formatScore(result.relevanceScore)} ${result.video.url}`
    );
    console.log(`   Title: ${result.video.title || '(untitled)'}`);
    if (result.reason) console.log(`   Reason: ${result.reason}`);
    if (result.dominantTopics.length) console.log(`   Topics: ${result.dominantTopics.join(', ')}`);
    if (result.error) console.log(`   Error: ${result.error}`);
  }

  console.log('');
  console.log(
    `[SMART FILTER DRY RUN] Summary: ${counts.include} include, ${counts.needsReview} needs review, ${counts.exclude} exclude, ${counts.error} error.`
  );
}

async function getDryRunWatchlistRecord() {
  const requestedRecordId = process.env.WATCHLIST_RECORD_ID?.trim() || '';
  const record = requestedRecordId
    ? await getWatchlistRecordById(requestedRecordId)
    : await getNextWatchlistRecord();

  if (!record) {
    throw new Error(
      requestedRecordId
        ? `Requested watchlist record not found: ${requestedRecordId}`
        : 'No Active watchlist sources found.'
    );
  }

  return record;
}

export async function postSmartFilterDryRunResult(
  payload: SmartFilterDryRunCallbackPayload
): Promise<void> {
  if (!ENV.SMART_FILTER_DRY_RUN_ID) return;

  const url = new URL(
    `/watch/smart-filter/dry-run/${encodeURIComponent(ENV.SMART_FILTER_DRY_RUN_ID)}/result`,
    ENV.ESOVDB_API_BASE_URL
  );

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-esovdb-key': ENV.ESOVDB_KEY
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Smart filter dry-run callback failed with status ${res.status}: ${text}`);
  }
}

export function toFailedDryRunPayload(err: unknown): FailedDryRunPayload {
  return {
    ok: false,
    dryRunId: ENV.SMART_FILTER_DRY_RUN_ID,
    status: 'Failed',
    completedAt: new Date().toISOString(),
    error: err instanceof Error ? err.message : String(err)
  };
}

export async function dryRunSmartFilter(): Promise<DryRunPayload> {
  const record = await getDryRunWatchlistRecord();
  const fields = record.fields;
  const id = fields.ID;
  const type = fields.Type;

  if (!id || !type) {
    throw new Error(`Watchlist record ${record.id} missing required ID or Type.`);
  }

  const duration = fields.Duration || 'any';
  const publishedAfter = pickPublishedAfter(fields);
  const thresholds = getDryRunThresholds(fields);
  const sourcePrompt = getDryRunSourcePrompt(fields);
  const candidateLimit = getDryRunCandidateLimit();

  console.log(`[SMART FILTER DRY RUN] Source: ${fields.Name || id} (${type} ${id})`);
  console.log(`[SMART FILTER DRY RUN] Record: ${record.id}`);
  console.log(
    `[SMART FILTER DRY RUN] Filters: duration=${duration}, publishedAfter=${publishedAfter || 'none'}`
  );
  console.log(
    `[SMART FILTER DRY RUN] Thresholds: exclude=${thresholds.exclude}, autoInclude=${thresholds.autoInclude}`
  );
  console.log(
    `[SMART FILTER DRY RUN] Candidate limit: ${candidateLimit === null ? 'none' : candidateLimit}`
  );
  console.log('[SMART FILTER DRY RUN] No Airtable records will be created or updated.');

  const videos = await fetchEsovdbVideos({
    type,
    id,
    duration,
    publishedAfter
  });

  console.log(`[SMART FILTER DRY RUN] API returned ${countLabel(videos.length, 'candidate video')}.`);

  const videosToClassify = candidateLimit === null ? videos : videos.slice(0, candidateLimit);
  console.log(
    `[SMART FILTER DRY RUN] Classifying ${countLabel(videosToClassify.length, 'candidate video')}.`
  );

  if (!videosToClassify.length) {
    const payload: DryRunPayload = {
      ok: true,
      dryRunId: ENV.SMART_FILTER_DRY_RUN_ID,
      status: 'Completed',
      completedAt: new Date().toISOString(),
      source: {
        recordId: record.id,
        id,
        type,
        name: fields.Name || ''
      },
      filters: {
        duration,
        publishedAfter
      },
      thresholds,
      candidateLimit,
      apiReturnedVideos: videos.length,
      classifiedVideos: 0,
      summary: getResultCounts([]),
      results: []
    };

    printDryRunResults(payload);
    return payload;
  }

  const config = await loadSmartFilterConfig();
  const results: DryRunResult[] = [];

  for (const video of videosToClassify) {
    try {
      const classification = await classifyVideoMetadata(
        video,
        {
          recordId: record.id,
          sourceId: id,
          sourceName: fields.Name || '',
          sourceType: type,
          sourcePrompt,
          mode: getSmartFilterMode(fields),
          thresholds
        },
        config
      );

      results.push({
        video: toDryRunVideo(video),
        result: classification.classifierResult,
        relevanceScore: classification.relevanceScore,
        reason: classification.reason,
        dominantTopics: classification.dominantTopics,
        error: ''
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      results.push({
        video: toDryRunVideo(video),
        result: 'Error',
        relevanceScore: null,
        reason: '',
        dominantTopics: [],
        error: message
      });
    }
  }

  const payload: DryRunPayload = {
    ok: true,
    dryRunId: ENV.SMART_FILTER_DRY_RUN_ID,
    status: 'Completed',
    completedAt: new Date().toISOString(),
    source: {
      recordId: record.id,
      id,
      type,
      name: fields.Name || ''
    },
    filters: {
      duration,
      publishedAfter
    },
    thresholds,
    candidateLimit,
    apiReturnedVideos: videos.length,
    classifiedVideos: videosToClassify.length,
    summary: getResultCounts(results),
    results
  };

  printDryRunResults(payload);
  return payload;
}
