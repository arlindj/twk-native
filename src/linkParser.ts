/**
 * Link Resolver — extracts the test token (and optional API override
 * used during development) from any supported entry format:
 *
 *   https://test.tawakkalnaos.app/t/<token>      (universal / app link)
 *   twk://t/<token>                              (custom scheme deep link)
 *   <token>                                      (manual code entry)
 *
 * A `?api=` query param lets QA point a build at a local backend.
 */
export interface ParsedTestLink {
  token: string;
  apiOverride?: string;
}

export function parseTestLink(input: string): ParsedTestLink | null {
  const raw = input.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const segments = url.pathname.split('/').filter(Boolean);
    // Both https://host/t/<token> and twk://t/<token> (where "t" is host).
    let token: string | undefined;
    if (segments[0] === 't' && segments[1]) token = segments[1];
    else if (url.hostname === 't' && segments[0]) token = segments[0];
    if (!token) return null;
    const apiOverride = url.searchParams.get('api') ?? undefined;
    return { token, apiOverride };
  } catch {
    // Not a URL — treat as a raw test code.
    if (/^[A-Za-z0-9_-]{4,64}$/.test(raw)) return { token: raw };
    return null;
  }
}
