import { fetchJson } from "./http.js";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

export interface WikidataCandidate {
  id: string;
  label: string;
  description?: string;
}

interface SearchEntitiesResponse {
  search: Array<{ id: string; label?: string; description?: string }>;
}

interface GetEntitiesResponse {
  entities: Record<
    string,
    {
      sitelinks?: Record<string, { title: string; url?: string }>;
    }
  >;
}

const DISAMBIGUATION_HINTS = ["disambiguation page", "Wikimedia disambiguation page"];

export async function searchEntities(topic: string, limit = 5): Promise<WikidataCandidate[]> {
  const url = new URL(WIKIDATA_API);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", topic);
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));

  const data = await fetchJson<SearchEntitiesResponse>(url.toString());
  return data.search
    .filter((r) => !DISAMBIGUATION_HINTS.some((h) => r.description?.includes(h)))
    .map((r) => ({ id: r.id, label: r.label ?? r.id, description: r.description }));
}

/** langs: ISO codes like "pl", "cs", "uk" (mapped to "{lang}wiki" sitelink keys). */
export async function getArticleTitles(
  entityId: string,
  langs: string[],
): Promise<Record<string, string | null>> {
  const url = new URL(WIKIDATA_API);
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("ids", entityId);
  url.searchParams.set("props", "sitelinks");
  url.searchParams.set("format", "json");

  const data = await fetchJson<GetEntitiesResponse>(url.toString());
  const sitelinks = data.entities[entityId]?.sitelinks ?? {};

  const result: Record<string, string | null> = {};
  for (const lang of langs) {
    const site = `${lang}wiki`;
    result[lang] = sitelinks[site]?.title ?? null;
  }
  return result;
}

export interface ResolveTopicResult {
  query: string;
  candidates: WikidataCandidate[];
  ambiguous: boolean;
  /** Populated for the top candidate so the common (unambiguous) case needs one call. */
  resolved?: {
    entityId: string;
    label: string;
    titles: Record<string, string | null>;
  };
}

export async function resolveTopic(topic: string, langs: string[]): Promise<ResolveTopicResult> {
  const candidates = await searchEntities(topic);
  if (candidates.length === 0) {
    return { query: topic, candidates: [], ambiguous: false };
  }

  const top = candidates[0];
  const titles = await getArticleTitles(top.id, langs);

  return {
    query: topic,
    candidates,
    ambiguous: candidates.length > 1,
    resolved: { entityId: top.id, label: top.label, titles },
  };
}
