import { ENV } from "./env.js";
import type { DurationFilter, EsovdbVideo, WatchlistType } from "./types.js";

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

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-esovdb-key": ENV.ESOVDB_KEY,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 204) return [];
  
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ESOVDB API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as EsovdbVideo[];
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
