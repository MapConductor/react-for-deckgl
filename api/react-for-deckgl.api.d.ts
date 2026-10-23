import { DeckGLMapViewStateInterface, DeckGLMapDesignType } from './state.js';
export { DeckGLDesign, DeckGLDesignParams, DeckGLMapViewState, DeckGLMapViewStateParams, useDeckGLMapViewState } from './state.js';
import * as react from 'react';
import { CSSProperties, ReactNode } from 'react';
import { Offset, GeoPointInterface, GeoPoint, MapViewBaseProps, GeoRectBounds, MarkerTilingOptions, MapViewHolderBase, BitmapIcon, AbstractMarkerOverlayRenderer, AddParams, ChangeParams, MarkerEntity, AbstractMarkerController, RasterLayerState, MarkerState, CircleController, AbstractCircleOverlayRenderer, CircleState, CircleEntity, PolylineController, AbstractPolylineOverlayRenderer, PolylineState, PolylineEntity, PolygonController, AbstractPolygonOverlayRenderer, PolygonState, PolygonEntity, GroundImageController, AbstractGroundImageOverlayRenderer, GroundImageState, GroundImageEntity, RasterLayerController, RasterHeaderSupport, RasterLayerAddParams, RasterLayerChangeParams, RasterLayerEntity, MapCameraPosition, BaseMapViewController, MapViewControllerInterface, MarkerCapable, CircleCapable, PolylineCapable, PolygonCapable, GroundImageCapable, RasterLayerCapable, MapUISettings, CameraRestriction, OnMarkerEventHandler, MarkerAnimationOverlayHost, MapConfig, MapProvider } from '@mapconductor/js-sdk-core';
import { LayersList, Layer, Deck, MapView, PickingInfo, WebMercatorViewport } from '@deck.gl/core';

/** deck.gl のネイティブなカメラ表現。**ズームは 512px ワールド基準**（統一ズーム − 1）。 */
interface DeckGLViewState {
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
    pitch: number;
    minZoom?: number;
    maxZoom?: number;
}
/** `MapController` に渡すジェスチャ設定のうち、このドライバーが触るもの。 */
interface DeckGLControllerOptions {
    dragPan: boolean;
    dragRotate: boolean;
    scrollZoom: boolean;
    doubleClickZoom: boolean;
    touchZoom: boolean;
    touchRotate: boolean;
    keyboard: boolean;
    inertia: boolean | number;
    maxBounds?: [[number, number], [number, number]] | null;
}
/**
 * deck.gl のレイヤー配列を「id で差し替えられる集合」として持つ。
 *
 * deck.gl のレイヤーは不変オブジェクトで、更新は「同じ id の新しいインスタンスを
 * 渡し直す」形になる。Leaflet の `layer.addTo(map)` / `layer.remove()` に相当する
 * 差分適用点をここ 1 か所に閉じ込め、各レンダラは id とレイヤーだけを扱う。
 */
declare class DeckGLLayerRegistry {
    private readonly slots;
    private seq;
    private listener;
    private flushScheduled;
    setChangeListener(listener: ((layers: LayersList) => void) | null): void;
    set(id: string, layer: Layer | null, order: number): void;
    remove(id: string): void;
    get(id: string): Layer | null | undefined;
    has(id: string): boolean;
    layers(): LayersList;
    clear(): void;
    /**
     * 1 フレームぶんの登録をまとめて 1 回の `setProps` にする。
     *
     * `composition` は数百件のレイヤーを続けて登録するので、逐次 `setProps` すると
     * その回数だけ deck.gl のレイヤーマッチングが走る。
     */
    private scheduleFlush;
    /** 待たずに今すぐ反映する。破棄前など、マイクロタスクが回らない場面用。 */
    flushNow(): void;
}
interface DeckGLMapParams {
    container: HTMLElement;
    initialViewState: DeckGLViewState;
    controllerOptions?: Partial<DeckGLControllerOptions>;
    onLoad?: () => void;
}
/**
 * `Deck` インスタンスを地図 SDK らしい面に包んだもの。ホルダー・コントローラ・
 * レンダラはこのクラスしか触らない。
 *
 * コアの {@link DefaultMarkerEventController} が要求する面
 * （`getCanvas` / `getZoom` / `getLayer` / `dragPan`）をここで満たしているので、
 * マーカーのドラッグはプロバイダ側に 1 行も書かなくてよい。
 */
