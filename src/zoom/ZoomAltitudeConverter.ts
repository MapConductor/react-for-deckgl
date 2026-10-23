import { AbstractZoomAltitudeConverter, WebMercatorZoomAltitudeConverter } from '@mapconductor/js-sdk-core';

/**
 * 統一ズーム（Google Maps 基準・256px タイル）⇄ deck.gl のズーム。
 *
 * deck.gl の `WebMercatorViewport` は `@math.gl/web-mercator` の 512px ワールドを使う
 * （MapLibre / Mapbox と同じ体系）。したがって統一ズームはネイティブズーム + 1。
 * 換算式そのものはコアの {@link WebMercatorZoomAltitudeConverter} にある。
 */
export class ZoomAltitudeConverter extends WebMercatorZoomAltitudeConverter {
  /** GoogleZoom ≈ deck.gl の zoom + 1.0（512px ワールド）。 */
  static readonly DECKGL_TO_GOOGLE_ZOOM_OFFSET = 1.0;

  constructor(zoom0Altitude: number = AbstractZoomAltitudeConverter.DEFAULT_ZOOM0_ALTITUDE) {
    super(zoom0Altitude, ZoomAltitudeConverter.DECKGL_TO_GOOGLE_ZOOM_OFFSET);
  }
}
