import { DefaultMarkerEventController, type MarkerEventHost } from '@mapconductor/js-sdk-core';
import { DeckGLMarkerController } from './DeckGLMarkerController';
import type { DeckGLActualMarker } from './DeckGLMarkerOverlayRenderer';

/**
 * マーカーのポインタ処理。
 *
 * ドラッグの状態遷移・3px のドラッグ判定・`dragPan` の抑止と**掴む前の値への復元**は
 * すべてコアの {@link DefaultMarkerEventController} が持つ。ここに残るのは
 * deck.gl 固有のもの——いまは何も無い。
 */
export class DeckGLMarkerEventController extends DefaultMarkerEventController<DeckGLActualMarker> {
  constructor(controller: DeckGLMarkerController) {
    super(controller as unknown as MarkerEventHost<DeckGLActualMarker>);
  }
}
