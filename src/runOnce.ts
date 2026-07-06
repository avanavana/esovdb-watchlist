import {
  createWatchlistRun,
  createSubmissions,
  getNextWatchlistRecord,
  getWatchlistRecordById,
  updateWatchlistRun,
  updateWatchlistRecord,
} from "./airtable.js";
import { fetchEsovdbVideos, notifyWatchlistSubmissionTotal } from "./esovdb.js";
import {
  getSmartFilterMode,
  getSmartFilterThresholds,
  isSmartFilteringEnabled,
} from "./smartFilter.js";
import {
  processSmartFilteredVideos,
  updateCandidateSubmissionRecord,
} from "./smartFilterCandidates.js";
import type {
  AirtableCreateRecord,
  SubmissionFields,
  WatchlistRunFields,
  WatchlistRunStatus,
} from "./types.js";
import { countLabel, isoNow, pickPublishedAfter, toSubmissionRecord } from "./utils.js";

function getGitHubWorkflowRunUrl(): string {
  const serverUrl = process.env.GITHUB_SERVER_URL?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();

  if (!serverUrl || !repository || !runId) return "";
  return `${serverUrl}/${repository}/actions/runs/${runId}`;
}

async function updateRunAndWatchlistStatus(args: {
  recordId: string;
  runRecordId: string;
  status: WatchlistRunStatus;
  completedAt: string;
  error?: string;
}): Promise<void> {
  const runFields: Partial<WatchlistRunFields> = {
    "Completed At": args.completedAt,
    Status: args.status,
  };

  if (args.error) runFields.Error = args.error;

  await updateWatchlistRun(args.runRecordId, runFields);
  await updateWatchlistRecord(args.recordId, {
    "Last Run ID": args.runRecordId,
    "Last Run Status": args.status,
    "Last Run Completed At": args.completedAt,
  });
}

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
  let runRecordId = "";
  console.log(`[WATCHLIST] Processing ${type} ${id} (record=${record.id})...`);

  try {
    const runFields: WatchlistRunFields = {
      "Watchlist Source Record ID": record.id,
      "Watchlist Source ID": id,
      "Watchlist Source Type": type,
      "Watchlist Source Name": fields.Name || "",
      "Started At": startedAt,
      Status: "Running",
    };
    const workflowRunUrl = getGitHubWorkflowRunUrl();
    const gitCommitSha = process.env.GITHUB_SHA?.trim() || "";

    if (workflowRunUrl) runFields["GitHub Workflow Run URL"] = workflowRunUrl;
    if (gitCommitSha) runFields["Git Commit SHA"] = gitCommitSha;

    const runRecord = await createWatchlistRun(runFields);
    runRecordId = runRecord.id;
    console.log(`[WATCHLIST] Created Watchlist Run ${runRecordId}.`);

    const publishedAfter = pickPublishedAfter(fields);
    const duration = fields.Duration || "any";

    const videos = await fetchEsovdbVideos({
      type,
      id,
      duration,
      publishedAfter,
    });

    if (!videos.length) {
      const completedAt = isoNow();
      await updateRunAndWatchlistStatus({
        recordId: record.id,
        runRecordId,
        status: "Completed",
        completedAt,
      });
      await updateWatchlistRecord(record.id, {
        "Last Checked": startedAt,
        "Last Checked Notes": `Checked at ${startedAt}. No new videos.`,
      });

      console.log("[WATCHLIST] No videos returned.");
      return;
    }

    const mapped: AirtableCreateRecord<SubmissionFields>[] = [];
    let classifierErrorCount = 0;

    if (isSmartFilteringEnabled(fields)) {
      console.log("[SMART FILTER] Enabled for this watchlist source.");
      const smartFilterResult = await processSmartFilteredVideos({
        videos,
        runId: runRecordId,
        source: {
          recordId: record.id,
          sourceId: id,
          sourceName: fields.Name || "",
          sourceType: type,
          notes: fields["Smart Filter Notes"] || "",
          mode: getSmartFilterMode(fields),
          thresholds: getSmartFilterThresholds(fields),
        },
      });
      classifierErrorCount = smartFilterResult.errorCount;

      for (const includedVideo of smartFilterResult.includedVideos) {
        const rec = toSubmissionRecord(includedVideo.video, {
          "Watchlist Run ID": runRecordId,
          "Candidate ID": includedVideo.candidateId,
          "Smart Filtered": true,
          "Smart Filter Relevance Score": includedVideo.classification.relevanceScore,
          "Smart Filter Reason": includedVideo.classification.reason,
          "Smart Filter Needs Review":
            includedVideo.classification.classifierResult === "Needs Review",
        });
        if (rec) mapped.push(rec);
      }
    } else {
      console.log("[SMART FILTER] Disabled for this watchlist source; using existing submission flow.");

      for (const video of videos) {
        const rec = toSubmissionRecord(video);
        if (rec) mapped.push(rec);
      }
    }

    const createdSubmissionIds = await createSubmissions(mapped);
    const createdCount = createdSubmissionIds.length;

    if (isSmartFilteringEnabled(fields)) {
      for (const [index, submissionRecordId] of createdSubmissionIds.entries()) {
        const candidateId = mapped[index]?.fields["Candidate ID"];
        if (candidateId) await updateCandidateSubmissionRecord(candidateId, submissionRecordId);
      }
    }

    if (createdSubmissionIds.length > 0) {
      const existingSubmissionIds = Array.isArray(fields.Submissions) ? fields.Submissions : [];
      const linkedSubmissionIds = [ ...new Set([ ...existingSubmissionIds, ...createdSubmissionIds ]) ];

      await updateWatchlistRecord(record.id, {
        Submissions: linkedSubmissionIds,
      });
    }

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

    const completedAt = isoNow();
    const runStatus: WatchlistRunStatus =
      classifierErrorCount > 0 ? "Completed with Warning(s)" : "Completed";

    await updateRunAndWatchlistStatus({
      recordId: record.id,
      runRecordId,
      status: runStatus,
      completedAt,
    });

    await updateWatchlistRecord(record.id, {
      "Last Checked": startedAt,
      "Last Checked Notes": `Checked at ${startedAt}. API returned ${countLabel(videos.length, "video")}. Created ${countLabel(createdCount, "submission")}.`,
    });

    console.log(
      `[WATCHLIST] Done. API returned ${countLabel(videos.length, "video")}. Created ${countLabel(createdCount, "submission")}.`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const completedAt = isoNow();

    try {
      if (runRecordId) {
        await updateRunAndWatchlistStatus({
          recordId: record.id,
          runRecordId,
          status: "Failed",
          completedAt,
          error: msg,
        });
      }

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
