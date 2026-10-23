import {
  BaseMapViewController,
  MapUISettingsDiagnostics,
  buildVisibleRegion,
  isEmptyCameraRestriction,
  type CameraRestriction,
  type CircleCapable,
  type GeoPoint,
  type GeoRectBounds,
  type GroundImageCapable,
  type MapCameraPosition,
  type MapUISettings,
  type MapViewControllerInterface,
  type MarkerAnimationOverlayHost,
  type MarkerCapable,
  type OnMarkerEventHandler,
  type PolygonCapable,
  type PolylineCapable,
  type RasterLayerCapable,
  type VisibleRegion,
} from '@mapconductor/js-sdk-core';
import { WebMercatorViewport } from '@deck.gl/core';
import { DeckGLMap } from './DeckGLMap';
import { toDeckViewState, toMapCameraPosition } from './MapCameraPosition';
import { DeckGLMapViewHolder } from './DeckGLMapViewHolder';
import { DeckGLMarkerController } from './marker/DeckGLMarkerController';
import { DeckGLMarkerEventController } from './marker/DeckGLMarkerEventController';
import { DeckGLRasterLayerController } from './raster/DeckGLRasterLayer';
import {
  DeckGLCircleController,
  DeckGLGroundImageController,
  DeckGLPolygonController,
  DeckGLPolylineController,
} from './vector/DeckGLVectorControllers';
import { ZoomAltitudeConverter } from './zoom/ZoomAltitudeConverter';

/**
 * カメラが止まったとみなすまでの待ち時間。
 *
 * deck.gl には `moveend` に相当するイベントが無い（`onViewStateChange` が毎フレーム
 * 来るだけ）ので、最後の変更から一定時間止まったら停止と判断する。慣性やカメラ遷移の
 * 最中は `interactionState` が立つので、そちらは長めに待つ。
 */
const CAMERA_IDLE_MILLIS = 140;
const CAMERA_IDLE_AFTER_INTERACTION_MILLIS = 40;

type MarkerListenerKind = 'click' | 'dragStart' | 'drag' | 'dragEnd' | 'animateStart' | 'animateEnd';

