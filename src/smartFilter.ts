import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ENV } from './env.js';
import type {
  ClassifierResult,
  EsovdbVideo,
  SmartFilterMode,
  WatchlistFields,
  WatchlistType
} from './types.js';
import { toNullableNumber } from './utils.js';

const DEFAULT_EXCLUDE_THRESHOLD = 0.5;
const DEFAULT_AUTO_INCLUDE_THRESHOLD = 0.85;
const DEFAULT_MODE: SmartFilterMode = 'Metadata';

interface SmartFilterModelConfig {
  id: string;
  provider?: string;
  description?: string;
}

interface SmartFilterConfig {
  promptVersion: string;
  defaultModel: string;
  models: SmartFilterModelConfig[];
  systemPrompt: string;
  classificationPolicy: string;
  userPrompt: string;
}

export interface SmartFilterThresholds {
  exclude: number;
  autoInclude: number;
}

export interface SmartFilterClassification {
  relevanceScore: number;
  reason: string;
  dominantTopics: string[];
  classifierResult: ClassifierResult;
  model: string;
  promptVersion: string;
}

export interface SmartFilterSourceContext {
  recordId: string;
  sourceId: string;
  sourceName: string;
  sourceType: WatchlistType;
  sourcePrompt: string;
  mode: SmartFilterMode;
  thresholds: SmartFilterThresholds;
}

interface OpenAiChatCompletionResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
}

