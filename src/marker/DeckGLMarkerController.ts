import {
  AbstractMarkerController,
  LocalTileServer,
  MARKER_HIT_RADIUS_MOUSE_PX,
  MARKER_HIT_RADIUS_TOUCH_PX,
  MarkerManager,
  MarkerTileRenderer,
  MarkerTilingOptions,
  RasterLayerSource,
  createDefaultIcon,
  createRasterLayerState,
  type GeoPoint,
  type MarkerEntity,
  type MarkerState,
  type Offset,
  type RasterLayerState,
  markerHitShape,
  pickMarkerHit,
  preferMarkerHit,
  tilePixelRatio,
  type MarkerHit,
} from '@mapconductor/js-sdk-core';
import { localTileUrlTemplate } from '../raster/localTileUrl';
import { ZoomAltitudeConverter } from '../zoom/ZoomAltitudeConverter';
import { DeckGLMarkerOverlayRenderer, type DeckGLActualMarker } from './DeckGLMarkerOverlayRenderer';

export class DeckGLMarkerController extends AbstractMarkerController<DeckGLActualMarker> {
  declare readonly renderer: DeckGLMarkerOverlayRenderer;

  private selected: MarkerEntity<DeckGLActualMarker> | null = null;
  private readonly zoomConverter = new ZoomAltitudeConverter();

  private tileRenderer: MarkerTileRenderer<MarkerState> | null = null;
  private tileRouteId: string | null = null;
  private tileVersion = 0;
  /** 現在のタイルを描いている倍率（CSS 1px あたりのデバイスピクセル数）。 */
  private tilePixelRatio = 1;
  // 世代番号。syncTiledOverlay は await を挟むので、後から始まった同期が先に
  // 終わることがある。古い側が後から結果を書き戻さないための番兵。
  private tileGeneration = 0;

  /** タイル方式マーカーの overlay 差し替え。ビューコントローラが繋ぐ。 */
  onRasterLayerUpdate: ((state: RasterLayerState | null) => Promise<void>) | null = null;

  constructor(
    renderer: DeckGLMarkerOverlayRenderer,
    private readonly tilingOptions: MarkerTilingOptions = MarkerTilingOptions.Default,
  ) {
    super({
      markerManager: MarkerManager.defaultManager<DeckGLActualMarker>(
        null,
        tilingOptions.minMarkerCount,
      ),
      renderer,
    });
  }

  // ── ドラッグ（コアの DefaultMarkerEventController から呼ばれる） ─────────────

  getSelectedMarker(): MarkerEntity<DeckGLActualMarker> | null {
    return this.selected;
  }

  async setSelectedMarker(entity: MarkerEntity<DeckGLActualMarker> | null): Promise<void> {
    if (!entity) {
      const selected = this.selected;
      this.selected = null;
      if (selected) this.setDraggingState(selected.state, false);
      return;
    }
    this.selected = entity;
    this.setDraggingState(entity.state, true);
  }

  updateSelectedPosition(position: GeoPoint): void {
    const selected = this.selected;
    if (!selected?.marker) return;
    selected.marker.position = position;
    this.renderer.redraw();
  }

  override async update(state: MarkerState): Promise<void> {
    // ドラッグ中はポインタが位置の権威。ここで state を流し込むと、掴んだ
    // マーカーが 1 フレームごとに元の位置へ引き戻される。
    if (this.isDragging(state)) return;
    await super.update(state);
  }

  // ── 当たり判定 ─────────────────────────────────────────────────────────────

  override find(position: GeoPoint): MarkerEntity<DeckGLActualMarker> | null {
    return this.findWithZoom(position, this.renderer.holder.map.getZoom(), 'mouse');
  }

  /**
   * アイコン画像の矩形（アンカー補正 + 入力種別ごとの許容量）で引き当てる。
   *
   * deck.gl の picking を使わない理由は 2 つ。GPU の 1 ピクセル判定はアイコンの
   * 不透明部分にきっかり当てないと拾えず、他プロバイダの「アイコンの矩形 + 許容量」と
   * 判定が食い違う。もう 1 つは、`pickable: true` にすると全マーカーぶんの
   * picking バッファを毎フレーム持つことになるため。
   */
  findWithZoom(
    position: GeoPoint | null,
    nativeZoom: number,
    pointerType: 'touch' | 'mouse',
  ): MarkerEntity<DeckGLActualMarker> | null {
    if (!position) return null;
    const holder = this.renderer.holder;
    const touch = holder.toScreenOffset(position);
    const tolerance = pointerType === 'touch'
      ? MARKER_HIT_RADIUS_TOUCH_PX
      : MARKER_HIT_RADIUS_MOUSE_PX;

    const regular = this.findAtScreen(touch, tolerance);
    if (regular?.exact) return regular.item;

    // タイル方式マーカーはラスタタイルとして描かれているので、画面には
    // エンティティが無い。統一ズーム基準で引き当て、通常マーカーと同じ規則で比べる
    // （指の下に描かれていれば、通常マーカーの近接より勝つ）。
    const unifiedZoom = this.zoomConverter.toUnifiedZoom(nativeZoom, position.latitude);
    const tiledHit = this.tileRenderer?.findHit(position, tolerance, unifiedZoom) ?? null;
    const tiledEntity = tiledHit ? this.markerManager.getEntity(tiledHit.item.id) : null;
    return preferMarkerHit<MarkerEntity<DeckGLActualMarker>>(
      regular,
      tiledHit && tiledEntity ? { ...tiledHit, item: tiledEntity } : null,
    )?.item ?? null;
  }

