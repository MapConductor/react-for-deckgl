import {
  Deck,
  FlyToInterpolator,
  MapView,
  WebMercatorViewport,
  type Layer,
  type LayersList,
  type MapViewState,
  type PickingInfo,
} from '@deck.gl/core';
import { createGeoPoint, type GeoPoint, type GeoPointInterface, type Offset } from '@mapconductor/js-sdk-core';
import { nearestCopyLongitude } from './helpers';

/**
 * レイヤーの重なり順。deck.gl は配列の**後ろほど手前**に描くので、
 * この数値の昇順に並べる。Leaflet ドライバーの pane の z-index に対応させてある。
 */
export const DeckGLLayerOrder = {
  baseMap: 0,
  rasterLayer: 250,
  groundImage: 300,
  polygon: 400,
  circle: 420,
  polyline: 440,
  marker: 600,
} as const;

/** deck.gl のネイティブなカメラ表現。**ズームは 512px ワールド基準**（統一ズーム − 1）。 */
export interface DeckGLViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
  minZoom?: number;
  maxZoom?: number;
}

/** `MapController` に渡すジェスチャ設定のうち、このドライバーが触るもの。 */
export interface DeckGLControllerOptions {
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

const DEFAULT_CONTROLLER_OPTIONS: DeckGLControllerOptions = {
  dragPan: true,
  dragRotate: true,
  scrollZoom: true,
  doubleClickZoom: true,
  touchZoom: true,
  touchRotate: true,
  keyboard: true,
  inertia: 300,
  maxBounds: null,
};

interface LayerSlot {
  layer: Layer | null;
  order: number;
  /** 同じ order 内の安定順。登録順を保つ。 */
  seq: number;
}

/**
 * deck.gl のレイヤー配列を「id で差し替えられる集合」として持つ。
 *
 * deck.gl のレイヤーは不変オブジェクトで、更新は「同じ id の新しいインスタンスを
 * 渡し直す」形になる。Leaflet の `layer.addTo(map)` / `layer.remove()` に相当する
 * 差分適用点をここ 1 か所に閉じ込め、各レンダラは id とレイヤーだけを扱う。
 */
export class DeckGLLayerRegistry {
  private readonly slots = new Map<string, LayerSlot>();
  private seq = 0;
  private listener: ((layers: LayersList) => void) | null = null;
  private flushScheduled = false;

  setChangeListener(listener: ((layers: LayersList) => void) | null): void {
    this.listener = listener;
  }

  set(id: string, layer: Layer | null, order: number): void {
    const existing = this.slots.get(id);
    this.slots.set(id, { layer, order, seq: existing?.seq ?? this.seq++ });
    this.scheduleFlush();
  }

  remove(id: string): void {
    if (!this.slots.delete(id)) return;
    this.scheduleFlush();
  }

  get(id: string): Layer | null | undefined {
    return this.slots.get(id)?.layer;
  }

  has(id: string): boolean {
    return this.slots.has(id);
  }

  layers(): LayersList {
    return Array.from(this.slots.values())
      .sort((a, b) => (a.order - b.order) || (a.seq - b.seq))
      .map(slot => slot.layer)
      .filter((layer): layer is Layer => layer != null);
  }

  clear(): void {
    this.slots.clear();
    this.scheduleFlush();
  }

  /**
   * 1 フレームぶんの登録をまとめて 1 回の `setProps` にする。
   *
   * `composition` は数百件のレイヤーを続けて登録するので、逐次 `setProps` すると
   * その回数だけ deck.gl のレイヤーマッチングが走る。
   */
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.listener?.(this.layers());
    });
  }

  /** 待たずに今すぐ反映する。破棄前など、マイクロタスクが回らない場面用。 */
  flushNow(): void {
    this.flushScheduled = false;
    this.listener?.(this.layers());
  }
}

export interface DeckGLMapParams {
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
export class DeckGLMap {
  readonly registry = new DeckGLLayerRegistry();
  readonly deck: Deck<MapView>;

  private readonly container: HTMLElement;
  private viewState: DeckGLViewState;
  private controllerOptions: DeckGLControllerOptions;
  private destroyed = false;

  /** SDK 側のイベント。ドライバーがコアの受け口へ転送する。 */
  onViewStateChanged: ((viewState: DeckGLViewState, interacting: boolean) => void) | null = null;
  onClick: ((info: PickingInfo) => void) | null = null;
  onLongClick: ((offset: Offset) => void) | null = null;