const fallbackConfig: SmartFilterConfig = {
  promptVersion: 'metadata-v1',
  defaultModel: 'gpt-4o-mini',
  models: [
    {
      id: 'gpt-4o-mini',
      provider: 'openai',
      description: 'Low-cost default for short metadata classification with strict JSON schema output.'
    }
  ],
  systemPrompt:
    'You classify candidate YouTube videos for the Earth Science Online Video Database (ESOVDB). Return JSON only. Use only the provided metadata. Do not infer from unavailable transcripts.',
  classificationPolicy:
    'Include videos primarily about geology, earth science, earth systems science, geophysics, geochemistry, paleontology, mineralogy, petrology, sedimentology, stratigraphy, tectonics, volcanology, geomorphology, paleoclimate, hydrogeology, geological field trips, geology lectures, geology documentaries, and earth science podcasts, interviews, seminars, or educational videos. Exclude videos primarily about professional development, geology careers, diversity/equity/inclusion discussions about the profession, departmental announcements, admissions or recruiting, university promotional content, conference logistics, general travel without substantial geology, history without substantial geology, geography without substantial geology, and generic science education where Earth science is not central. If mixed, score high only when Earth science is a major or dominant subject.',
  userPrompt:
    'Assign a relevance_score from 0.0 to 1.0 for whether this YouTube video belongs in ESOVDB. Base the score on the classification policy and metadata. Return a concise reason and dominant_topics.'
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function normalizeNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function validateConfig(value: unknown): SmartFilterConfig {
  if (!isObject(value)) return fallbackConfig;

  const models = Array.isArray(value.models)
    ? value.models
        .filter((model): model is Record<string, unknown> => isObject(model))
        .map((model) => {
          const normalizedModel: SmartFilterModelConfig = {
            id: typeof model.id === 'string' ? model.id : ''
          };

          if (typeof model.provider === 'string') normalizedModel.provider = model.provider;
          if (typeof model.description === 'string') normalizedModel.description = model.description;

          return normalizedModel;
        })
        .filter((model) => model.id)
    : fallbackConfig.models;

  return {
    promptVersion:
      typeof value.promptVersion === 'string' ? value.promptVersion : fallbackConfig.promptVersion,
    defaultModel:
      typeof value.defaultModel === 'string' ? value.defaultModel : fallbackConfig.defaultModel,
    models: models.length ? models : fallbackConfig.models,
    systemPrompt:
      typeof value.systemPrompt === 'string' ? value.systemPrompt : fallbackConfig.systemPrompt,
    classificationPolicy:
      typeof value.classificationPolicy === 'string'
        ? value.classificationPolicy
        : fallbackConfig.classificationPolicy,
    userPrompt: typeof value.userPrompt === 'string' ? value.userPrompt : fallbackConfig.userPrompt
  };
}

export async function loadSmartFilterConfig(): Promise<SmartFilterConfig> {
  const configPath = path.resolve(process.cwd(), ENV.SMART_FILTER_CONFIG_PATH);

  try {
    const raw = await readFile(configPath, 'utf8');
    return validateConfig(JSON.parse(raw));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SMART FILTER] Could not read config at ${configPath}; using defaults: ${message}`);
    return fallbackConfig;
  }
}

export function getSmartFilterThresholds(fields: WatchlistFields): SmartFilterThresholds {
  const exclude = normalizeNumber(
    fields['Smart Filter Exclude Threshold'],
    DEFAULT_EXCLUDE_THRESHOLD
  );
  const autoInclude = normalizeNumber(
    fields['Smart Filter Auto-Include Threshold'],
    DEFAULT_AUTO_INCLUDE_THRESHOLD
  );

  return autoInclude >= exclude
    ? { exclude, autoInclude }
    : { exclude: DEFAULT_EXCLUDE_THRESHOLD, autoInclude: DEFAULT_AUTO_INCLUDE_THRESHOLD };
}

export function getSmartFilterMode(fields: WatchlistFields): SmartFilterMode {
  return fields['Smart Filter Mode'] || DEFAULT_MODE;
}

export function isSmartFilteringEnabled(fields: WatchlistFields): boolean {
  return fields['Smart Filtering'] === true;
}

export function getClassifierResult(
  score: number,
  thresholds: SmartFilterThresholds
): ClassifierResult {
  if (score >= thresholds.autoInclude) return 'Include';
  if (score >= thresholds.exclude) return 'Needs Review';
  return 'Exclude';
}

function buildMetadataBlock(video: EsovdbVideo, source: SmartFilterSourceContext): string {
  const metadata = {
    video_title: video.title || '',
    video_description: truncate(video.description || '', 4000),
    channel_or_source_name: video.channel || source.sourceName,
    source_type: source.sourceType,
    watchlist_source_prompt: source.sourcePrompt,
    date: video.date || '',
    running_time_seconds: toNullableNumber(video.duration)
  };

  return JSON.stringify(metadata, null, 2);
}

function buildMessages(
  video: EsovdbVideo,
  source: SmartFilterSourceContext,
  config: SmartFilterConfig
): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content: `${config.systemPrompt}\n\nClassification policy:\n${config.classificationPolicy}`
    },
    {
      role: 'user',
      content: `${config.userPrompt}\n\nMetadata:\n${buildMetadataBlock(video, source)}`
    }
  ];
}

function validateClassifierJson(value: unknown): {
  relevance_score: number;
  reason: string;
  dominant_topics: string[];
} {
  if (!isObject(value)) throw new Error('Classifier response was not a JSON object.');

  const relevanceScore = value.relevance_score;
  const reason = value.reason;
  const dominantTopics = value.dominant_topics;

  if (typeof relevanceScore !== 'number' || !Number.isFinite(relevanceScore)) {
    throw new Error('Classifier response missing numeric relevance_score.');
  }

  if (relevanceScore < 0 || relevanceScore > 1) {
    throw new Error(`Classifier relevance_score out of range: ${relevanceScore}`);
  }

  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('Classifier response missing reason.');
  }

  if (!Array.isArray(dominantTopics) || !dominantTopics.every((topic) => typeof topic === 'string')) {
    throw new Error('Classifier response missing string array dominant_topics.');
  }

  return {
    relevance_score: relevanceScore,
    reason: reason.trim(),
    dominant_topics: dominantTopics.map((topic) => topic.trim()).filter(Boolean)
  };
}

function getSmartFilterModel(config: SmartFilterConfig): string {
  const configuredModel = ENV.SMART_FILTER_MODEL || config.defaultModel;
  if (configuredModel) return configuredModel;
  return config.models[0]?.id || fallbackConfig.defaultModel;
}

export async function classifyVideoMetadata(
  video: EsovdbVideo,
  source: SmartFilterSourceContext,
  config: SmartFilterConfig
): Promise<SmartFilterClassification> {
  if (!ENV.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY for smart filtering.');
  }

  if (source.mode !== 'Metadata') {
    console.warn(
      `[SMART FILTER] Mode "${source.mode}" requested; using Metadata for v1 classification.`
    );
  }

  const model = getSmartFilterModel(config);
  const openAiBaseUrl = ENV.SMART_FILTER_OPENAI_BASE_URL.replace(/\/$/, '');
  const url = `${openAiBaseUrl}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ENV.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: buildMessages(video, source, config),
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'esovdb_smart_filter_classification',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              relevance_score: {
                type: 'number'
              },
              reason: {
                type: 'string'
              },
              dominant_topics: {
                type: 'array',
                items: {
                  type: 'string'
                }
              }
            },
            required: [ 'relevance_score', 'reason', 'dominant_topics' ]
          }
        }
      }
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI classification failed with status ${res.status}: ${truncate(text, 1200)}`);
  }

  const data = (await res.json()) as OpenAiChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) throw new Error('OpenAI classification response did not include message content.');

  const parsed = validateClassifierJson(JSON.parse(content));
  const classifierResult = getClassifierResult(parsed.relevance_score, source.thresholds);

  return {
    relevanceScore: parsed.relevance_score,
    reason: parsed.reason,
    dominantTopics: parsed.dominant_topics,
    classifierResult,
    model,
    promptVersion: config.promptVersion
  };
}
