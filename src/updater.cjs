const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPOSITORY = 'athuljohny77/Checkpoint';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MAX_DOWNLOAD = 350 * 1024 * 1024;

function versionParts(version) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function isNewer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function releaseAsset(release, mode) {
  if (!release || release.draft || release.prerelease || !versionParts(release.tag_name)) return null;
  const version = release.tag_name.replace(/^v/, '');
  const filename = `Checkpoint-${version}-${mode === 'portable' ? 'Windows' : 'Setup'}.exe`;
  const expected = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${filename}`;
  const asset = release.assets?.find(asset => asset.name === filename && asset.browser_download_url === expected);
  const checksums = release.assets?.find(asset => asset.name === 'SHA256SUMS.txt' && asset.browser_download_url === `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/SHA256SUMS.txt`);
  if (!asset || !checksums || !Number.isSafeInteger(asset.size) || asset.size < 2 || asset.size > MAX_DOWNLOAD) throw new Error('The latest release does not contain a complete Windows update yet. Try again later.');
  return { version, filename, url: expected, size: asset.size, checksumsUrl: checksums.browser_download_url,
    notes: typeof release.body === 'string' ? release.body.slice(0, 16000) : '' };
}
function trustedUrl(value) {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    ['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
}
async function githubFetch(url, fetchImpl = fetch) {
  const signal = AbortSignal.timeout(180000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!trustedUrl(url)) throw new Error('The update download address was not trusted.');
    const response = await fetchImpl(url, { redirect: 'manual', signal, headers: {
      'User-Agent': 'Checkpoint-Update-Checker', Accept: 'application/vnd.github+json'
    } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('The update server returned an invalid redirect.');
      url = new URL(location, url).href; continue;
    }
    return response;
  }
  throw new Error('The update download redirected too many times.');
}
async function smallText(response, maxBytes) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('The update server response was too large.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
class UpdateManager {
  constructor({ currentVersion, directory, mode = 'portable', fetchImpl = fetch, onChange = () => {}, onAvailable = () => {} }) {
    Object.assign(this, { currentVersion, directory, mode, fetchImpl, onChange, onAvailable });
    this.status = { phase: 'idle', version: null, notes: '', progress: 0, error: '', checkedAt: null };
    this.notifiedVersion = null;
  }
  snapshot() { return { ...this.status }; }
  change(changes) { Object.assign(this.status, changes); this.onChange(this.snapshot()); }
  async check() {
    if (['checking', 'downloading', 'installing'].includes(this.status.phase)) return this.snapshot();
    this.change({ phase: 'checking', error: '' });
    try {
      const response = await githubFetch(API_URL, this.fetchImpl);
      if (response.status === 404) { this.release = null; this.change({phase:'current',version:null,notes:'',checkedAt:new Date().toISOString()}); return this.snapshot(); }
      if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub is limiting update checks. Try again later.' : 'Could not check GitHub for updates. Try again later.');
      const data = JSON.parse(await smallText(response, 1024 * 1024));
      if (data.draft || data.prerelease || !versionParts(data.tag_name)) throw new Error('GitHub returned an invalid stable release.');
      const release = isNewer(data.tag_name, this.currentVersion) ? releaseAsset(data, this.mode) : null;
      this.release = release;
      this.change({ phase: release ? 'available' : 'current', version: release?.version || null, notes: release?.notes || '', progress: 0, checkedAt: new Date().toISOString() });
      if (release && this.notifiedVersion !== release.version) {
        this.notifiedVersion = release.version; this.onAvailable(release);
      }
    } catch (error) { this.change({ phase: 'error', error: error.name === 'TimeoutError' ? 'The update check timed out. Try again.' : error.message }); }
    return this.snapshot();
  }
  async download() {
    if (!this.release || !['available', 'error', 'ready'].includes(this.status.phase)) throw new Error('Check for an available update first.');
    const release = this.release;
    this.change({ phase: 'downloading', progress: 0, error: '' });
    const partial = path.join(this.directory, `${release.filename}.part`);
    const destination = path.join(this.directory, release.filename);
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      const manifest = await githubFetch(release.checksumsUrl, this.fetchImpl);
      if (!manifest.ok) throw new Error('Could not download the update checksum.');
      const line = (await smallText(manifest, 16384)).split(/\r?\n/).find(line => line.trim().split(/\s+/)[1] === release.filename);
      const expected = line?.trim().split(/\s+/)[0];
      if (!/^[a-f0-9]{64}$/i.test(expected || '')) throw new Error('The release has no valid checksum for this update.');
      const response = await githubFetch(release.url, this.fetchImpl);
      if (!response.ok) throw new Error('Could not download the Windows update. Try again.');
      const hash = crypto.createHash('sha256'); let size = 0;
      const file = await fs.promises.open(partial, 'w');
      try {
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > release.size || size > MAX_DOWNLOAD) throw new Error('The update download was larger than expected.');
          hash.update(chunk);
          const buffer = Buffer.from(chunk); let offset = 0;
          while (offset < buffer.length) { const {bytesWritten} = await file.write(buffer, offset); offset += bytesWritten; }
          const progress = Math.round(size / release.size * 100);
          if (progress !== this.status.progress) this.change({ progress });
        }
        await file.sync();
      } finally { await file.close(); }
      if (size !== release.size || hash.digest('hex') !== expected.toLowerCase()) throw new Error('Update verification failed. Nothing was installed. Try downloading again.');
      const header = Buffer.alloc(2); const fd = fs.openSync(partial, 'r');
      try { fs.readSync(fd, header, 0, 2, 0); } finally { fs.closeSync(fd); }
      if (header.toString('ascii') !== 'MZ') throw new Error('The update is not a Windows executable.');
      await fs.promises.rename(partial, destination);
      this.change({ phase: 'ready', progress: 100 });
      return { file: destination, sha256: expected.toLowerCase(), version: release.version };
    } catch (error) {
      await fs.promises.unlink(partial).catch(() => {});
      this.change({ phase: 'error', error: error.message });
      throw error;
    }
  }
}
module.exports = { UpdateManager, isNewer, releaseAsset, trustedUrl, githubFetch, RELEASES_URL };
