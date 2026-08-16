/**
 * Resolve the newest DizzyOS release from a public GitHub repository.
 *
 * Each NAS asks GitHub what the latest release is and compares locally — no
 * phone-home, no server tracking which device runs what version. A device
 * that has been offline for a year still finds the newest release the moment
 * it checks, because "latest" is resolved at check time, not pushed.
 *
 * Two resolution paths:
 *  1. github.com/<repo>/releases/latest/download/manifest.json — a stable URL
 *     GitHub redirects to the newest release's asset. No API rate limit.
 *  2. The Releases API, if a release has no manifest.json attached.
 */

const UA = { 'User-Agent': 'DizzyOS-Updater', Accept: 'application/vnd.github+json' };

export function manifestUrlFor(repo) {
  return `https://github.com/${repo}/releases/latest/download/manifest.json`;
}

export function isValidRepo(repo) {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo || '');
}

/** Normalized release info: { version, url, sha256, notes[], released, source } */
export async function resolveLatest(repo) {
  if (!isValidRepo(repo)) throw new Error(`Invalid repository "${repo}" — expected owner/name`);

  // Path 1: manifest.json published as a release asset
  try {
    const res = await fetch(manifestUrlFor(repo), { redirect: 'follow', headers: UA });
    if (res.ok) {
      const m = await res.json();
      if (m.version && m.url) return { ...m, notes: toNotes(m.notes), source: 'manifest' };
    }
  } catch { /* fall through to the API */ }

  // Path 2: derive it from the release itself
  const api = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetch(api, { redirect: 'follow', headers: UA });
  if (res.status === 404) {
    throw new Error(`No published release found in ${repo} (is the repo public and does it have a release?)`);
  }
  if (res.status === 403) {
    throw new Error('GitHub rate limit reached — try again later');
  }
  if (!res.ok) throw new Error(`GitHub returned ${res.status} ${res.statusText}`);

  const rel = await res.json();
  const assets = rel.assets || [];
  const pkg = assets.find(a => a.name.endsWith('.tar.gz'));
  if (!pkg) throw new Error(`Release ${rel.tag_name} has no .tar.gz package attached`);

  return {
    version: String(rel.tag_name || '').replace(/^v/, ''),
    url: pkg.browser_download_url,
    sha256: await findSha256(assets, rel.body),
    notes: toNotes(rel.body),
    released: (rel.published_at || '').slice(0, 10),
    source: 'api',
  };
}

/** Checksum from a .sha256 asset, or from a 64-hex string in the release notes. */
async function findSha256(assets, body) {
  const sumAsset = assets.find(a => a.name.endsWith('.sha256'));
  if (sumAsset) {
    try {
      const res = await fetch(sumAsset.browser_download_url, { redirect: 'follow', headers: UA });
      if (res.ok) {
        const text = await res.text();
        const m = text.match(/\b[a-f0-9]{64}\b/i);
        if (m) return m[0].toLowerCase();
      }
    } catch { /* fall through */ }
  }
  const m = String(body || '').match(/\b[a-f0-9]{64}\b/i);
  return m ? m[0].toLowerCase() : null;
}

function toNotes(notes) {
  if (Array.isArray(notes)) return notes;
  if (!notes) return [];
  return String(notes)
    .split('\n')
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(l => l && !l.startsWith('#'))
    .slice(0, 12);
}
