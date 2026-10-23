import {
  MapProvider,
  MarkerTilingOptions,
  type GeoRectBounds,
  type MapConfig,
  type MapViewControllerInterface,
} from '@mapconductor/js-sdk-core';
import { BitmapLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import { DeckGLLayerOrder, DeckGLMap, type DeckGLControllerOptions } from './DeckGLMap';
import { toDeckViewState } from './MapCameraPosition';
import { DeckGLMapViewController } from './DeckGLMapViewController';
import { DeckGLMapViewHolder } from './DeckGLMapViewHolder';
import type { DeckGLMapDesignType } from './DeckGLDesign';
import { DeckGLMarkerController } from './marker/DeckGLMarkerController';
import { DeckGLMarkerOverlayRenderer } from './marker/DeckGLMarkerOverlayRenderer';
import {
  DeckGLRasterLayerController,
  DeckGLRasterLayerRenderer,
} from './raster/DeckGLRasterLayer';
import {
  DeckGLCircleController,
  DeckGLCircleRenderer,
  DeckGLGroundImageController,
  DeckGLGroundImageRenderer,
  DeckGLPolygonController,
  DeckGLPolygonRenderer,
  DeckGLPolylineController,
  DeckGLPolylineRenderer,
} from './vector/DeckGLVectorControllers';
import { ZoomAltitudeConverter } from './zoom/ZoomAltitudeConverter';

const BASE_MAP_LAYER_ID = 'mc-basemap';

export interface DeckGLConfig extends MapConfig {
  mapDesignType: DeckGLMapDesignType;
  maxZoom?: number;
  minZoom?: number;
  /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
  restrictBounds?: GeoRectBounds;
  markerTilingOptions?: MarkerTilingOptions;
  options?: Partial<DeckGLControllerOptions>;
}

export class DeckGLProvider extends MapProvider {
  async initialize(config: DeckGLConfig): Promise<MapViewControllerInterface> {
    if (this.controller) return this.controller;
    const container = typeof config.container === 'string'
      ? document.getElementById(config.container)
      : config.container;
    if (!container) throw new Error('Container element not found');

    // Deck は `parent` の中に絶対配置の canvas を作る。親が static のままだと
    // canvas が祖先の座標系に載り、地図がコンテナの外へずれる。
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const converter = new ZoomAltitudeConverter();
    const initial = config.initCameraPosition;
    const latitude = initial?.position.latitude ?? 0;
    const restrict = config.restrictBounds;
    // 初期カメラも moveCamera と同じ変換を通す。ここだけ素の値を渡すと
    // 「最初は見上げにならず、1 度動かすと直る」ことになる。
    const initialViewState = initial
      ? toDeckViewState(initial)
      : { longitude: 0, latitude: 0, zoom: converter.toNativeZoom(0, 0), bearing: 0, pitch: 0 };

    let loaded = false;
    let notifyLoaded: (() => void) | null = null;

    const map = new DeckGLMap({
      container,
      initialViewState: {
        ...initialViewState,
        minZoom: config.minZoom != null ? converter.toNativeZoom(config.minZoom, latitude) : 0,
        maxZoom: config.maxZoom != null ? converter.toNativeZoom(config.maxZoom, latitude) : 20,
      },
      controllerOptions: {
        ...(restrict?.southWest && restrict.northEast
          ? {
            maxBounds: [
              [restrict.southWest.longitude, restrict.southWest.latitude],
              [restrict.northEast.longitude, restrict.northEast.latitude],
            ] as [[number, number], [number, number]],
          }
          : {}),
        ...config.options,
      },
      onLoad: () => {
        loaded = true;
        notifyLoaded?.();
      },
    });
    applyBaseMap(map, config.mapDesignType, container);

    const holder = new DeckGLMapViewHolder(container, map);
    const markerRenderer = new DeckGLMarkerOverlayRenderer(holder);
    const controller = new DeckGLMapViewController(
      holder,
      new DeckGLMarkerController(markerRenderer, config.markerTilingOptions),
      new DeckGLCircleController(new DeckGLCircleRenderer(holder)),
      new DeckGLPolylineController(new DeckGLPolylineRenderer(holder)),
      new DeckGLPolygonController(new DeckGLPolygonRenderer(holder)),
      new DeckGLGroundImageController(new DeckGLGroundImageRenderer(holder)),
      new DeckGLRasterLayerController(new DeckGLRasterLayerRenderer(holder)),
      initial?.tilt ?? null,
    );

    notifyLoaded = () => controller.notifyLoaded();
    // Deck の `onLoad` は device 初期化のあと非同期に飛ぶが、
    // 既に飛んでいた場合を取りこぼさないように 1 度確かめる。
    if (loaded) controller.notifyLoaded();

    this.controller = controller;
    return controller;
  }

  destroy(): void {
    this.controller?.destroy();
    this.controller = null;
  }
}

/**
 * ベースマップを敷く。
 *
 * deck.gl は地図を持たないので、他プロバイダの「スタイル」に当たるものを
 * ラスタタイルの `TileLayer` として自前で用意する。地の色はコンテナの背景色に
 * 置く——タイル読み込み中に下が透けるのを防ぐだけなので、レイヤーにする必要が無い。
 */
function applyBaseMap(map: DeckGLMap, design: DeckGLMapDesignType, container: HTMLElement): void {
  container.style.backgroundColor = design.backgroundColor ?? '';
  if (!design.tileUrl) {
    map.registry.remove(BASE_MAP_LAYER_ID);
    return;
  }
  map.registry.set(
    BASE_MAP_LAYER_ID,
    new TileLayer<ImageBitmap>({
      id: BASE_MAP_LAYER_ID,
      data: design.tileUrl,
      tileSize: design.tileSize,
      minZoom: design.minZoom ?? undefined,
      maxZoom: design.maxZoom ?? undefined,
      pickable: false,
      renderSubLayers: props => {
        const image = props.data;
        if (!image) return null;
        const [[west, south], [east, north]] = props.tile.boundingBox;
        return new BitmapLayer({
          id: `${props.id}-bitmap`,
          image,
          bounds: [west, south, east, north],
          pickable: false,
        });
      },
    }),
    DeckGLLayerOrder.baseMap,
  );
}
