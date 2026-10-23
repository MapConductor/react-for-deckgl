import {
  AbstractMarkerOverlayRenderer,
  type AddParams,
  type BitmapIcon,
  type ChangeParams,
  type GeoPoint,
  type MarkerEntity,
} from '@mapconductor/js-sdk-core';
import { IconLayer } from '@deck.gl/layers';
import { DeckGLLayerOrder } from '../DeckGLMap';
import { DeckGLMapViewHolder } from '../DeckGLMapViewHolder';

/** マーカーレイヤーの id。ドラッグ処理が「レイヤーが載っているか」を見るのに使う。 */
export const DECKGL_MARKER_LAYER_ID = 'mc-markers';

/**
 * deck.gl 側のマーカーの「実体」。
 *
 * deck.gl には `maplibregl.Marker` のような 1 個ずつのオブジェクトが無く、
 * マーカーは 1 枚の `IconLayer` のデータ行になる。エンティティにはその行を持たせ、
 * レンダラが行の集合からレイヤーを組み直す。
 */
export interface DeckGLActualMarker {
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
export class DeckGLMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<
  DeckGLMapViewHolder,
  DeckGLActualMarker
> {
  readonly markerLayer = { layerId: DECKGL_MARKER_LAYER_ID };

  private readonly entries = new Map<string, DeckGLActualMarker>();
  private redrawScheduled = false;

  constructor(holder: DeckGLMapViewHolder) {
    super({ holder });
    // マーカーは非表示にできるので、Drop / Bounce は画面座標のオーバーレイに委ねる。
    // 地理座標を補間すると、傾け・回転させた地図で動く向きが狂う。
    this.supportsAnimationOverlay = true;
  }

  async onAdd(data: AddParams[]): Promise<(DeckGLActualMarker | null)[]> {
    return data.map(({ state, bitmapIcon }) => {
      const actual: DeckGLActualMarker = {
        id: state.id,
        position: state.position,
        bitmapIcon,
        zIndex: state.zIndex ?? 0,
        visible: true,
      };
      this.entries.set(state.id, actual);
      return actual;
    });
  }

  async onChange(data: ChangeParams<DeckGLActualMarker>[]): Promise<(DeckGLActualMarker | null)[]> {
    return data.map(({ current, prev, bitmapIcon }) => {
      const actual = prev.marker;
      if (!actual) return null;
      actual.position = current.state.position;
      actual.bitmapIcon = bitmapIcon;
      actual.zIndex = current.state.zIndex ?? 0;
      this.entries.set(actual.id, actual);
      return actual;
    });
  }

  async onRemove(data: MarkerEntity<DeckGLActualMarker>[]): Promise<void> {
    for (const entity of data) {
      if (entity.marker) this.entries.delete(entity.marker.id);
    }
    this.redraw();
  }

  async onPostProcess(): Promise<void> {
    this.redraw();
  }

  setMarkerPosition(entity: MarkerEntity<DeckGLActualMarker>, position: GeoPoint): void {
    if (!entity.marker) return;
    entity.marker.position = position;
    this.redraw();
  }

  override setMarkerVisible(entity: MarkerEntity<DeckGLActualMarker>, visible: boolean): void {
    if (!entity.marker) return;
    entity.marker.visible = visible;
    this.redraw();
  }

  /** 表示中（タイル化されていない）マーカーの行。当たり判定と傾き対応で読む。 */
  allEntries(): DeckGLActualMarker[] {
    return Array.from(this.entries.values());
  }

  clearEntries(): void {
    this.entries.clear();
    this.redraw();
  }

  /**
   * レイヤーを組み直す。1 フレームに 1 回へまとめる。
   *
   * `composition` は 1 回で数百件を追加するので、行ごとに組み直すと
   * その回数だけ deck.gl のアトリビュート再計算が走る。
   */
  redraw(): void {
    if (this.redrawScheduled) return;
    this.redrawScheduled = true;
    queueMicrotask(() => {
      this.redrawScheduled = false;
      this.rebuild();
    });
  }

  private rebuild(): void {
    const data = this.allEntries()
      .filter(entry => entry.visible)
      // deck.gl は配列の後ろほど手前に描く。zIndex が同じなら南にあるものを後に
      // 置き、傾けた地図で手前のマーカーが奥のマーカーを隠すようにする。
      .sort((a, b) => (a.zIndex - b.zIndex) || (b.position.latitude - a.position.latitude));

    this.holder.map.registry.set(
      DECKGL_MARKER_LAYER_ID,
      new IconLayer<DeckGLActualMarker>({
        id: DECKGL_MARKER_LAYER_ID,
        data,
        getPosition: entry => [entry.position.longitude, entry.position.latitude],
        getIcon: entry => {
          const { url, size, anchor } = entry.bitmapIcon;
          return {
            // 同じ id のアイコンは 1 度しか読み込まれない。URL とサイズが同じなら
            // 同じアトラス領域を使い回す。
            id: `${url}@${size.width}x${size.height}`,
            url,
            width: size.width,
            height: size.height,
            anchorX: size.width * anchor.x,
            anchorY: size.height * anchor.y,
            mask: false,
          };
        },
        getSize: entry => entry.bitmapIcon.size.height,
        sizeUnits: 'pixels',
        sizeBasis: 'height',
        billboard: true,
        // クリックは地図タップ → コアのカスケードで解決する（他プロバイダと同じ）。
        // deck.gl の picking を使うと順序と許容量が他と揃わない。
        pickable: false,
      }),
      DeckGLLayerOrder.marker,
    );
  }
}
