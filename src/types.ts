export type WatchlistStatus = "Active" | "Inactive";
export type WatchlistType = "Channel" | "Playlist";
export type DurationFilter = "any" | "short" | "medium" | "long";
export type SmartFilterMode = "Metadata" | "Metadata + Transcript";
export type ClassifierResult = "Include" | "Needs Review" | "Exclude" | "Error";
export type WatchlistRunStatus =
  | "Running"
  | "Completed"
  | "Completed with Warning(s)"
  | "Failed"
  | "Cancelled";

export interface WatchlistFields {
  Name?: string;
  Status?: WatchlistStatus;
  Type?: WatchlistType;
  ID?: string;
  URL?: string;
  Submissions?: string[];
  Duration?: DurationFilter;
  "Published After"?: string; // ISO datetime string
  "Last Checked"?: string; // ISO datetime string
  "Last Checked Notes"?: string;
  "Smart Filtering"?: boolean;
  "Smart Filter Notes"?: string;
  "Smart Filter Mode"?: SmartFilterMode;
  "Smart Filter Exclude Threshold"?: number;
  "Smart Filter Auto-Include Threshold"?: number;
  "Last Run ID"?: string;
  "Last Run Status"?: string;
  "Last Run Completed At"?: string;
}

export interface AirtableRecord<TFields> {
  id: string;
  fields: TFields;
  createdTime?: string;
}

export interface EsovdbVideo {
  id: string;
  title?: string;
  description?: string;
  year?: number | string;
  date?: string; // ISO
  duration?: number | string; // seconds
  channel?: string;
  channelId?: string;
  playlist?: string;
  position?: number;
}

export interface AirtableCreateRecord<TFields> {
  fields: TFields;
}

export interface SubmissionFields {
  URL: string;
  Title: string;
  Description: string;
  Year: number | null;
  Date: string | null;
  "Running Time": number | null;
  Medium: string; // "Online Video"
  "YouTube Channel Title": string;
  "YouTube Channel ID": string;
  "Submission Source": string; // "ESOVDB API Channel Watch"
  "Submitted by": string; // "ESOVDB API"
  "Watchlist Run ID"?: string;
  "Candidate ID"?: string;
  "Smart Filtered"?: boolean;
  "Smart Filter Relevance Score"?: number;
  "Smart Filter Reason"?: string;
  "Smart Filter Needs Review"?: boolean;
}

export interface WatchlistRunFields {
  "Watchlist Source Record ID": string;
  "Watchlist Source ID": string;
  "Watchlist Source Type": WatchlistType;
  "Watchlist Source Name": string;
  "Started At": string;
  "Completed At"?: string;
  Status: WatchlistRunStatus;
  Error?: string;
  "GitHub Workflow Run URL"?: string;
  "Git Commit SHA"?: string;
}

export interface WatchlistSubmissionCandidateFields {
  "Video Title": string;
  "Video ID": string;
  "Video Description": string;
  Date: string | null;
  "Running Time": number | null;
  "Watchlist Run": string[];
  "Watchlist Source Record ID": string;
  "Submission Record ID"?: string;
  "Relevance Score"?: number;
  "Classifier Result": ClassifierResult;
  "Classifier Reason"?: string;
  Error?: string;
  "Classifier Model": string;
  "Classifier Prompt Version": string;
}
