import { ENV } from "./env.js";
import type { DurationFilter, EsovdbVideo, WatchlistType } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchEsovdbVideos(args: {
  type: WatchlistType;
  id: string;
  duration?: DurationFilter;
  publishedAfter?: string | null;
}): Promise<EsovdbVideo[]> {
  const url =
    args.type === "Channel"
      ? new URL("/submissions/youtube/channel", ENV.ESOVDB_API_BASE_URL)
      : new URL("/submissions/youtube/playlist", ENV.ESOVDB_API_BASE_URL);

  const body =
    args.type === "Channel"
      ? {
          channel: args.id,
          length: args.duration || "any",
          publishedAfter: args.publishedAfter || null,
        }
      : {
          playlist: args.id,
        };

  let lastErrorText = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-esovdb-key": ENV.ESOVDB_KEY,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 204) return [];

    if (res.ok) {
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) return [];
      return data as EsovdbVideo[];
    }

    lastErrorText = await res.text().catch(() => "");
    if (res.status < 500 || attempt === 3) {
      throw new Error(`ESOVDB API error ${res.status}: ${lastErrorText}`);
    }

    await sleep(1000 * attempt);
  }

  throw new Error(`ESOVDB API error after retries: ${lastErrorText}`);
}

export async function notifyWatchlistSubmissionTotal(args: {
  watchlistRecordId: string;
  watchlistType: WatchlistType;
  createdSubmissions: number;
  apiReturnedVideos: number;
  sourceTitle?: string;
  sourceId: string;
  sampleVideo?: {
    id: string;
    title?: string;
    channel?: string;
    channelId?: string;
    date?: string;
  };
  checkedAtIso: string;
}): Promise<void> {
  if (!ENV.WATCHLIST_DISCORD_NOTIFY_PATH) return;

  const url = new URL(ENV.WATCHLIST_DISCORD_NOTIFY_PATH, ENV.ESOVDB_API_BASE_URL);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-esovdb-key": ENV.ESOVDB_KEY,
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Watchlist notify error ${res.status}: ${text}`);
  }
}
