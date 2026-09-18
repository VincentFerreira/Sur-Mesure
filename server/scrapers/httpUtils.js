// Shared HTTP retry helper for portal modules — exponential backoff with jitter on
// 429/5xx, 404 passed straight through as an empty-result signal rather than an error.
export async function fetchWithBackoff(url, options, maxRetries = 4) {
    let attempt = 0;
    for (;;) {
        const res = await fetch(url, options);
        if (res.status === 404) return res;
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            const delayMs = Math.min(500 * 2 ** attempt, 8000) + Math.random() * 250;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            attempt += 1;
            continue;
        }
        return res;
    }
}

export function stripHtml(html) {
    if (!html) return undefined;
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}
