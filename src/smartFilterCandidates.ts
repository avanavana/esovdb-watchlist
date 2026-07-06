import {
  createWatchlistSubmissionCandidate,
  updateWatchlistSubmissionCandidate
} from './airtable.js';
import { ENV } from './env.js';
import {
  classifyVideoMetadata,
  loadSmartFilterConfig,
  type SmartFilterClassification,
  type SmartFilterSourceContext
} from './smartFilter.js';
import type {
  ClassifierResult,
  EsovdbVideo,
  WatchlistSubmissionCandidateFields
} from './types.js';
import { toNullableNumber } from './utils.js';

export interface SmartFilteredVideo {
  video: EsovdbVideo;
  candidateId: string;
  classification: SmartFilterClassification;
}

export interface SmartFilteredVideoResult {
  includedVideos: SmartFilteredVideo[];
  errorCount: number;
}

interface CandidateBaseArgs {
  video: EsovdbVideo;
  runId: string;
  sourceRecordId: string;
  classifierModel: string;
  promptVersion: string;
}

function getConfiguredClassifierModel(defaultModel: string): string {
  return ENV.SMART_FILTER_MODEL || defaultModel;
}

function toCandidateFields(
  args: CandidateBaseArgs & {
    result: ClassifierResult;
    relevanceScore?: number;
    reason?: string;
    error?: string;
  }
): WatchlistSubmissionCandidateFields {
  const fields: WatchlistSubmissionCandidateFields = {
    'Video Title': args.video.title || args.video.id,
    'Video ID': args.video.id,
    'Video Description': args.video.description || '',
    Date: args.video.date || null,
    'Running Time': toNullableNumber(args.video.duration),
    'Watchlist Run': [ args.runId ],
    'Watchlist Source Record ID': args.sourceRecordId,
    'Classifier Result': args.result,
    'Classifier Model': args.classifierModel,
    'Classifier Prompt Version': args.promptVersion
  };

  if (typeof args.relevanceScore === 'number') fields['Relevance Score'] = args.relevanceScore;
  if (args.reason) fields['Classifier Reason'] = args.reason;
  if (args.error) fields.Error = args.error;

  return fields;
}

export async function updateCandidateSubmissionRecord(
  candidateId: string,
  submissionRecordId: string
): Promise<void> {
  await updateWatchlistSubmissionCandidate(candidateId, {
    'Submission Record ID': submissionRecordId
  });
}

export async function processSmartFilteredVideos(args: {
  videos: EsovdbVideo[];
  runId: string;
  source: SmartFilterSourceContext;
}): Promise<SmartFilteredVideoResult> {
  const config = await loadSmartFilterConfig();
  const fallbackClassifierModel = getConfiguredClassifierModel(config.defaultModel);
  const includedVideos: SmartFilteredVideo[] = [];
  let errorCount = 0;

  console.log(
    `[SMART FILTER] Classifying ${args.videos.length} candidate video${args.videos.length === 1 ? '' : 's'} with ${fallbackClassifierModel}.`
  );

  for (const video of args.videos) {
    try {
      const classification = await classifyVideoMetadata(video, args.source, config);
      const candidate = await createWatchlistSubmissionCandidate(
        toCandidateFields({
          video,
          runId: args.runId,
          sourceRecordId: args.source.recordId,
          classifierModel: classification.model,
          promptVersion: classification.promptVersion,
          result: classification.classifierResult,
          relevanceScore: classification.relevanceScore,
          reason: classification.reason
        })
      );

      console.log(
        `[SMART FILTER] ${classification.classifierResult}: ${video.id} score=${classification.relevanceScore.toFixed(2)} candidate=${candidate.id}`
      );

      if (
        classification.classifierResult === 'Include' ||
        classification.classifierResult === 'Needs Review'
      ) {
        includedVideos.push({
          video,
          candidateId: candidate.id,
          classification
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errorCount += 1;
      const candidate = await createWatchlistSubmissionCandidate(
        toCandidateFields({
          video,
          runId: args.runId,
          sourceRecordId: args.source.recordId,
          classifierModel: fallbackClassifierModel,
          promptVersion: config.promptVersion,
          result: 'Error',
          error: message
        })
      );

      console.warn(`[SMART FILTER] Error: ${video.id} candidate=${candidate.id}: ${message}`);
    }
  }

  return {
    includedVideos,
    errorCount
  };
}
