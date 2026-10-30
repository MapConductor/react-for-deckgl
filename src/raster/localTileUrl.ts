import { parseTilePixelRatio, tilePixelRatioSuffix } from '@mapconductor/js-sdk-core';

/**
 * Marker tiles deck.gl reads straight from `LocalTileServer`. The ratio
 * suffix (`@2x`) means the same as in the Service Worker's `/__tiles/` URLs.
 */
export const MAPCONDUCTOR_TILE_PROTOCOL = 'mc-local-tile';

export interface LocalTileTemplate {
  routeId: string;
  tileSize: number;
  /** Cache generation embedded in SDK-owned tile URLs. */
  cacheKey: string | null;
  /** Device pixels per CSS pixel the route's tiles are drawn at (`@2x` → 2). */
  pixelRatio: number;
}

// mc-local-tile://{routeId}/{tileSize}/{cacheKey?}/{z}/{x}/{y}{@2x?}.png
export function localTileUrlTemplate({
  routeId,
  tileSize,
  cacheKey,
  pixelRatio,
}: {
  routeId: string;
  tileSize: number;
  cacheKey?: string;
  pixelRatio?: number;
}): string {
  const base = `${MAPCONDUCTOR_TILE_PROTOCOL}://${routeId}/${tileSize}`;
  const tile = `{z}/{x}/{y}${tilePixelRatioSuffix(pixelRatio)}.png`;
  if (cacheKey) {
    return `${base}/${cacheKey}/${tile}`;
  }
  return `${base}/${tile}`;
}

/**
 * MapConductor 内製タイル（タイル方式マーカー）の URL を見分ける。
 *
 * Service Worker 経由の `/__tiles/<route>/<size>/...` と、SW が使えない環境向けの
 * `mc-local-tile://<route>/<size>/...` の 2 系統がある。どちらもネットワークには
 * 出ないので、deck.gl の既定のタイル取得ではなく `LocalTileServer` から直接読む。
 * そのため倍率（`{y}@2x.png`）もここで読み取ってリクエストに載せる。
 */
export function parseLocalTileTemplate(template: string): LocalTileTemplate | null {
  const pixelRatio = parseTilePixelRatio(template.match(/(@\d+x)\.png$/)?.[1]);
  if (template.startsWith(`${MAPCONDUCTOR_TILE_PROTOCOL}://`)) {
    const url = new URL(template);
    const parts = url.pathname.split('/').filter(Boolean);
    const tileSize = Number(parts[0]);
    return Number.isFinite(tileSize)
      ? { routeId: url.hostname, tileSize, cacheKey: parts[1] ?? null, pixelRatio }
      : null;
  }
  const match = template.match(/^\/?__tiles\/([^/]+)\/(\d+)(?:\/([^/]+))?\//);
  return match
    ? { routeId: match[1], tileSize: Number(match[2]), cacheKey: match[3] ?? null, pixelRatio }
    : null;
}
