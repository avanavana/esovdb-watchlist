import { getNextWatchlistRecord, getWatchlistRecordById } from './airtable.js';
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
  video: EsovdbVideo;
  result: ClassifierResult;
  relevanceScore: number | null;
  reason: string;
  dominantTopics: string[];
  error: string;
}

function parseOptionalThreshold(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number from 0.0 to 1.0.`);
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

function getResultCounts(results: DryRunResult[]): Record<ClassifierResult, number> {
  return results.reduce<Record<ClassifierResult, number>>(
    (counts, result) => {
      counts[result.result] += 1;
      return counts;
    },
    {
      Include: 0,
      'Needs Review': 0,
      Exclude: 0,
      Error: 0
    }
  );
}

function printDryRunResults(results: DryRunResult[]): void {
  const counts = getResultCounts(results);

  console.log('');
  console.log('[SMART FILTER DRY RUN] Results');

  for (const [index, result] of results.entries()) {
    console.log(
      `${index + 1}. ${result.result} score=${formatScore(result.relevanceScore)} ${formatVideoUrl(result.video)}`
    );
    console.log(`   Title: ${result.video.title || '(untitled)'}`);
    if (result.reason) console.log(`   Reason: ${result.reason}`);
    if (result.dominantTopics.length) console.log(`   Topics: ${result.dominantTopics.join(', ')}`);
    if (result.error) console.log(`   Error: ${result.error}`);
  }

  console.log('');
  console.log(
    `[SMART FILTER DRY RUN] Summary: ${counts.Include} include, ${counts['Needs Review']} needs review, ${counts.Exclude} exclude, ${counts.Error} error.`
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

export async function dryRunSmartFilter(): Promise<void> {
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

  console.log(`[SMART FILTER DRY RUN] Source: ${fields.Name || id} (${type} ${id})`);
  console.log(`[SMART FILTER DRY RUN] Record: ${record.id}`);
  console.log(
    `[SMART FILTER DRY RUN] Filters: duration=${duration}, publishedAfter=${publishedAfter || 'none'}`
  );
  console.log(
    `[SMART FILTER DRY RUN] Thresholds: exclude=${thresholds.exclude}, autoInclude=${thresholds.autoInclude}`
  );
  console.log('[SMART FILTER DRY RUN] No Airtable records will be created or updated.');

  const videos = await fetchEsovdbVideos({
    type,
    id,
    duration,
    publishedAfter
  });

  console.log(`[SMART FILTER DRY RUN] API returned ${countLabel(videos.length, 'candidate video')}.`);

  if (!videos.length) return;

  const config = await loadSmartFilterConfig();
  const results: DryRunResult[] = [];

  for (const video of videos) {
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
        video,
        result: classification.classifierResult,
        relevanceScore: classification.relevanceScore,
        reason: classification.reason,
        dominantTopics: classification.dominantTopics,
        error: ''
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      results.push({
        video,
        result: 'Error',
        relevanceScore: null,
        reason: '',
        dominantTopics: [],
        error: message
      });
    }
  }

  printDryRunResults(results);
}