  /**
   * 画面座標で、描かれたピン（ラベル込み、`markerHitShape`）に当たった最前面のマーカー。
   * どれにも入っていなければ、許容量（マウスは 0、指は MARKER_HIT_RADIUS_TOUCH_PX）の
   * 内側で最も近いもの。選び方はコアの `pickMarkerHit`（画面下にあるものほど手前で、
   * IconLayer の描画順と同じ）。ビットマップの正方形全体を見ていた頃は、既定のピンの
   * 左右の透明な部分や、さらに tapTolerance（48 px）以内の点まで当たっていた。
   */
  private findAtScreen(touch: Offset, tolerance: number): MarkerHit<MarkerEntity<DeckGLActualMarker>> | null {
    const holder = this.renderer.holder;
    const visible = this.markerManager
      .allEntities()
      .filter(entity => entity.marker?.visible); // タイル方式は findHit 側で扱う
    return pickMarkerHit(
      touch,
      visible,
      entity => {
        const actual = entity.marker!;
        const icon = actual.bitmapIcon ?? (entity.state.icon ?? createDefaultIcon()).toBitmapIcon();
        return { anchorScreen: holder.toScreenOffset(actual.position), ...markerHitShape(icon) };
      },
      tolerance,
    );
  }

  // ── タイル方式 ─────────────────────────────────────────────────────────────

  protected override shouldTile(state: MarkerState, totalCount: number): boolean {
    return this.tilingOptions.enabled &&
      totalCount >= this.tilingOptions.minMarkerCount &&
      !state.draggable &&
      state.getAnimation() == null;
  }

  protected override async onTiledMarkersChanged(): Promise<void> {
    await this.syncTiledOverlay();
  }

  private async syncTiledOverlay(): Promise<void> {
    const generation = ++this.tileGeneration;
    const tiledStates = this.markerManager.allEntities()
      .filter(entity => entity.tiling)
      .map(entity => entity.state);

    if (tiledStates.length === 0) {
      await this.removeTileOverlay();
      return;
    }

    this.tileRouteId ??= `mc-deckgl-tile-${generateId()}`;
    const server = LocalTileServer.startServer();
    // タイルは CSS 256px で敷かれる。画面の倍率で描いておかないと、1x の画像が
    // 引き伸ばされてピンやラベルがぼやける。
    this.tilePixelRatio = tilePixelRatio();
    const renderer = new MarkerTileRenderer(
      tiledStates,
      256,
      this.tilingOptions.iconScaleCallback ?? undefined,
      1.0,
      false,
      this.tilingOptions.declutterPx,
      this.tilePixelRatio,
    );
    this.tileRenderer = renderer;
    this.tileVersion++;
    server.register(this.tileRouteId, renderer);

    // deck.gl のタイル取得はドライバー側の `getTileData` が握っていて、
    // `LocalTileServer` から直接読む（DeckGLRasterLayer 参照）。Service Worker を
    // 経由する必要が無いので、アイコンだけ先に読み込んでおけばよい。
    await renderer.preloadIcons();
    const template = localTileUrlTemplate({
      routeId: this.tileRouteId,
      tileSize: 256,
      cacheKey: String(this.tileVersion),
      pixelRatio: this.tilePixelRatio,
    });

    if (generation !== this.tileGeneration) return;
    await this.onRasterLayerUpdate?.(createRasterLayerState({
      id: 'mc-marker-tiles',
      source: RasterLayerSource.UrlTemplate({ template, tileSize: 256 }),
    }));
  }

  private async removeTileOverlay(): Promise<void> {
    this.tileGeneration++;
    if (!this.tileRouteId) return;
    LocalTileServer.startServer().unregister(this.tileRouteId);
    this.tileRenderer = null;
    this.tileRouteId = null;
    await this.onRasterLayerUpdate?.(null);
  }

  override async clear(): Promise<void> {
    await super.clear();
    this.renderer.clearEntries();
    await this.removeTileOverlay();
  }

  override destroy(): void {
    void this.removeTileOverlay();
    super.destroy();
  }
}

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}
