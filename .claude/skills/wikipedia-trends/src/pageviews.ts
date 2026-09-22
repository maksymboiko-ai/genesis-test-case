import { fetchJson, HttpError } from "./http.js";
import { DiskCache } from "./cache.js";

const REST_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews";

export interface MonthlyPoint {
  /** "YYYY-MM" */
  month: string;
  views: number;
}

interface PerArticleResponse {
  items: Array<{ timestamp: string; views: number }>;
}

interface AggregateResponse {
  items: Array<{ timestamp: string; views: number }>;
}

/** lang: ISO code like "pl" -> Wikimedia project id "pl.wikipedia" */
export function toProjectId(lang: string): string {
  return `${lang}.wikipedia`;
}

function toYyyymm(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Wikimedia REST timestamps are "YYYYMMDD00" for monthly granularity. */
function timestampToMonth(ts: string): string {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}`;
}

export interface DateRange {
  /** inclusive, UTC month-start */
  start: Date;
  /** inclusive, UTC month-start */
  end: Date;
}

/**
 * Ends at the last fully-completed month, not the current one: Wikimedia's
 * pageview counts for the in-progress month are partial and would otherwise
 * show up as a misleading drop in MoM/YoY growth.
 */
export function lastNMonths(n: number, from: Date = new Date()): DateRange {
  const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (n - 1), 1));
  return { start, end };
}

export async function fetchPerArticleMonthly(
  lang: string,
  article: string,
  range: DateRange,
): Promise<MonthlyPoint[]> {
  const project = toProjectId(lang);
  const encodedArticle = encodeURIComponent(article.replace(/ /g, "_"));
  const start = toYyyymm(range.start) + "01";
  const end = toYyyymm(range.end) + "01";
  const url = `${REST_BASE}/per-article/${project}/all-access/user/${encodedArticle}/monthly/${start}/${end}`;

  try {
    const data = await fetchJson<PerArticleResponse>(url);
    return data.items.map((item) => ({ month: timestampToMonth(item.timestamp), views: item.views }));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      // No data for this article/range (e.g. article didn't exist yet, or a typo'd title).
      return [];
    }
    throw err;
  }
}

export async function fetchProjectAggregateMonthly(
  lang: string,
  range: DateRange,
): Promise<MonthlyPoint[]> {
  const project = toProjectId(lang);
  const start = toYyyymm(range.start) + "01";
  const end = toYyyymm(range.end) + "01";
  const url = `${REST_BASE}/aggregate/${project}/all-access/user/monthly/${start}/${end}`;

  try {
    const data = await fetchJson<AggregateResponse>(url);
    return data.items.map((item) => ({ month: timestampToMonth(item.timestamp), views: item.views }));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

const defaultCache = new DiskCache();

/** Cached variant: repeat/follow-up queries (same article/lang/range) skip the network entirely. */
export async function fetchPerArticleMonthlyCached(
  lang: string,
  article: string,
  range: DateRange,
  cache: DiskCache = defaultCache,
): Promise<MonthlyPoint[]> {
  const key = `per-article:${lang}:${article}:${range.start.toISOString()}:${range.end.toISOString()}`;
  return cache.getOrFetch(key, () => fetchPerArticleMonthly(lang, article, range));
}

export async function fetchProjectAggregateMonthlyCached(
  lang: string,
  range: DateRange,
  cache: DiskCache = defaultCache,
): Promise<MonthlyPoint[]> {
  const key = `aggregate:${lang}:${range.start.toISOString()}:${range.end.toISOString()}`;
  return cache.getOrFetch(key, () => fetchProjectAggregateMonthly(lang, range));
}
