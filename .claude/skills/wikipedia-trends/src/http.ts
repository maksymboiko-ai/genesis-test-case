// Shared HTTP helper for Wikimedia's public APIs.
// Wikimedia asks API consumers to identify themselves in the User-Agent
// (https://meta.wikimedia.org/wiki/User-Agent_policy). We keep this generic
// rather than embedding any individual's contact details in checked-in code;
// override with WIKIPEDIA_TRENDS_CONTACT if you operate this at volume.
const DEFAULT_CONTACT = "no-contact-set";
const USER_AGENT = `wikipedia-trends-skill/0.1 (contact: ${process.env.WIKIPEDIA_TRENDS_CONTACT ?? DEFAULT_CONTACT})`;

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (res.status === 404) {
        throw new HttpError(404, url, "Not found");
      }
      if (res.status === 429 || res.status >= 500) {
        throw new HttpError(res.status, url, `Retryable status ${res.status}`);
      }
      if (!res.ok) {
        throw new HttpError(res.status, url, `Request failed with status ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (err instanceof HttpError && (err.status === 404 || (err.status < 500 && err.status !== 429))) {
        throw err; // not retryable
      }
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError;
}