declare class DeckGLMap {
    readonly registry: DeckGLLayerRegistry;
    readonly deck: Deck<MapView>;
    private readonly container;
    private viewState;
    private controllerOptions;
    private destroyed;
    /** SDK 側のイベント。ドライバーがコアの受け口へ転送する。 */
    onViewStateChanged: ((viewState: DeckGLViewState, interacting: boolean) => void) | null;
    onClick: ((info: PickingInfo) => void) | null;
    onLongClick: ((offset: Offset) => void) | null;
    constructor({ container, initialViewState, controllerOptions, onLoad }: DeckGLMapParams);
    private readonly handleContextMenu;
    getViewState(): DeckGLViewState;
    /** deck.gl のネイティブズーム（512px ワールド基準）。 */
    getZoom(): number;
    setViewState(next: Partial<DeckGLViewState>, transition?: {
        durationMillis: number;
    }): void;
    private applyViewState;
    /**
     * ジェスチャ設定を差し替える。
     *
     * **`setProps({ controller })` だけでは効かない。** deck.gl はその値を
     * `views[0].props.controller` へ書き戻すだけで、`ViewManager` はビューの差分が
     * 無ければコントローラを作り直さない。同じ `MapView` を使い回していると
     * 「`dragPan` を切ったのに地図が動く」ことになるので、毎回新しい `MapView` を渡す。
     */
    setControllerOptions(next: Partial<DeckGLControllerOptions>): void;
    private buildView;
    /**
     * コアの `DefaultMarkerEventController` が「掴む前の値へ戻す」ために読む面。
     * **無条件に `enable()` しないこと**——パンを切ってある地図が動くようになる。
     */
    readonly dragPan: {
        isEnabled: () => boolean;
        enable: () => void;
        disable: () => void;
    };
    /**
     * 現在の描画に使われているビューポート。
     *
     * 遷移中は `deck.getViewports()` が補間後の値を返すので、そちらを優先する。
     * `viewState` から組み直すと、アニメーション中だけ吹き出しやマーカーアニメが
     * 地図から 1 フレームぶんずれる。
     */
    get viewport(): WebMercatorViewport;
    getSize(): {
        width: number;
        height: number;
    };
    project(position: GeoPointInterface): Offset;
    unproject(offset: Offset): GeoPoint;
    /** コアのドラッグ処理が「マーカーレイヤーが載っているか」を見るための面。 */
    getLayer(id: string): unknown;
    /**
     * ポインタ入力を受ける面。コアの `DefaultMarkerEventController` が
     * `addEventListener` / `getBoundingClientRect` / `setPointerCapture` に使う。
     *
     * **deck.gl 自身がイベントを取っている canvas でなければならない。** マーカーを
     * 掴んだあとの `setPointerCapture` は以後のポインタイベントを捕捉先の要素へ
     * 集める。別の要素（コンテナなど）を捕捉先にすると deck.gl 側は `pointerup` を
     * 受け取れず、ジェスチャ認識が掴んだままになって**離したあと地図をパンできなく
     * なる**（実際に踏んだ）。
     *
     * canvas は GPU デバイスの生成が終わるまで `null` なので、これを使う側は
     * `onLoad` のあとで初期化すること（{@link DeckGLMapViewController.notifyLoaded}）。
     */
    getCanvas(): HTMLCanvasElement;
    destroy(): void;
}

interface DeckGLMapViewProps extends MapViewBaseProps<DeckGLMapViewStateInterface> {
    maxZoom?: number;
    minZoom?: number;
    /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
    restrictBounds?: GeoRectBounds;
    className?: string;
    containerStyle?: CSSProperties;
    options?: Partial<DeckGLControllerOptions>;
    onError?: (error: Error) => void;
    children?: ReactNode;
    markerTilingOptions?: MarkerTilingOptions;
}
declare function DeckGLMapView({ state, mapStyle, onStyleDiagnostics, onMapLoaded, onMapClick, onMapLongClick, onCameraMoveStart, onCameraMove, onCameraMoveEnd, maxZoom, minZoom, restrictBounds, cameraRestriction, className, containerStyle, options, onError, children, markerTilingOptions, }: DeckGLMapViewProps): react.JSX.Element;

/**
 * 投影の唯一の注入点。**投影をここ以外に書かないこと。**
 *
 * コアの InfoBubble・マーカーアニメーション・タイル方式マーカーの当たり判定・
 * `buildVisibleRegion` は、すべてここを通して画面座標を得る。deck.gl は
 * `WebMercatorViewport` が bearing / pitch を含めて正確に投影するので、
 * Leaflet ドライバーのような CSS 変換の合成は要らない。
 */
declare class DeckGLMapViewHolder extends MapViewHolderBase<HTMLElement, DeckGLMap> {
    readonly mapView: HTMLElement;
    readonly map: DeckGLMap;
    constructor(mapView: HTMLElement, map: DeckGLMap);
    toScreenOffset(position: GeoPointInterface): Offset;
    fromScreenOffsetSync(offset: Offset): GeoPoint;
}