export class DeckGLMapViewController
  extends BaseMapViewController
  implements
    MapViewControllerInterface,
    MarkerCapable,
    CircleCapable,
    PolylineCapable,
    PolygonCapable,
    GroundImageCapable,
    RasterLayerCapable {
  private readonly map: DeckGLMap;
  /**
   * deck.gl の canvas はデバイス初期化が終わるまで存在しないので、
   * ポインタを掴むこのコントローラは `onLoad` まで作れない（{@link notifyLoaded}）。
   * それまでに来たリスナー登録はここに溜めて、生成時にまとめて流し込む。
   */
  private markerEventController: DeckGLMarkerEventController | null = null;
  private readonly pendingMarkerListeners = new Map<MarkerListenerKind, OnMarkerEventHandler | null>();
  private readonly zoomConverter = new ZoomAltitudeConverter();
  private destroyed = false;
  private moving = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 直近にアプリが要求した tilt。**負 tilt は deck.gl 側に残らない**ので、
   * 見上げを要求されていたことはこの値でしか判別できない
   * （{@link toMapCameraPosition} 参照）。
   */
  private logicalTiltHint: number | null;

  constructor(
    readonly holder: DeckGLMapViewHolder,
    private readonly markerController: DeckGLMarkerController,
    private readonly circleController: DeckGLCircleController,
    private readonly polylineController: DeckGLPolylineController,
    private readonly polygonController: DeckGLPolygonController,
    private readonly groundImageController: DeckGLGroundImageController,
    private readonly rasterLayerController: DeckGLRasterLayerController,
    initialTilt: number | null = null,
  ) {
    super();
    this.map = holder.map;
    this.logicalTiltHint = initialTilt;

    // ★ 登録を忘れると composition もクリックのカスケードも黙って効かなくなる。
    this.registerOverlayController(this.markerController);
    this.registerOverlayController(this.circleController);
    this.registerOverlayController(this.polylineController);
    this.registerOverlayController(this.polygonController);
    this.registerOverlayController(this.groundImageController);
    this.registerOverlayController(this.rasterLayerController);

    // タイル方式マーカーはラスタレイヤーとして描く。
    markerController.onRasterLayerUpdate = async state => {
      if (state) await rasterLayerController.updateInternal(state);
      else await rasterLayerController.removeInternal('mc-marker-tiles');
    };

    this.installListeners();
  }

  getMap(): DeckGLMap { return this.map; }

  // ── SDK イベントの転送 ──────────────────────────────────────────────────────

  private installListeners(): void {
    this.map.onViewStateChanged = (_viewState, interacting) => {
      const camera = this.getCameraPosition();
      if (!this.moving) {
        this.moving = true;
        this.notifyCameraMoveStart(camera);
      }
      this.notifyCameraMove(camera);
      this.scheduleIdle(interacting);
    };

    this.map.onClick = info => {
      // `info.coordinate` はレイヤーに当たったときだけ埋まる。ここは常に
      // ホルダーの逆投影を使う——投影の入口を 1 か所に保つため。
      this.dispatchTap(this.holder.fromScreenOffsetSync({ x: info.x, y: info.y }));
    };

    this.map.onLongClick = offset => {
      this.emitMapLongClick(this.holder.fromScreenOffsetSync(offset));
    };
  }

  private scheduleIdle(interacting: boolean): void {
    if (this.idleTimer != null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.moving = false;
      if (this.destroyed) return;
      this.notifyCameraMoveEnd(this.getCameraPosition());
    }, interacting ? CAMERA_IDLE_MILLIS : CAMERA_IDLE_AFTER_INTERACTION_MILLIS);
  }

  /** `Deck` の `onLoad` から呼ばれる。 */
  notifyLoaded(): void {
    if (this.destroyed) return;
    if (!this.markerEventController) {
      // ドラッグの状態遷移・パン抑止・**掴む前の値への復元**はコアが持つ。
      this.markerEventController = new DeckGLMarkerEventController(this.markerController);
      for (const [kind, listener] of this.pendingMarkerListeners) {
        this.applyMarkerListener(kind, listener);
      }
      this.pendingMarkerListeners.clear();
    }
    this.notifyMapInitialized();
  }

  private setMarkerListener(kind: MarkerListenerKind, listener: OnMarkerEventHandler | null): void {
    if (this.markerEventController) this.applyMarkerListener(kind, listener);
    else this.pendingMarkerListeners.set(kind, listener);
  }

  private applyMarkerListener(kind: MarkerListenerKind, listener: OnMarkerEventHandler | null): void {
    const events = this.markerEventController;
    if (!events) return;
    switch (kind) {
      case 'click': events.setClickListener(listener); break;
      case 'dragStart': events.setDragStartListener(listener); break;
      case 'drag': events.setDragListener(listener); break;
      case 'dragEnd': events.setDragEndListener(listener); break;
      case 'animateStart': events.setAnimateStartListener(listener); break;
      case 'animateEnd': events.setAnimateEndListener(listener); break;
    }
  }

  // ── マーカーのタップ（カスケードの先頭） ─────────────────────────────────────

  protected override dispatchMarkerTap(position: GeoPoint): boolean {
    const entity = this.markerController.findWithZoom(
      position,
      this.map.getZoom(),
      this.markerEventController?.lastPointerType ?? 'mouse',
    );
    if (!entity?.state.clickable) return false;
    this.markerController.dispatchClick(entity.state);
    return true;
  }

  // ── カメラ ─────────────────────────────────────────────────────────────────

  /**
   * **生ズームの統一ズームへの変換と bearing の符号反転を忘れない。** ズームがずれると
   * 当たり判定の許容量が実際の縮尺と食い違い、「線や円をタップしても反応しない」形で
   * 表面化する。変換はどちらも {@link toMapCameraPosition} が持つ。
   */
  getCameraPosition(): MapCameraPosition {
    const viewState = this.map.getViewState();
    return toMapCameraPosition({
      longitude: viewState.longitude,
      latitude: viewState.latitude,
      zoom: viewState.zoom,
      bearing: viewState.bearing,
      pitch: viewState.pitch,
      logicalTiltHint: this.logicalTiltHint,
    }).copy({ visibleRegion: this.getVisibleRegion() });
  }

  /** レイアウト前（幅か高さが 0）は null。他プロバイダと同じ契約。 */
  private getVisibleRegion(): VisibleRegion | null {
    return buildVisibleRegion(this.holder, this.map.getSize());
  }

  async moveCamera(position: MapCameraPosition): Promise<boolean> {
    this.logicalTiltHint = position.tilt;
    this.map.setViewState(toDeckViewState(position));
    return true;
  }

  async animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean> {
    this.logicalTiltHint = position.tilt;
    this.map.setViewState(toDeckViewState(position), {
      durationMillis: durationMillis > 0 ? durationMillis : 500,
    });
    return true;
  }

  async fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean> {
    const { southWest, northEast } = bounds;
    if (!southWest || !northEast) return false;
    const { width, height } = this.map.getSize();
    // `WebMercatorViewport.fitBounds` は padding が画面の半分以上だと投げる。
    const safePadding = Math.max(0, Math.min(padding, Math.floor(Math.min(width, height) / 2) - 1));
    const fitted = new WebMercatorViewport({ width, height }).fitBounds(
      [
        [southWest.longitude, southWest.latitude],
        [northEast.longitude, northEast.latitude],
      ],
      { padding: safePadding },
    );
    this.map.setViewState({
      longitude: fitted.longitude,
      latitude: fitted.latitude,
      zoom: fitted.zoom,
    });
    return true;
  }

  // ── ジェスチャ ─────────────────────────────────────────────────────────────

  /**
   * deck.gl の `dragRotate` は**回転と傾斜を 1 つのハンドラで持つ**。
   * 片方だけ切ることはできないので、両方 false のときだけ切り、
   * 片方だけ要求されたときは切れなかった側を 1 度だけ警告する。
   */
  applyUISettings(settings: MapUISettings): void {
    const rotateOrTilt = settings.rotateGesture || settings.tiltGesture;
    this.map.setControllerOptions({
      dragPan: settings.scrollGesture,
      scrollZoom: settings.zoomGesture,
      doubleClickZoom: settings.zoomGesture,
      touchZoom: settings.zoomGesture,
      dragRotate: rotateOrTilt,
      touchRotate: rotateOrTilt,
      keyboard: settings.scrollGesture || settings.zoomGesture,
    });

    if (rotateOrTilt) {
      MapUISettingsDiagnostics.warnIfRequested(
        settings.rotateGesture, 'rotate', 'deck.gl',
        'dragRotate handles bearing and pitch together, so rotation stays enabled while tilt is',
      );
      MapUISettingsDiagnostics.warnIfRequested(
        settings.tiltGesture, 'tilt', 'deck.gl',
        'dragRotate handles bearing and pitch together, so tilt stays enabled while rotation is',
      );
    }
  }

  /**
   * deck.gl の `MapController` はネイティブに範囲制限を持つ（`maxBounds` と
   * `minZoom` / `maxZoom`）ので直接適用する。**`super` は呼ばない**——基底クラスに
   * 保持させるとカメラ停止時のクランプ補正まで走り、二重適用になる。
   */
  override setCameraRestriction(restriction: CameraRestriction | null): void {
    const effective = isEmptyCameraRestriction(restriction) ? null : restriction;
    const sw = effective?.bounds?.southWest ?? null;
    const ne = effective?.bounds?.northEast ?? null;

    this.map.setControllerOptions({
      maxBounds: sw && ne
        ? [[sw.longitude, sw.latitude], [ne.longitude, ne.latitude]]
        : null,
    });

    const latitude = this.map.getViewState().latitude;
    this.map.setViewState({
      minZoom: effective?.minZoom != null
        ? this.zoomConverter.toNativeZoom(effective.minZoom, latitude)
        : 0,
      maxZoom: effective?.maxZoom != null
        ? this.zoomConverter.toNativeZoom(effective.maxZoom, latitude)
        : 20,
    });
  }

  // ── マーカーのリスナー ──────────────────────────────────────────────────────

  setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void { this.setMarkerListener('click', listener); }
  setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void { this.setMarkerListener('dragStart', listener); }
  setOnMarkerDrag(listener: OnMarkerEventHandler | null): void { this.setMarkerListener('drag', listener); }
  setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void { this.setMarkerListener('dragEnd', listener); }
  setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void { this.setMarkerListener('animateStart', listener); }
  setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void { this.setMarkerListener('animateEnd', listener); }
  setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void { this.markerController.setMarkerAnimationOverlayHost(host); }

  async clearOverlays(): Promise<void> {
    await Promise.all([
      this.markerController.clear(),
      this.circleController.clear(),
      this.polylineController.clear(),
      this.polygonController.clear(),
      this.groundImageController.clear(),
      this.rasterLayerController.clear(),
    ]);
  }

  destroy(): void {
    super.destroy();
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.idleTimer != null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.markerEventController?.destroy();
    void this.clearOverlays().finally(() => {
      this.markerController.destroy();
      this.map.destroy();
    });
  }
}
