import {
  LocalTileServer,
  RasterLayerController,
  RasterLayerManager,
  TileScheme,
  type MapCameraPosition,
  type RasterHeaderSupport,
  type RasterLayerAddParams,
  type RasterLayerChangeParams,
  type RasterLayerEntity,
  type RasterLayerState,
} from '@mapconductor/js-sdk-core';
import { BitmapLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import { DeckGLLayerOrder } from '../DeckGLMap';
import { DeckGLMapViewHolder } from '../DeckGLMapViewHolder';
import type { DeckGLLayerHandle } from '../vector/DeckGLVectorControllers';

type TileImage = ImageBitmap | HTMLImageElement | null;

interface LocalTileTemplate {
  routeId: string;
  tileSize: number;
  /** Cache generation embedded in SDK-owned tile URLs. */
  cacheKey: string | null;
}

/**
 * MapConductor 内製タイル（タイル方式マーカー）の URL を見分ける。
 *
 * Service Worker 経由の `/__tiles/<route>/<size>/...` と、SW が使えない環境向けの
 * `mc-local-tile://<route>/<size>/...` の 2 系統がある。どちらもネットワークには
 * 出ないので、deck.gl の既定のタイル取得ではなく `LocalTileServer` から直接読む。
 */
function parseLocalTileTemplate(template: string): LocalTileTemplate | null {
  if (template.startsWith('mc-local-tile://')) {
    const url = new URL(template);
    const parts = url.pathname.split('/').filter(Boolean);
    const tileSize = Number(parts[0]);
    return Number.isFinite(tileSize)
      ? { routeId: url.hostname, tileSize, cacheKey: parts[1] ?? null }
      : null;
  }
  const match = template.match(/^\/?__tiles\/([^/]+)\/(\d+)(?:\/([^/]+))?\//);
  return match
    ? { routeId: match[1], tileSize: Number(match[2]), cacheKey: match[3] ?? null }
    : null;
}

async function toImage(bytes: ArrayBuffer | Uint8Array | null): Promise<TileImage> {
  if (!bytes) return null;
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Blob は SharedArrayBuffer 由来のビューを受け付けないので、必ず素の
  // ArrayBuffer へ写してから渡す。
  const buffer = new ArrayBuffer(source.byteLength);
  new Uint8Array(buffer).set(source);
  // BitmapLayer blends straight-alpha colors. The browser default can
  // premultiply translucent glyph/halo pixels, darkening their edges again
  // when WebGL blends them onto the ground tile.
  return createImageBitmap(new Blob([buffer], { type: 'image/png' }), {
    premultiplyAlpha: 'none',
  });
}

async function fetchImage(
  url: string,
  headers: Record<string, string> | null,
  signal: AbortSignal | undefined,
): Promise<TileImage> {
  const response = await fetch(url, { headers: headers ?? undefined, signal });
  if (!response.ok) throw new Error(`Tile request failed: ${response.status}`);
  return createImageBitmap(await response.blob(), { premultiplyAlpha: 'none' });
}

interface TileJsonDocument {
  tiles?: string[];
  minzoom?: number;
  maxzoom?: number;
  attribution?: string;
}

export class DeckGLRasterLayerRenderer {
  constructor(readonly holder: DeckGLMapViewHolder) {}

  async onAdd(data: RasterLayerAddParams[]): Promise<(DeckGLLayerHandle | null)[]> {
    return Promise.all(data.map(({ state }) => (state.visible ? this.create(state) : null)));
  }

  async onChange(data: RasterLayerChangeParams<DeckGLLayerHandle>[]): Promise<(DeckGLLayerHandle | null)[]> {
    return Promise.all(data.map(async ({ current, prev }) => {
      this.holder.map.registry.remove(prev.layer.layerId);
      return current.state.visible ? this.create(current.state) : null;
    }));
  }

  async onRemove(data: RasterLayerEntity<DeckGLLayerHandle>[]): Promise<void> {
    for (const entity of data) this.holder.map.registry.remove(entity.layer.layerId);
  }

  async onCameraChanged(_camera: MapCameraPosition): Promise<void> {}
  async onPostProcess(): Promise<void> {}

  private async create(state: RasterLayerState): Promise<DeckGLLayerHandle | null> {
    const resolved = await this.resolveSource(state);
    if (!resolved) return null;

    const handle: DeckGLLayerHandle = { layerId: `mc-raster-${state.id}` };
    const { template, tileSize, minZoom, maxZoom, local } = resolved;
    const headers = state.extraHeaders && Object.keys(state.extraHeaders).length > 0
      ? state.extraHeaders
      : null;

    this.holder.map.registry.set(
      handle.layerId,
      new TileLayer<TileImage>({
        // TileLayer keeps decoded images in its cache by layer id. The
        // vector-style rasteriser changes only the cache key in the local URL
        // when a preset changes, so include that generation in the deck layer
        // id to force old Roads tiles out when switching to Night/Water/etc.
        id: local?.cacheKey ? `${handle.layerId}-${local.cacheKey}` : handle.layerId,
        data: local ? [] : template,
        tileSize,
        minZoom: minZoom ?? undefined,
        maxZoom: maxZoom ?? undefined,
        opacity: state.opacity,
        pickable: false,
        // 既定のタイル取得で足りるのは「素の XYZ で、ヘッダ指定が無い」場合だけ。
        // 内製タイルは LocalTileServer から、ヘッダ指定があるときは fetch から取る。
        getTileData: local || headers
          ? async ({ index, signal }) => {
            if (local) {
              const server = LocalTileServer.startServer();
              const request = { x: index.x, y: index.y, z: index.z };
              const dataUrl = server.handleFetchDataUrl(local.routeId, request);
              if (dataUrl) return loadDataUrl(dataUrl);
              // Throws on a failed render, which deck.gl reports as a failed
              // tile and retries; an empty spot arrives as a transparent tile.
              return toImage(await server.fetchTileOrThrow(local.routeId, request));
            }
            const url = template
              .replace(/\{z\}/g, String(index.z))
              .replace(/\{x\}/g, String(index.x))
              .replace(/\{y\}/g, String(index.y))
              .replace(/\{-y\}/g, String(2 ** index.z - index.y - 1));
            return fetchImage(url, headers, signal);
          }
          : null,
        renderSubLayers: props => {
          const image = props.data;
          if (!image) return null;
          const [[west, south], [east, north]] = props.tile.boundingBox;
          return new BitmapLayer({
            id: `${props.id}-bitmap`,
            image,
            bounds: [west, south, east, north],
            // Labels are already rendered at 2x resolution. Trilinear
            // filtering blends two downsampled mip levels and softens them
            // again; sample the nearest mip level with linear pixel filtering.
            textureParameters: { minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'nearest' },
            pickable: false,
          });
        },
      }),
      DeckGLLayerOrder.rasterLayer + Math.max(-9, Math.min(9, state.zIndex)),
    );
    return handle;
  }

  private async resolveSource(state: RasterLayerState): Promise<{
    template: string;
    tileSize: number;
    minZoom: number | null;
    maxZoom: number | null;
    local: LocalTileTemplate | null;
  } | null> {
    const { source } = state;
    switch (source.type) {
      case 'UrlTemplate': {
        const local = parseLocalTileTemplate(source.template);
        // TMS は y 軸が逆。deck.gl は `{-y}` を反転済みの値で置換するので、
        // テンプレートを差し替えるだけでよい。
        const template = source.scheme === TileScheme.TMS
          ? source.template.replace(/\{y\}/g, '{-y}')
          : source.template;
        return {
          template,
          tileSize: source.tileSize ?? local?.tileSize ?? 256,
          minZoom: source.minZoom ?? null,
          maxZoom: source.maxZoom ?? null,
          local,
        };
      }
      case 'ArcGisService':
        return {
          template: `${source.serviceUrl.replace(/\/+$/, '')}/tile/{z}/{y}/{x}`,
          tileSize: 256,
          minZoom: null,
          maxZoom: null,
          local: null,
        };
      case 'TileJson': {
        const response = await fetch(source.url);
        if (!response.ok) throw new Error(`Failed to load TileJSON: ${response.status}`);
        const json = await response.json() as TileJsonDocument;
        if (!json.tiles?.[0]) throw new Error('TileJSON does not contain a tile template');
        return {
          template: json.tiles[0],
          tileSize: 256,
          minZoom: json.minzoom ?? null,
          maxZoom: json.maxzoom ?? null,
          local: null,
        };
      }
    }
  }
}

function loadDataUrl(dataUrl: string): Promise<TileImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode local tile'));
    image.src = dataUrl;
  });
}

export class DeckGLRasterLayerController extends RasterLayerController<DeckGLLayerHandle> {
  /**
   * ヘッダ指定があるときだけ fetch でタイルを取る経路に切り替える。
   * userAgent はブラウザが上書きを許さないので、どのプロバイダでも web では効かない。
   */
  protected override get headerSupport(): RasterHeaderSupport {
    return { provider: 'deck.gl', extraHeaders: true };
  }

  constructor(renderer: DeckGLRasterLayerRenderer) {
    super({ rasterLayerManager: new RasterLayerManager(), renderer });
  }

  async composition(data: RasterLayerState[]): Promise<void> {
    await this.add(data);
    for (const state of data) {
      if (!state.visible) this.rasterLayerManager.removeEntity(state.id);
    }
  }

  override async update(state: RasterLayerState): Promise<void> {
    await super.update(state);
    if (!state.visible) this.rasterLayerManager.removeEntity(state.id);
  }

  /** マーカーのタイル overlay 用。コントローラ経由で内部的に差し替える。 */
  async updateInternal(state: RasterLayerState): Promise<void> { await this.upsert(state); }
  async removeInternal(id: string): Promise<void> { await this.removeById(id); }
}
