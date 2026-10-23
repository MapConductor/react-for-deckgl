import {
  AbstractCircleOverlayRenderer,
  AbstractGroundImageOverlayRenderer,
  AbstractPolygonOverlayRenderer,
  AbstractPolylineOverlayRenderer,
  CircleController,
  CircleManager,
  GroundImageController,
  GroundImageManager,
  PolygonController,
  PolygonManager,
  PolylineController,
  PolylineManager,
  buildUnwrappedPolygonRings,
  buildUnwrappedPolylinePath,
  circleToRing,
  type CircleEntity,
  type CircleState,
  type GeoPoint,
  type GroundImageEntity,
  type GroundImageState,
  type PolygonEntity,
  type PolygonState,
  type PolylineEntity,
  type PolylineState,
} from '@mapconductor/js-sdk-core';
import { BitmapLayer, PathLayer, PolygonLayer } from '@deck.gl/layers';
import { DeckGLLayerOrder } from '../DeckGLMap';
import { DeckGLMapViewHolder } from '../DeckGLMapViewHolder';
import { toRGBA } from '../helpers';

/**
 * レンダラがエンティティに持たせる「実体」。
 *
 * deck.gl のレイヤーは不変オブジェクトなので、`maplibregl.Marker` のような
 * 持ち回せるハンドルが存在しない。代わりにレジストリ上の id を持ち、更新は
 * 「同じ id へ新しいレイヤーを登録し直す」形にする。
 */
export interface DeckGLLayerHandle {
  readonly layerId: string;
}

type LngLat = [number, number];

const toRing = (points: readonly GeoPoint[]): LngLat[] =>
  points.map(point => [point.longitude, point.latitude]);

// ── Circle ───────────────────────────────────────────────────────────────────

export class DeckGLCircleRenderer extends AbstractCircleOverlayRenderer<
  DeckGLMapViewHolder,
  DeckGLLayerHandle
> {
  async createCircle(state: CircleState): Promise<DeckGLLayerHandle> {
    const handle: DeckGLLayerHandle = { layerId: `mc-circle-${state.id}` };
    this.apply(handle, state);
    return handle;
  }

  async updateCircleProperties({
    circle: handle,
    current,
  }: {
    circle: DeckGLLayerHandle;
    current: CircleEntity<DeckGLLayerHandle>;
    prev: CircleEntity<DeckGLLayerHandle>;
  }): Promise<DeckGLLayerHandle> {
    this.apply(handle, current.state);
    return handle;
  }

  async removeCircle(entity: CircleEntity<DeckGLLayerHandle>): Promise<void> {
    this.holder.map.registry.remove(entity.circle.layerId);
  }

  private apply(handle: DeckGLLayerHandle, state: CircleState): void {
    // 円はコア共通の幾何（`circleToRing`）から作る。deck.gl は測地線円を持たないが、
    // 持っていても使わない：形の定義（測地線か平面か）はプロバイダ間で揃える。
    const ring = toRing(circleToRing(state.center, state.radiusMeters, state.geodesic));
    this.holder.map.registry.set(
      handle.layerId,
      new PolygonLayer<{ polygon: LngLat[] }>({
        id: handle.layerId,
        data: [{ polygon: ring }],
        getPolygon: d => d.polygon,
        filled: true,
        stroked: state.strokeWidth > 0,
        getFillColor: toRGBA(state.fillColor, [0, 0, 0, 0]),
        getLineColor: toRGBA(state.strokeColor),
        getLineWidth: state.strokeWidth,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: state.strokeWidth > 0 ? 1 : 0,
        // クリックはコアの幾何ヒットテスト（タップ許容つき）で解決する。
        // deck.gl の picking を使うと、順序も許容量も他プロバイダと揃わない。
        pickable: false,
      }),
      DeckGLLayerOrder.circle + clampZIndex(state.zIndex ?? 0),
    );
  }
}

export class DeckGLCircleController extends CircleController<DeckGLLayerHandle> {
  constructor(renderer: DeckGLCircleRenderer) {
    super({ circleManager: new CircleManager(), renderer });
  }
}

// ── Polyline ─────────────────────────────────────────────────────────────────

export class DeckGLPolylineRenderer extends AbstractPolylineOverlayRenderer<
  DeckGLMapViewHolder,
  DeckGLLayerHandle
> {
  async createPolyline(state: PolylineState): Promise<DeckGLLayerHandle> {
    const handle: DeckGLLayerHandle = { layerId: `mc-polyline-${state.id}` };
    this.apply(handle, state);
    return handle;
  }

  async updatePolylineProperties({
    polyline: handle,
    current,
  }: {
    polyline: DeckGLLayerHandle;
    current: PolylineEntity<DeckGLLayerHandle>;
    prev: PolylineEntity<DeckGLLayerHandle>;
  }): Promise<DeckGLLayerHandle> {
    this.apply(handle, current.state);
    return handle;
  }

  async removePolyline(entity: PolylineEntity<DeckGLLayerHandle>): Promise<void> {
    this.holder.map.registry.remove(entity.polyline.layerId);
  }

  private apply(handle: DeckGLLayerHandle, state: PolylineState): void {
    // 密化（測地線なら大円、そうでなければ緯度経度の線形補間）と経度の巻き戻しは
    // コアの共通処理。deck.gl は範囲外の経度をそのまま受けるので、日付変更線を
    // またぐ線も同じワールドコピーのまま連続して描ける。
    const path = toRing(buildUnwrappedPolylinePath(state.points, state.geodesic));
    this.holder.map.registry.set(
      handle.layerId,
      new PathLayer<{ path: LngLat[] }>({
        id: handle.layerId,
        data: [{ path }],
        getPath: d => d.path,
        getColor: toRGBA(state.strokeColor),
        getWidth: state.strokeWidth,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        capRounded: true,
        jointRounded: true,
        pickable: false,
      }),
      DeckGLLayerOrder.polyline + clampZIndex(state.zIndex),
    );
  }
}

