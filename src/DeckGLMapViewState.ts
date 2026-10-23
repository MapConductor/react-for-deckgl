import { useState } from 'react';
import {
  MapCameraPosition as MapCameraPositionNS,
  MapViewState,
  createRandomId,
  type MapCameraPosition,
  type MapViewControllerInterface,
  type MapViewStateInterface,
} from '@mapconductor/js-sdk-core';
import { DeckGLDesign, type DeckGLMapDesignType } from './DeckGLDesign';

export interface DeckGLMapViewStateInterface
  extends MapViewStateInterface<DeckGLMapDesignType> {}

export interface DeckGLMapViewStateParams {
  id?: string;
  mapDesignType?: DeckGLMapDesignType;
  cameraPosition?: MapCameraPosition;
}

/**
 * 残るのは 3 つだけ——`mapDesignType`・ホルダーの型・接続時の扱い。
 * カメラの保持・`moveCameraTo`・`fitBounds`・`uiSettings` はコアの
 * `MapViewState` が持つ。
 */
export class DeckGLMapViewState
  extends MapViewState<DeckGLMapDesignType>
  implements DeckGLMapViewStateInterface {
  private _mapDesignType: DeckGLMapDesignType;

  constructor({
    id = createRandomId(),
    mapDesignType = DeckGLDesign.Standard,
    cameraPosition = MapCameraPositionNS.Default,
  }: DeckGLMapViewStateParams = {}) {
    super({ id, cameraPosition });
    this._mapDesignType = mapDesignType;
  }

  override get mapDesignType(): DeckGLMapDesignType {
    return this._mapDesignType;
  }

  override set mapDesignType(value: DeckGLMapDesignType) {
    this._mapDesignType = value;
  }

  /** 接続時にカメラを動かさない。初期位置は `Deck` の生成時に渡してある。 */
  override setController(controller: MapViewControllerInterface | null): void {
    this.attachController(controller, false);
  }
}

export function useDeckGLMapViewState(
  params: DeckGLMapViewStateParams = {},
): DeckGLMapViewStateInterface {
  const [state] = useState(() => new DeckGLMapViewState(params));
  return state;
}
