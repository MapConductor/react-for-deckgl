import {
  bearingFromNativeHeading,
  computeOffset,
  createGeoPoint,
  createMapCameraPosition,
  toNativeHeading,
  type MapCameraPosition,
} from '@mapconductor/js-sdk-core';
import type { DeckGLViewState } from './DeckGLMap';
import { ZoomAltitudeConverter } from './zoom/ZoomAltitudeConverter';

const converter = new ZoomAltitudeConverter();

/**
 * 負 tilt エミュレーションの較正値。**android / ios / 他の web プロバイダと同じ数値**
 * （`react-for-maplibre` / `react-for-mapbox` / `react-for-leaflet` ほか）。
 * ここだけ変えると同じ tilt でプロバイダごとに違う絵が出る。
 */
const NEGATIVE_TILT_TARGET_DISTANCE_SCALE = 1.83;
const NEGATIVE_TILT_ZOOM_OFFSET_AT_MAX_TILT = -0.9;
/** 負 tilt で使う仰角の上限。エミュレーションの較正はここまでで取ってある。 */
const NEGATIVE_TILT_MAX_DEG = 60;

/**
 * プログラムから指定されたズームを整数へ丸める。
 *
 * 基準である Google Maps 2D が整数ズームしか出さない（9.5 → 10、4.5 → 5）のに対し、
 * deck.gl は本当の小数ズームを描くので、揃えないと同じ指定で最大半段ずれる。
 * 他の web プロバイダも同じ丸めをしている。読み出し側（{@link toMapCameraPosition}）は
 * 小数のまま返す——ジェスチャ中の実測値を丸めてはいけない。
 */
function snapZoomToGoogle(zoom: number): number {
  return Math.round(zoom);
}

/** カメラから見て「前方（視線方向）」へ何メートル進めば地面の注視点に届くか。 */
function forwardDistanceMeters(nativeZoom: number, latitude: number, tiltAbsDeg: number): number {
  const tiltAbsRad = (tiltAbsDeg * Math.PI) / 180;
  const altitude = converter.zoomLevelToAltitude({ zoomLevel: nativeZoom, latitude, tilt: 0 });
  return altitude * Math.cos(tiltAbsRad) * Math.tan(tiltAbsRad) * NEGATIVE_TILT_TARGET_DISTANCE_SCALE;
}

/**
 * MapConductor のカメラ → deck.gl の `viewState`。
 *
 * ## bearing は符号が反転する
 *
 * MapConductor の `bearing` は「増やすと地図が時計回りに回る」向き。deck.gl は
 * Mapbox / MapLibre と同じ heading 系（カメラが向いている方位）なので符号が逆になる。
 * 変換はコアの {@link toNativeHeading} に一本化してある。
 *
 * ## tilt < 0（見上げ）
 *
 * deck.gl の `pitch` は 0 以上しか取れない。負の値を渡しても「手前側へ倒す」動きには
 * ならない。そこで **カメラ位置ではなく注視点を前方へずらし、`pitch` は `abs(tilt)` で
 * 描く**——android / ios / 他の web プロバイダと同じ回避策。
 *
 * 手前を見下ろすのではなく奥を見上げた絵になるので、注視点をカメラの向き
 * （heading）へ `altitude * cos(t) * tan(t) * 1.83` メートル進める。同時にズームを
 * 最大仰角で −0.9 段ぶん引き、視野に入る範囲を正 tilt 側と揃える。
 */
export function toDeckViewState(position: MapCameraPosition): Pick<
  DeckGLViewState,
  'longitude' | 'latitude' | 'zoom' | 'bearing' | 'pitch'
> {
  const heading = toNativeHeading(position.bearing);

  if (position.tilt >= 0) {
    return {
      longitude: position.position.longitude,
      latitude: position.position.latitude,
      zoom: converter.toNativeZoom(snapZoomToGoogle(position.zoom), position.position.latitude),
      bearing: heading,
      pitch: position.tilt,
    };
  }

  const tiltAbsDeg = Math.min(Math.abs(position.tilt), NEGATIVE_TILT_MAX_DEG);
  const nativeZoom = converter.toNativeZoom(position.zoom, position.position.latitude);
  const target = computeOffset({
    origin: position.position,
    distance: forwardDistanceMeters(nativeZoom, position.position.latitude, tiltAbsDeg),
    heading,
  });
  const adjustedZoom = position.zoom
    + NEGATIVE_TILT_ZOOM_OFFSET_AT_MAX_TILT * (tiltAbsDeg / NEGATIVE_TILT_MAX_DEG);

  return {
    longitude: target.longitude,
    latitude: target.latitude,
    zoom: converter.toNativeZoom(adjustedZoom, target.latitude),
    bearing: heading,
    pitch: tiltAbsDeg,
  };
}

/**
 * deck.gl の `viewState` → MapConductor のカメラ。
 *
 * `logicalTiltHint` は直近にアプリが要求した tilt。**負 tilt は deck.gl 側に
 * 「負である」という情報が残らない**（前方へずらした注視点と正の `pitch` しか無い）ので、
 * アプリが見上げを要求していたことはこのヒントでしか判別できない。負だったときは
 * {@link toDeckViewState} の逆——注視点を heading の逆向きへ同じ距離だけ戻し、
 * ズームの補正を打ち消し、`tilt` を負で返す。
 */
export function toMapCameraPosition({
  longitude,
  latitude,
  zoom,
  bearing,
  pitch,
  logicalTiltHint = null,
}: {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
  logicalTiltHint?: number | null;
}): MapCameraPosition {
  const pitchAbsDeg = Math.min(Math.abs(pitch), NEGATIVE_TILT_MAX_DEG);

  if (logicalTiltHint != null && logicalTiltHint < 0 && pitchAbsDeg > 0) {
    const shiftedCenter = createGeoPoint({ latitude, longitude });
    const unifiedZoom = converter.toUnifiedZoom(zoom, latitude);
    const originalUnifiedZoom = unifiedZoom
      - NEGATIVE_TILT_ZOOM_OFFSET_AT_MAX_TILT * (pitchAbsDeg / NEGATIVE_TILT_MAX_DEG);
    const originalNativeZoom = converter.toNativeZoom(originalUnifiedZoom, latitude);
    const originalPosition = computeOffset({
      origin: shiftedCenter,
      distance: forwardDistanceMeters(originalNativeZoom, latitude, pitchAbsDeg),
      heading: bearing + 180,
    });
    return createMapCameraPosition({
      position: originalPosition,
      zoom: originalUnifiedZoom,
      bearing: bearingFromNativeHeading(bearing),
      tilt: -pitchAbsDeg,
    });
  }

  return createMapCameraPosition({
    position: createGeoPoint({ latitude, longitude }),
    zoom: converter.toUnifiedZoom(zoom, latitude),
    bearing: bearingFromNativeHeading(bearing),
    tilt: pitch,
  });
}