export class DeckGLPolylineController extends PolylineController<DeckGLLayerHandle> {
  constructor(renderer: DeckGLPolylineRenderer) {
    super({ polylineManager: new PolylineManager(), renderer });
  }
}

// ── Polygon ──────────────────────────────────────────────────────────────────

export class DeckGLPolygonRenderer extends AbstractPolygonOverlayRenderer<
  DeckGLMapViewHolder,
  DeckGLLayerHandle
> {
  async createPolygon(state: PolygonState): Promise<DeckGLLayerHandle> {
    const handle: DeckGLLayerHandle = { layerId: `mc-polygon-${state.id}` };
    this.apply(handle, state);
    return handle;
  }

  async updatePolygonProperties({
    polygon: handle,
    current,
  }: {
    polygon: DeckGLLayerHandle;
    current: PolygonEntity<DeckGLLayerHandle>;
    prev: PolygonEntity<DeckGLLayerHandle>;
  }): Promise<DeckGLLayerHandle> {
    this.apply(handle, current.state);
    return handle;
  }

  async removePolygon(entity: PolygonEntity<DeckGLLayerHandle>): Promise<void> {
    this.holder.map.registry.remove(entity.polygon.layerId);
  }

  private apply(handle: DeckGLLayerHandle, state: PolygonState): void {
    const { outerRings, holeRings } = buildUnwrappedPolygonRings(
      state.points,
      state.holes,
      state.geodesic,
    );
    // deck.gl の PolygonLayer は「1 番目が外周、以降が穴」の環の配列を受ける。
    const rings = [...outerRings, ...holeRings].map(toRing);
    this.holder.map.registry.set(
      handle.layerId,
      new PolygonLayer<{ polygon: LngLat[][] }>({
        id: handle.layerId,
        data: rings.length > 0 ? [{ polygon: rings }] : [],
        getPolygon: d => d.polygon,
        filled: true,
        stroked: state.strokeWidth > 0,
        getFillColor: toRGBA(state.fillColor, [0, 0, 0, 0]),
        getLineColor: toRGBA(state.strokeColor),
        getLineWidth: state.strokeWidth,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: state.strokeWidth > 0 ? 1 : 0,
        pickable: false,
      }),
      DeckGLLayerOrder.polygon + clampZIndex(state.zIndex),
    );
  }
}

export class DeckGLPolygonController extends PolygonController<DeckGLLayerHandle> {
  constructor(renderer: DeckGLPolygonRenderer) {
    super({ polygonManager: new PolygonManager(), renderer });
  }
}

// ── GroundImage ──────────────────────────────────────────────────────────────

export class DeckGLGroundImageRenderer extends AbstractGroundImageOverlayRenderer<
  DeckGLMapViewHolder,
  DeckGLLayerHandle
> {
  async createGroundImage(state: GroundImageState): Promise<DeckGLLayerHandle | null> {
    if (!state.bounds.southWest || !state.bounds.northEast) return null;
    const handle: DeckGLLayerHandle = { layerId: `mc-ground-image-${state.id}` };
    this.apply(handle, state);
    return handle;
  }

  async updateGroundImageProperties({
    groundImage: handle,
    current,
  }: {
    groundImage: DeckGLLayerHandle;
    current: GroundImageEntity<DeckGLLayerHandle>;
    prev: GroundImageEntity<DeckGLLayerHandle>;
  }): Promise<DeckGLLayerHandle | null> {
    if (!current.state.bounds.southWest || !current.state.bounds.northEast) {
      this.holder.map.registry.remove(handle.layerId);
      return null;
    }
    this.apply(handle, current.state);
    return handle;
  }

  async removeGroundImage(entity: GroundImageEntity<DeckGLLayerHandle>): Promise<void> {
    this.holder.map.registry.remove(entity.groundImage.layerId);
  }

  private apply(handle: DeckGLLayerHandle, state: GroundImageState): void {
    const { southWest, northEast } = state.bounds;
    if (!southWest || !northEast) return;
    this.holder.map.registry.set(
      handle.layerId,
      new BitmapLayer({
        id: handle.layerId,
        image: state.imageUrl,
        bounds: [southWest.longitude, southWest.latitude, northEast.longitude, northEast.latitude],
        opacity: state.opacity,
        pickable: false,
      }),
      // GroundImageState は zIndex を持たない（他プロバイダも固定の pane に置く）。
      DeckGLLayerOrder.groundImage,
    );
  }
}

export class DeckGLGroundImageController extends GroundImageController<DeckGLLayerHandle> {
  constructor(renderer: DeckGLGroundImageRenderer) {
    super({ groundImageManager: new GroundImageManager(), renderer });
  }
}

/**
 * zIndex を種別の帯（20 刻み）からはみ出させない。
 * はみ出すと「ポリゴンの zIndex を上げたらマーカーより手前に来た」ことになり、
 * 他プロバイダ（レイヤ種別ごとに独立した pane を持つ）と重なり順が食い違う。
 */
function clampZIndex(zIndex: number): number {
  return Math.max(-9, Math.min(9, zIndex));
}
