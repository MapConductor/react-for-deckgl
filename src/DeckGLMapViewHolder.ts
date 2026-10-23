import {
  MapViewHolderBase,
  type GeoPoint,
  type GeoPointInterface,
  type Offset,
} from '@mapconductor/js-sdk-core';
import { DeckGLMap } from './DeckGLMap';

/**
 * 投影の唯一の注入点。**投影をここ以外に書かないこと。**
 *
 * コアの InfoBubble・マーカーアニメーション・タイル方式マーカーの当たり判定・
 * `buildVisibleRegion` は、すべてここを通して画面座標を得る。deck.gl は
 * `WebMercatorViewport` が bearing / pitch を含めて正確に投影するので、
 * Leaflet ドライバーのような CSS 変換の合成は要らない。
 */
export class DeckGLMapViewHolder extends MapViewHolderBase<HTMLElement, DeckGLMap> {
  constructor(
    readonly mapView: HTMLElement,
    readonly map: DeckGLMap,
  ) {
    super();
  }

  toScreenOffset(position: GeoPointInterface): Offset {
    return this.map.project(position);
  }

  override fromScreenOffsetSync(offset: Offset): GeoPoint {
    return this.map.unproject(offset);
  }
}
