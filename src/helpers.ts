import { createGeoPoint, type GeoPoint, type GeoPointInterface } from '@mapconductor/js-sdk-core';

/** deck.gl の色は `[r, g, b, a]`（0-255）。SDK 側は CSS 文字列で来る。 */
export type RGBAColor = [number, number, number, number];

const OPAQUE_BLACK: RGBAColor = [0, 0, 0, 255];
const cssColorCache = new Map<string, RGBAColor>();

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/**
 * CSS カラー文字列 → deck.gl の `[r, g, b, a]`。
 *
 * `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` はここで解く。
 * それ以外（名前付き色・`hsl()` 等）はブラウザの canvas に正規化させる。canvas が
 * 使えない環境（SSR）では `fallback` を返す——**投げないこと**。プロバイダの
 * デザイン定義はモジュール読み込み時に評価されるので、投げると SSR ごと落ちる。
 */
export function toRGBA(css: string | null | undefined, fallback: RGBAColor = OPAQUE_BLACK): RGBAColor {
  if (!css) return fallback;
  const key = css.trim();
  const cached = cssColorCache.get(key);
  if (cached) return cached;

  const parsed = parseHex(key) ?? parseFunctional(key) ?? parseViaCanvas(key);
  const result = parsed ?? fallback;
  cssColorCache.set(key, result);
  return result;
}

function parseHex(css: string): RGBAColor | null {
  if (!css.startsWith('#')) return null;
  const hex = css.slice(1);
  const expand = (part: string): number => parseInt(part.length === 1 ? part + part : part, 16);
  if (hex.length === 3 || hex.length === 4) {
    return [
      expand(hex[0]), expand(hex[1]), expand(hex[2]),
      hex.length === 4 ? expand(hex[3]) : 255,
    ];
  }
  if (hex.length === 6 || hex.length === 8) {
    return [
      expand(hex.slice(0, 2)), expand(hex.slice(2, 4)), expand(hex.slice(4, 6)),
      hex.length === 8 ? expand(hex.slice(6, 8)) : 255,
    ];
  }
  return null;
}

function parseFunctional(css: string): RGBAColor | null {
  const match = /^rgba?\(([^)]+)\)$/i.exec(css);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (value: string): number =>
    clampByte(value.endsWith('%') ? (parseFloat(value) / 100) * 255 : parseFloat(value));
  const alpha = parts[3] == null
    ? 255
    : clampByte((parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) * 255);
  return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha];
}

function parseViaCanvas(css: string): RGBAColor | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = '#000000';
  context.fillStyle = css;
  // 未知の色を代入しても fillStyle は変わらないので、解けなかったことが分かる。
  if (context.fillStyle === '#000000' && css.toLowerCase() !== 'black' && css !== '#000000') return null;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a];
}

/** MapConductor の座標 → deck.gl の `[longitude, latitude]`。 */
export const toLngLat = (point: GeoPointInterface): [number, number] => [
  point.longitude,
  point.latitude,
];

/** deck.gl の `[longitude, latitude]` → MapConductor の座標。 */
export const toGeoPoint = (coordinate: readonly number[]): GeoPoint => createGeoPoint({
  latitude: coordinate[1],
  longitude: coordinate[0],
});

/**
 * 経度を「地図中心と同じワールドコピー」へ寄せる。
 *
 * deck.gl の `WebMercatorViewport.project()` は経度をそのまま使い、ビューポートに
 * 近いワールドコピーを選ばない。日付変更線をまたいで地図をパンすると、[-180,180] に
 * 正規化された座標は約 360° ぶん画面外へ投影され、画面座標で描く層（InfoBubble、
 * マーカーアニメーション）が見えなくなる。Leaflet ドライバーと同じ補正。
 */
export const nearestCopyLongitude = (longitude: number, centerLongitude: number): number =>
  longitude + 360 * Math.round((centerLongitude - longitude) / 360);
