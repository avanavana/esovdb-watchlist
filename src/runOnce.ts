import {
  createSubmissions,
  getNextWatchlistRecord,
  getWatchlistRecordById,
  updateWatchlistRecord,
} from "./airtable.js";
import { fetchEsovdbVideos, notifyWatchlistSubmissionTotal } from "./esovdb.js";
import type { AirtableCreateRecord, SubmissionFields } from "./types.js";
import { countLabel, isoNow, pickPublishedAfter, toSubmissionRecord } from "./utils.js";

export async function runOnce(): Promise<void> {
  const requestedRecordId = process.env.WATCHLIST_RECORD_ID?.trim() || "";
  const record = requestedRecordId
    ? await getWatchlistRecordById(requestedRecordId)
    : await getNextWatchlistRecord();

  if (!record) {
    if (requestedRecordId) {
      console.log(`[WATCHLIST] Requested record not found: ${requestedRecordId}`);
      throw new Error(`Requested watchlist record not found: ${requestedRecordId}`);
    }
    console.log("[WATCHLIST] No Active watchlist sources found.");
    return;
  }

  if (requestedRecordId) {
    console.log(`[WATCHLIST] Targeted run for record=${requestedRecordId}`);
  }

  const fields = record.fields;
  const id = fields.ID;
  const type = fields.Type;

  if (!id || !type) {
    const note = `ERROR at ${isoNow()}: Watchlist record missing required ID or Type.`;
    await updateWatchlistRecord(record.id, { "Last Checked Notes": note });
    console.log(`[WATCHLIST] Skipping record ${record.id} (missing ID or Type).`);
    return;
  }

  const startedAt = isoNow();
  console.log(`[WATCHLIST] Processing ${type} ${id} (record=${record.id})...`);

  try {
    const publishedAfter = pickPublishedAfter(fields);
    const duration = fields.Duration || "any";

    const videos = await fetchEsovdbVideos({
      type,
      id,
      duration,
      publishedAfter,
    });

    if (!videos.length) {
      await updateWatchlistRecord(record.id, {
        "Last Checked": startedAt,
        "Last Checked Notes": `Checked at ${startedAt}. No new videos.`,
      });

      console.log("[WATCHLIST] No videos returned.");
      return;
    }

    const mapped: AirtableCreateRecord<SubmissionFields>[] = [];

    for (const video of videos) {
      const rec = toSubmissionRecord(video);
      if (rec) mapped.push(rec);
    }

    const createdCount = await createSubmissions(mapped);

    if (createdCount > 0) {
      const firstVideo = videos[0];
      const sampleVideo = videos[Math.floor(Math.random() * videos.length)];
      const sampleVideoPayload = sampleVideo?.id
        ? {
            id: sampleVideo.id,
            ...(sampleVideo.title ? { title: sampleVideo.title } : {}),
            ...(sampleVideo.channel ? { channel: sampleVideo.channel } : {}),
            ...(sampleVideo.channelId ? { channelId: sampleVideo.channelId } : {}),
            ...(sampleVideo.date ? { date: sampleVideo.date } : {}),
          }
        : undefined;
      try {
        const sourceTitle = firstVideo?.channel || fields.Name || undefined;
        const notifyPayload: Parameters<typeof notifyWatchlistSubmissionTotal>[0] = {
          watchlistRecordId: record.id,
          watchlistType: type,
          createdSubmissions: createdCount,
          apiReturnedVideos: videos.length,
          sourceId: type === "Channel" ? (firstVideo?.channelId || id) : id,
          checkedAtIso: startedAt,
          ...(sourceTitle ? { sourceTitle } : {}),
          ...(sampleVideoPayload ? { sampleVideo: sampleVideoPayload } : {}),
        };
        await notifyWatchlistSubmissionTotal(notifyPayload);
        console.log(
          `[WATCHLIST] Sent Discord notification for ${countLabel(createdCount, "new submission")}.`
        );
      } catch (notifyErr: unknown) {
        console.error("[WATCHLIST] Notification failed (continuing):", notifyErr);
      }
    }

    await updateWatchlistRecord(record.id, {
      "Last Checked": startedAt,
      "Last Checked Notes": `Checked at ${startedAt}. API returned ${countLabel(videos.length, "video")}. Created ${countLabel(createdCount, "submission")}.`,
    });

    console.log(
      `[WATCHLIST] Done. API returned ${countLabel(videos.length, "video")}. Created ${countLabel(createdCount, "submission")}.`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    try {
      await updateWatchlistRecord(record.id, {
        "Last Checked Notes": `ERROR at ${startedAt}: ${msg}`,
      });
    } catch (updateErr: unknown) {
      console.error("[WATCHLIST] Failed to write error note:", updateErr);
    }
    console.error("[WATCHLIST] Error:", err);
    throw err;
  }
}
