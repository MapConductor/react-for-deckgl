import type { AttributionRule, MapDesignTypeInterface } from '@mapconductor/js-sdk-core';

/**
 * deck.gl のベースマップ指定。
 *
 * deck.gl は「レイヤーを描く」ライブラリで、地図そのものは持たない。ベースマップは
 * このドライバーが `TileLayer` + `BitmapLayer` でラスタタイルとして敷く。
 * したがってデザイン = タイル URL テンプレート、という Leaflet と同じ形になる。
 */
export interface DeckGLMapDesignType extends MapDesignTypeInterface<string> {
  /** `{z}/{x}/{y}` を含むテンプレート。`null` ならベースマップを敷かない。 */
  readonly tileUrl: string | null;
  readonly tileSize: number;
  readonly minZoom: number | null;
  readonly maxZoom: number | null;
  /** タイルの下に敷く色。タイル読み込み中に地の色が透けるのを防ぐ。 */
  readonly backgroundColor: string | null;
}

export interface DeckGLDesignParams {
  id: string;
  tileUrl: string | null;
  tileSize?: number;
  minZoom?: number | null;
  maxZoom?: number | null;
  backgroundColor?: string | null;
  attributionRules?: readonly AttributionRule[];
}

export class DeckGLDesign implements DeckGLMapDesignType {
  readonly id: string;
  readonly tileUrl: string | null;
  readonly tileSize: number;
  readonly minZoom: number | null;
  readonly maxZoom: number | null;
  readonly backgroundColor: string | null;
  readonly attributionRules: readonly AttributionRule[];

  constructor({
    id,
    tileUrl,
    tileSize = 256,
    minZoom = null,
    maxZoom = null,
    backgroundColor = null,
    attributionRules = [],
  }: DeckGLDesignParams) {
    this.id = id;
    this.tileUrl = tileUrl;
    this.tileSize = tileSize;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.backgroundColor = backgroundColor;
    this.attributionRules = attributionRules;
  }

  /**
   * 「同じ見た目か」の比較に使われる値。**id だけを返さないこと。**
   * 同じ id で URL 違いのデザインへ差し替えたときに再読み込みが走らなくなる。
   */
  getValue(): string {
    return `deckgl_id=${this.id},tiles=${this.tileUrl ?? ''},size=${this.tileSize}`;
  }

  static readonly Standard = new DeckGLDesign({
    id: 'standard',
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    backgroundColor: '#f2efe9',
    attributionRules: [{
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }],
  });

  static readonly Satellite = new DeckGLDesign({
    id: 'satellite',
    tileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    backgroundColor: '#0b1a2b',
    attributionRules: [{
      attribution: 'Powered by <a href="https://www.esri.com/">Esri</a> — Source: Esri, Maxar, Earthstar Geographics',
    }],
  });

  static readonly Dark = new DeckGLDesign({
    id: 'dark',
    tileUrl: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    maxZoom: 20,
    backgroundColor: '#12191f',
    attributionRules: [{
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }],
  });

  static readonly Light = new DeckGLDesign({
    id: 'light',
    tileUrl: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    maxZoom: 20,
    backgroundColor: '#f7f7f5',
    attributionRules: [{
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }],
  });

  /** ベースマップ無し。deck.gl のレイヤーだけを見せたいとき。 */
  static readonly None = new DeckGLDesign({
    id: 'none',
    tileUrl: null,
    backgroundColor: '#0f1115',
  });
}
