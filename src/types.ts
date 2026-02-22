export type WatchlistStatus = "Active" | "Inactive";
export type WatchlistType = "Channel" | "Playlist";
export type DurationFilter = "any" | "short" | "medium" | "long";

export interface WatchlistFields {
  Name?: string;
  Status?: WatchlistStatus;
  Type?: WatchlistType;
  ID?: string;
  URL?: string;
  Duration?: DurationFilter;
  "Published After"?: string; // ISO datetime string
  "Last Checked"?: string; // ISO datetime string
  "Last Checked Notes"?: string;
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
}