  constructor({ container, initialViewState, controllerOptions, onLoad }: DeckGLMapParams) {
    this.container = container;
    this.viewState = { ...initialViewState };
    this.controllerOptions = { ...DEFAULT_CONTROLLER_OPTIONS, ...controllerOptions };

    this.deck = new Deck<MapView>({
      parent: container as HTMLDivElement,
      views: this.buildView(),
      // カメラは MapConductor の state が持つので controlled にする。
      viewState: this.viewState as MapViewState,
      layers: [],
      // Match the CSS layout to the current screen density, including browser
      // zoom. ResizeObserver's physical pixel box can report a different ratio.
      deviceProps: { createCanvasContext: { pixelSizeSource: 'css-dpr' } },
      style: { position: 'absolute', inset: '0' },
      onViewStateChange: ({ viewState, interactionState }) => {
        const next = viewState as DeckGLViewState;
        this.viewState = {
          longitude: next.longitude,
          latitude: next.latitude,
          zoom: next.zoom,
          bearing: next.bearing ?? 0,
          pitch: next.pitch ?? 0,
          minZoom: this.viewState.minZoom,
          maxZoom: this.viewState.maxZoom,
        };
        // 遷移中の値をそのまま返すと `TransitionManager` が「自分が出した値だ」と
        // 判定して遷移を続ける。transitionDuration を付けずに返すのが要点で、
        // 付けると毎フレーム新しい遷移が始まって animateCamera が終わらない。
        this.applyViewState();
        const interacting = Boolean(
          interactionState.isDragging ||
          interactionState.isPanning ||
          interactionState.isZooming ||
          interactionState.isRotating ||
          interactionState.inTransition,
        );
        this.onViewStateChanged?.(this.viewState, interacting);
      },
      onClick: info => this.onClick?.(info),
      onLoad: () => onLoad?.(),
    });

    this.registry.setChangeListener(layers => {
      if (this.destroyed) return;
      this.deck.setProps({ layers });
    });

    container.addEventListener('contextmenu', this.handleContextMenu);
  }

  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const rect = this.container.getBoundingClientRect();
    this.onLongClick?.({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  // -- カメラ -----------------------------------------------------------------

  getViewState(): DeckGLViewState {
    return this.viewState;
  }

  /** deck.gl のネイティブズーム（512px ワールド基準）。 */
  getZoom(): number {
    return this.viewState.zoom;
  }

  setViewState(next: Partial<DeckGLViewState>, transition?: { durationMillis: number }): void {
    this.viewState = { ...this.viewState, ...next };
    this.applyViewState(transition);
  }

  private applyViewState(transition?: { durationMillis: number }): void {
    if (this.destroyed) return;
    this.deck.setProps({
      viewState: (transition
        ? {
          ...this.viewState,
          transitionDuration: transition.durationMillis,
          transitionInterpolator: new FlyToInterpolator(),
        }
        : this.viewState) as MapViewState,
    });
  }

  /**
   * ジェスチャ設定を差し替える。
   *
   * **`setProps({ controller })` だけでは効かない。** deck.gl はその値を
   * `views[0].props.controller` へ書き戻すだけで、`ViewManager` はビューの差分が
   * 無ければコントローラを作り直さない。同じ `MapView` を使い回していると
   * 「`dragPan` を切ったのに地図が動く」ことになるので、毎回新しい `MapView` を渡す。
   */
  setControllerOptions(next: Partial<DeckGLControllerOptions>): void {
    if (this.destroyed) return;
    this.controllerOptions = { ...this.controllerOptions, ...next };
    this.deck.setProps({ views: this.buildView() });
  }

  private buildView(): MapView {
    // repeat: 低ズームで世界を複数枚描く。日付変更線をまたいだ表示が途切れない。
    return new MapView({
      id: 'mc-map',
      repeat: true,
      controller: { ...this.controllerOptions },
    });
  }

  /**
   * コアの `DefaultMarkerEventController` が「掴む前の値へ戻す」ために読む面。
   * **無条件に `enable()` しないこと**——パンを切ってある地図が動くようになる。
   */
  readonly dragPan = {
    isEnabled: (): boolean => this.controllerOptions.dragPan,
    enable: (): void => this.setControllerOptions({ dragPan: true }),
    disable: (): void => this.setControllerOptions({ dragPan: false }),
  };

  // -- 投影 -------------------------------------------------------------------

  /**
   * 現在の描画に使われているビューポート。
   *
   * 遷移中は `deck.getViewports()` が補間後の値を返すので、そちらを優先する。
   * `viewState` から組み直すと、アニメーション中だけ吹き出しやマーカーアニメが
   * 地図から 1 フレームぶんずれる。
   */
  get viewport(): WebMercatorViewport {
    const live = this.deck.isInitialized ? this.deck.getViewports()[0] : null;
    if (live instanceof WebMercatorViewport) return live;
    const { width, height } = this.getSize();
    return new WebMercatorViewport({ ...this.viewState, width, height });
  }

  getSize(): { width: number; height: number } {
    const width = this.deck.width || this.container.clientWidth || 1;
    const height = this.deck.height || this.container.clientHeight || 1;
    return { width, height };
  }

  project(position: GeoPointInterface): Offset {
    const viewport = this.viewport;
    const longitude = nearestCopyLongitude(position.longitude, viewport.longitude);
    const [x, y] = viewport.project([longitude, position.latitude]);
    return { x, y };
  }

  unproject(offset: Offset): GeoPoint {
    const [longitude, latitude] = this.viewport.unproject([offset.x, offset.y]);
    return createGeoPoint({ latitude, longitude });
  }

  // -- レイヤー ----------------------------------------------------------------

  /** コアのドラッグ処理が「マーカーレイヤーが載っているか」を見るための面。 */
  getLayer(id: string): unknown {
    return this.registry.get(id) ?? undefined;
  }

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
  getCanvas(): HTMLCanvasElement {
    return this.deck.getCanvas() ?? (this.container as unknown as HTMLCanvasElement);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.registry.setChangeListener(null);
    this.registry.clear();
    this.container.removeEventListener('contextmenu', this.handleContextMenu);
    this.onViewStateChanged = null;
    this.onClick = null;
    this.onLongClick = null;
    this.deck.finalize();
  }
}
