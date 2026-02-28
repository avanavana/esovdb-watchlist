import type {
  AirtableCreateRecord,
  EsovdbVideo,
  SubmissionFields,
  WatchlistFields,
} from "./types.js";

export function isoNow(): string {
  return new Date().toISOString();
}

export function countLabel(count: number, singular: string, plural?: string): string {
  const label = count === 1 ? singular : (plural || `${singular}s`);
  return `${count} ${label}`;
}

export function pickPublishedAfter(fields: WatchlistFields): string | null {
  return fields["Last Checked"] || fields["Published After"] || null;
}

export function toNullableNumber(value: number | string | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

export function toSubmissionRecord(
  video: EsovdbVideo
): AirtableCreateRecord<SubmissionFields> | null {
  if (!video || !video.id) return null;

  return {
    fields: {
      URL: `https://youtu.be/${video.id}`,
      Title: video.title || "",
      Description: video.description || "",
      Year: toNullableNumber(video.year),
      Date: video.date || null,
      "Running Time": toNullableNumber(video.duration),
      Medium: "Online Video",
      "YouTube Channel Title": video.channel || "",
      "YouTube Channel ID": video.channelId || "",
      "Submission Source": "ESOVDB API Channel Watch",
      "Submitted by": "ESOVDB API",
    },
  };
}