/**
 * deck.gl 側のマーカーの「実体」。
 *
 * deck.gl には `maplibregl.Marker` のような 1 個ずつのオブジェクトが無く、
 * マーカーは 1 枚の `IconLayer` のデータ行になる。エンティティにはその行を持たせ、
 * レンダラが行の集合からレイヤーを組み直す。
 */
interface DeckGLActualMarker {
    readonly id: string;
    position: GeoPoint;
    bitmapIcon: BitmapIcon;
    zIndex: number;
    visible: boolean;
}
/**
 * 全マーカーを 1 枚の `IconLayer` で描く。
 *
 * 1 マーカー 1 レイヤーにすると deck.gl のレイヤー差分と描画コールがマーカー数だけ
 * 増える。MapLibre ドライバーが 1 枚のシンボルレイヤーに集約しているのと同じ理由。
 */
declare class DeckGLMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<DeckGLMapViewHolder, DeckGLActualMarker> {
    readonly markerLayer: {
        layerId: string;
    };
    private readonly entries;
    private redrawScheduled;
    constructor(holder: DeckGLMapViewHolder);
    onAdd(data: AddParams[]): Promise<(DeckGLActualMarker | null)[]>;
    onChange(data: ChangeParams<DeckGLActualMarker>[]): Promise<(DeckGLActualMarker | null)[]>;
    onRemove(data: MarkerEntity<DeckGLActualMarker>[]): Promise<void>;
    onPostProcess(): Promise<void>;
    setMarkerPosition(entity: MarkerEntity<DeckGLActualMarker>, position: GeoPoint): void;
    setMarkerVisible(entity: MarkerEntity<DeckGLActualMarker>, visible: boolean): void;
    /** 表示中（タイル化されていない）マーカーの行。当たり判定と傾き対応で読む。 */
    allEntries(): DeckGLActualMarker[];
    clearEntries(): void;
    /**
     * レイヤーを組み直す。1 フレームに 1 回へまとめる。
     *
     * `composition` は 1 回で数百件を追加するので、行ごとに組み直すと
     * その回数だけ deck.gl のアトリビュート再計算が走る。
     */
    redraw(): void;
    private rebuild;
}

declare class DeckGLMarkerController extends AbstractMarkerController<DeckGLActualMarker> {
    private readonly tilingOptions;
    readonly renderer: DeckGLMarkerOverlayRenderer;
    private selected;
    private readonly zoomConverter;
    private tileRenderer;
    private tileRouteId;
    private tileVersion;
    private tileGeneration;
    /** タイル方式マーカーの overlay 差し替え。ビューコントローラが繋ぐ。 */
    onRasterLayerUpdate: ((state: RasterLayerState | null) => Promise<void>) | null;
    constructor(renderer: DeckGLMarkerOverlayRenderer, tilingOptions?: MarkerTilingOptions);
    getSelectedMarker(): MarkerEntity<DeckGLActualMarker> | null;
    setSelectedMarker(entity: MarkerEntity<DeckGLActualMarker> | null): Promise<void>;
    updateSelectedPosition(position: GeoPoint): void;
    update(state: MarkerState): Promise<void>;
    find(position: GeoPoint): MarkerEntity<DeckGLActualMarker> | null;
    /**
     * アイコン画像の矩形（アンカー補正 + 入力種別ごとの許容量）で引き当てる。
     *
     * deck.gl の picking を使わない理由は 2 つ。GPU の 1 ピクセル判定はアイコンの
     * 不透明部分にきっかり当てないと拾えず、他プロバイダの「アイコンの矩形 + 許容量」と
     * 判定が食い違う。もう 1 つは、`pickable: true` にすると全マーカーぶんの
     * picking バッファを毎フレーム持つことになるため。
     */
    findWithZoom(position: GeoPoint | null, nativeZoom: number, pointerType: 'touch' | 'mouse'): MarkerEntity<DeckGLActualMarker> | null;
    /**
     * 画面座標でアイコン矩形に当たった最前面のマーカー。矩形に入っていなければ、
     * 許容量の内側で最も近いものを返す。Leaflet ドライバーの `findAtScreen` と同じ規則。
     */
    private findAtScreen;
    protected shouldTile(state: MarkerState, totalCount: number): boolean;
    protected onTiledMarkersChanged(): Promise<void>;
    private syncTiledOverlay;
    private removeTileOverlay;
    clear(): Promise<void>;
    destroy(): void;
}

