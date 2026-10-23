import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  InfoBubbleOverlay,
  MapAttributionOverlay,
  MapContext,
  MapServiceRegistryProvider,
  MapViewScope,
  MapViewScopeProvider,
  MarkerAnimationLayer,
  createMapContextValue,
  type InfoBubbleEntry,
} from '@mapconductor/js-sdk-react';
import {
  useMapViewStyle,
  useCameraRestriction,
  useMapUISettings,
  useMarkerRenderingSupport,
} from '@mapconductor/js-sdk-react/internal';
import {
  MarkerTilingOptions,
  mapViewStateInternal,
  type GeoPoint,
  type GeoRectBounds,
  type MapCameraPosition,
  type MapViewBaseProps,
  type MarkerAnimationOverlayEntry,
  type OverlayCollector,
  markerIconExtentPx,
} from '@mapconductor/js-sdk-core';
import type { DeckGLControllerOptions } from './DeckGLMap';
import { DeckGLProvider, type DeckGLConfig } from './DeckGLProvider';
import type { DeckGLMapViewController } from './DeckGLMapViewController';
import type { DeckGLMapViewStateInterface } from './DeckGLMapViewState';

export interface DeckGLMapViewProps extends MapViewBaseProps<DeckGLMapViewStateInterface> {
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

export function DeckGLMapView({
  state,
  mapStyle,
  onStyleDiagnostics,
  onMapLoaded,
  onMapClick,
  onMapLongClick,
  onCameraMoveStart,
  onCameraMove,
  onCameraMoveEnd,
  maxZoom,
  minZoom,
  restrictBounds,
  cameraRestriction,
  className,
  containerStyle,
  options,
  onError,
  children,
  markerTilingOptions,
}: DeckGLMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [provider] = useState(() => new DeckGLProvider());
  const [scope] = useState(() => new MapViewScope());
  const [controller, setController] = useState<DeckGLMapViewController | null>(null);

  // 地図の見た目。何が起きるかはこのバックエンドが宣言した能力で決まるので、
  // ここにプロバイダ固有の分岐は無い。
  useMapViewStyle(state, controller, mapStyle, onStyleDiagnostics);
  const [isReady, setIsReady] = useState(false);
  // `onMapLoaded` と同じ瞬間を「値」として持つ。イベントを取り逃した後から
  // マウントした子も読めるようにするため。
  const [isLoaded, setIsLoaded] = useState(false);
  const typedControllerRef = useRef<DeckGLMapViewController | null>(null);
  const bridgeUnsubs = useRef<(() => void)[]>([]);
  const [bubbleEntries, setBubbleEntries] = useState<InfoBubbleEntry[]>([]);
  const [animationEntries, setAnimationEntries] = useState<MarkerAnimationOverlayEntry[]>([]);
  const [, setCameraTick] = useState(0);

  const onMapLoadedRef = useRef(onMapLoaded);
  const onMapClickRef = useRef(onMapClick);
  const onMapLongClickRef = useRef(onMapLongClick);
  const onCameraMoveStartRef = useRef(onCameraMoveStart);
  const onCameraMoveRef = useRef(onCameraMove);
  const onCameraMoveEndRef = useRef(onCameraMoveEnd);
  const onErrorRef = useRef(onError);
  onMapLoadedRef.current = onMapLoaded;
  onMapClickRef.current = onMapClick;
  onMapLongClickRef.current = onMapLongClick;
  onCameraMoveStartRef.current = onCameraMoveStart;
  onCameraMoveRef.current = onCameraMove;
  onCameraMoveEndRef.current = onCameraMoveEnd;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    setIsReady(false);
    setIsLoaded(false);

    const config: DeckGLConfig = {
      container: containerRef.current,
      initCameraPosition: state.cameraPosition,
      mapDesignType: state.mapDesignType,
      maxZoom,
      minZoom,
      restrictBounds,
      markerTilingOptions,
      options,
    };

    provider.initialize(config).then(rawController => {
      if (cancelled) return;
      const ctrl = rawController as DeckGLMapViewController;
      typedControllerRef.current = ctrl;
      mapViewStateInternal(state).setController(ctrl);
      mapViewStateInternal(state).setCameraPositionChangeListener(() => {
        setCameraTick(tick => tick + 1);
      });
      setController(ctrl);

      ctrl.setCameraMoveStartListener((camera: MapCameraPosition) => {
        mapViewStateInternal(state).updateCameraPosition(camera);
        onCameraMoveStartRef.current?.(camera);
      });
      ctrl.setCameraMoveListener((camera: MapCameraPosition) => {
        mapViewStateInternal(state).updateCameraPosition(camera);
        onCameraMoveRef.current?.(camera);
        setCameraTick(tick => tick + 1);
      });
      ctrl.setCameraMoveEndListener((camera: MapCameraPosition) => {
        mapViewStateInternal(state).updateCameraPosition(camera);
        onCameraMoveEndRef.current?.(camera);
        setCameraTick(tick => tick + 1);
      });
      ctrl.setMapClickListener((point: GeoPoint) => onMapClickRef.current?.(point));
      ctrl.setMapLongClickListener((point: GeoPoint) => onMapLongClickRef.current?.(point));
      ctrl.setMapInitializedListener(() => {
        // 地図が出来た時点の実カメラ（visibleRegion 込み）を state へ流し込む。
        // これで `mapViewState.cameraPosition` が最初から権威ある値になり、
        // 拡張モジュールが初回から `visibleRegion.bounds` を読める。
        const initial = typedControllerRef.current?.getCameraPosition() ?? null;
        if (initial) mapViewStateInternal(state).updateCameraPosition(initial);
        setIsLoaded(true);
        onMapLoadedRef.current?.(state);
      });

      const registry = scope.buildRegistry();
      for (const overlay of registry.getAll()) {
        bridgeUnsubs.current.push(overlay.subscribe(data => {
          overlay.render(data, ctrl).catch(console.error);
        }));
      }

      bridgeUnsubs.current.push(scope.bubbleCollector.subscribe(entries => {
        setBubbleEntries(Array.from(entries.values()));
      }));

      ctrl.setMarkerAnimationOverlayHost(scope.markerAnimationStore.start);
      bridgeUnsubs.current.push(() => ctrl.setMarkerAnimationOverlayHost(null));
      bridgeUnsubs.current.push(scope.markerAnimationStore.subscribe(setAnimationEntries));

      const capable = ctrl as unknown as Record<string, (state: never) => unknown>;
      const setupUpdateHandler = <S extends { id: string }>(
        collector: OverlayCollector<S>,
        hasMethod: string,
        updateMethod: string,
        onUpdated?: () => void,
      ) => {
        collector.setUpdateHandler(nextState => {
          if ((capable[hasMethod] as (value: S) => boolean)?.(nextState)) {
            void (capable[updateMethod] as (value: S) => Promise<void>)?.(nextState);
            onUpdated?.();
          }
        });
        bridgeUnsubs.current.push(() => collector.setUpdateHandler(null));
      };

      setupUpdateHandler(scope.markerCollector, 'hasMarker', 'updateMarker', () => {
        setCameraTick(tick => tick + 1);
      });
      setupUpdateHandler(scope.circleCollector, 'hasCircle', 'updateCircle');
      setupUpdateHandler(scope.polylineCollector, 'hasPolyline', 'updatePolyline');
      setupUpdateHandler(scope.polygonCollector, 'hasPolygon', 'updatePolygon');
      setupUpdateHandler(scope.groundImageCollector, 'hasGroundImage', 'updateGroundImage');
      setupUpdateHandler(scope.rasterLayerCollector, 'hasRasterLayer', 'updateRasterLayer');
      setIsReady(true);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      console.error('Failed to initialize deck.gl:', error);
      onErrorRef.current?.(error);
    });

    return () => {
      cancelled = true;
      mapViewStateInternal(state).setCameraPositionChangeListener(null);
      mapViewStateInternal(state).setController(null);
      typedControllerRef.current = null;
      bridgeUnsubs.current.forEach(unsubscribe => unsubscribe());
      bridgeUnsubs.current = [];
      provider.destroy();
    };
  }, [
    markerTilingOptions,
    maxZoom,
    minZoom,
    options,
    provider,
    scope,
    state,
    state.mapDesignType.id,
  ]);

  useMapUISettings(state, controller);
  // マップ生成時 config だけでなく、prop の変化にも追随させる（android-sdk 相当）。
  useCameraRestriction(controller, { cameraRestriction, restrictBounds, minZoom, maxZoom });

  // マーカー描画 capability をこのマップのサービスレジストリへ登録する。
  useMarkerRenderingSupport(state, scope, controller);

  return (
    <MapContext.Provider value={createMapContextValue({ controller, isReady, isLoaded, state })}>
      <div
        ref={containerRef}
        className={className}
        style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', ...containerStyle }}
      >
        <MapAttributionOverlay
          scope={scope}
          camera={state.cameraPosition}
          designAttributionRules={state.mapDesignType.attributionRules}
        />
        {animationEntries.length > 0 && typedControllerRef.current && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 650, pointerEvents: 'none' }}>
            <MarkerAnimationLayer
              entries={animationEntries}
              resolveScreenOffset={entry => typedControllerRef.current!.holder.toScreenOffset(entry.state.position)}
            />
          </div>
        )}
        {bubbleEntries.length > 0 && typedControllerRef.current && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 750, pointerEvents: 'none', overflow: 'hidden' }}>
            {bubbleEntries.map(entry => {
              const positionOffset = typedControllerRef.current!.holder.toScreenOffset(entry.positionProvider());
              const icon = entry.icon;
              const iconPixelSize = markerIconExtentPx(icon);
              return (
                <InfoBubbleOverlay
                  key={entry.id}
                  positionOffset={positionOffset}
                  iconSize={iconPixelSize}
                  iconOffset={icon ? icon.anchor : { x: 0.5, y: 0.5 }}
                  infoAnchorOffset={icon ? icon.infoAnchor : { x: 0.5, y: 0.5 }}
                  tailOffset={entry.tailOffset}
                  style={{ pointerEvents: 'auto' }}
                >
                  {entry.content as ReactNode}
                </InfoBubbleOverlay>
              );
            })}
          </div>
        )}
      </div>
      <MapServiceRegistryProvider registry={state.serviceRegistry}>
        <MapViewScopeProvider scope={scope}>{children}</MapViewScopeProvider>
      </MapServiceRegistryProvider>
    </MapContext.Provider>
  );
}