/**
 * レンダラがエンティティに持たせる「実体」。
 *
 * deck.gl のレイヤーは不変オブジェクトなので、`maplibregl.Marker` のような
 * 持ち回せるハンドルが存在しない。代わりにレジストリ上の id を持ち、更新は
 * 「同じ id へ新しいレイヤーを登録し直す」形にする。
 */
interface DeckGLLayerHandle {
    readonly layerId: string;
}
declare class DeckGLCircleRenderer extends AbstractCircleOverlayRenderer<DeckGLMapViewHolder, DeckGLLayerHandle> {
    createCircle(state: CircleState): Promise<DeckGLLayerHandle>;
    updateCircleProperties({ circle: handle, current, }: {
        circle: DeckGLLayerHandle;
        current: CircleEntity<DeckGLLayerHandle>;
        prev: CircleEntity<DeckGLLayerHandle>;
    }): Promise<DeckGLLayerHandle>;
    removeCircle(entity: CircleEntity<DeckGLLayerHandle>): Promise<void>;
    private apply;
}
declare class DeckGLCircleController extends CircleController<DeckGLLayerHandle> {
    constructor(renderer: DeckGLCircleRenderer);
}
declare class DeckGLPolylineRenderer extends AbstractPolylineOverlayRenderer<DeckGLMapViewHolder, DeckGLLayerHandle> {
    createPolyline(state: PolylineState): Promise<DeckGLLayerHandle>;
    updatePolylineProperties({ polyline: handle, current, }: {
        polyline: DeckGLLayerHandle;
        current: PolylineEntity<DeckGLLayerHandle>;
        prev: PolylineEntity<DeckGLLayerHandle>;
    }): Promise<DeckGLLayerHandle>;
    removePolyline(entity: PolylineEntity<DeckGLLayerHandle>): Promise<void>;
    private apply;
}
declare class DeckGLPolylineController extends PolylineController<DeckGLLayerHandle> {
    constructor(renderer: DeckGLPolylineRenderer);
}
declare class DeckGLPolygonRenderer extends AbstractPolygonOverlayRenderer<DeckGLMapViewHolder, DeckGLLayerHandle> {
    createPolygon(state: PolygonState): Promise<DeckGLLayerHandle>;
    updatePolygonProperties({ polygon: handle, current, }: {
        polygon: DeckGLLayerHandle;
        current: PolygonEntity<DeckGLLayerHandle>;
        prev: PolygonEntity<DeckGLLayerHandle>;
    }): Promise<DeckGLLayerHandle>;
    removePolygon(entity: PolygonEntity<DeckGLLayerHandle>): Promise<void>;
    private apply;
}
declare class DeckGLPolygonController extends PolygonController<DeckGLLayerHandle> {
    constructor(renderer: DeckGLPolygonRenderer);
}
declare class DeckGLGroundImageRenderer extends AbstractGroundImageOverlayRenderer<DeckGLMapViewHolder, DeckGLLayerHandle> {
    createGroundImage(state: GroundImageState): Promise<DeckGLLayerHandle | null>;
    updateGroundImageProperties({ groundImage: handle, current, }: {
        groundImage: DeckGLLayerHandle;
        current: GroundImageEntity<DeckGLLayerHandle>;
        prev: GroundImageEntity<DeckGLLayerHandle>;
    }): Promise<DeckGLLayerHandle | null>;
    removeGroundImage(entity: GroundImageEntity<DeckGLLayerHandle>): Promise<void>;
    private apply;
}
declare class DeckGLGroundImageController extends GroundImageController<DeckGLLayerHandle> {
    constructor(renderer: DeckGLGroundImageRenderer);
}

declare class DeckGLRasterLayerRenderer {
    readonly holder: DeckGLMapViewHolder;
    constructor(holder: DeckGLMapViewHolder);
    onAdd(data: RasterLayerAddParams[]): Promise<(DeckGLLayerHandle | null)[]>;
    onChange(data: RasterLayerChangeParams<DeckGLLayerHandle>[]): Promise<(DeckGLLayerHandle | null)[]>;
    onRemove(data: RasterLayerEntity<DeckGLLayerHandle>[]): Promise<void>;
    onCameraChanged(_camera: MapCameraPosition): Promise<void>;
    onPostProcess(): Promise<void>;
    private create;
    private resolveSource;
}
declare class DeckGLRasterLayerController extends RasterLayerController<DeckGLLayerHandle> {
    /**
     * ヘッダ指定があるときだけ fetch でタイルを取る経路に切り替える。
     * userAgent はブラウザが上書きを許さないので、どのプロバイダでも web では効かない。
     */
    protected get headerSupport(): RasterHeaderSupport;
    constructor(renderer: DeckGLRasterLayerRenderer);
    composition(data: RasterLayerState[]): Promise<void>;
    update(state: RasterLayerState): Promise<void>;
    /** マーカーのタイル overlay 用。コントローラ経由で内部的に差し替える。 */
    updateInternal(state: RasterLayerState): Promise<void>;
    removeInternal(id: string): Promise<void>;
}

declare class DeckGLMapViewController extends BaseMapViewController implements MapViewControllerInterface, MarkerCapable, CircleCapable, PolylineCapable, PolygonCapable, GroundImageCapable, RasterLayerCapable {
    readonly holder: DeckGLMapViewHolder;
    private readonly markerController;
    private readonly circleController;
    private readonly polylineController;
    private readonly polygonController;
    private readonly groundImageController;
    private readonly rasterLayerController;
    private readonly map;
    /**
     * deck.gl の canvas はデバイス初期化が終わるまで存在しないので、
     * ポインタを掴むこのコントローラは `onLoad` まで作れない（{@link notifyLoaded}）。
     * それまでに来たリスナー登録はここに溜めて、生成時にまとめて流し込む。
     */
    private markerEventController;
    private readonly pendingMarkerListeners;
    private readonly zoomConverter;
    private destroyed;
    private moving;
    private idleTimer;
    /**
     * 直近にアプリが要求した tilt。**負 tilt は deck.gl 側に残らない**ので、
     * 見上げを要求されていたことはこの値でしか判別できない
     * （{@link toMapCameraPosition} 参照）。
     */
    private logicalTiltHint;
    constructor(holder: DeckGLMapViewHolder, markerController: DeckGLMarkerController, circleController: DeckGLCircleController, polylineController: DeckGLPolylineController, polygonController: DeckGLPolygonController, groundImageController: DeckGLGroundImageController, rasterLayerController: DeckGLRasterLayerController, initialTilt?: number | null);
    getMap(): DeckGLMap;
    private installListeners;
    private scheduleIdle;
    /** `Deck` の `onLoad` から呼ばれる。 */
    notifyLoaded(): void;
    private setMarkerListener;
    private applyMarkerListener;
    protected dispatchMarkerTap(position: GeoPoint): boolean;
    /**
     * **生ズームの統一ズームへの変換と bearing の符号反転を忘れない。** ズームがずれると
     * 当たり判定の許容量が実際の縮尺と食い違い、「線や円をタップしても反応しない」形で
     * 表面化する。変換はどちらも {@link toMapCameraPosition} が持つ。
     */
    getCameraPosition(): MapCameraPosition;
    /** レイアウト前（幅か高さが 0）は null。他プロバイダと同じ契約。 */
    private getVisibleRegion;
    moveCamera(position: MapCameraPosition): Promise<boolean>;
    animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean>;
    fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean>;
    /**
     * deck.gl の `dragRotate` は**回転と傾斜を 1 つのハンドラで持つ**。
     * 片方だけ切ることはできないので、両方 false のときだけ切り、
     * 片方だけ要求されたときは切れなかった側を 1 度だけ警告する。
     */
    applyUISettings(settings: MapUISettings): void;
    /**
     * deck.gl の `MapController` はネイティブに範囲制限を持つ（`maxBounds` と
     * `minZoom` / `maxZoom`）ので直接適用する。**`super` は呼ばない**——基底クラスに
     * 保持させるとカメラ停止時のクランプ補正まで走り、二重適用になる。
     */
    setCameraRestriction(restriction: CameraRestriction | null): void;
    setOnMarkerClickListener(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragStart(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDrag(listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragEnd(listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateStart(listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateEnd(listener: OnMarkerEventHandler | null): void;
    setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void;
    clearOverlays(): Promise<void>;
    destroy(): void;
}

interface DeckGLConfig extends MapConfig {
    mapDesignType: DeckGLMapDesignType;
    maxZoom?: number;
    minZoom?: number;
    /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
    restrictBounds?: GeoRectBounds;
    markerTilingOptions?: MarkerTilingOptions;
    options?: Partial<DeckGLControllerOptions>;
}
declare class DeckGLProvider extends MapProvider {
    initialize(config: DeckGLConfig): Promise<MapViewControllerInterface>;
    destroy(): void;
}

export { type DeckGLConfig, type DeckGLControllerOptions, DeckGLMap, DeckGLMapDesignType, DeckGLMapView, DeckGLMapViewController, DeckGLMapViewHolder, type DeckGLMapViewProps, DeckGLMapViewStateInterface, DeckGLProvider, type DeckGLViewState };
