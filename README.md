# @mapconductor/react-for-deckgl

deck.gl provider for the MapConductor React SDK. Renders a
[deck.gl](https://deck.gl/) scene through MapConductor's provider-independent
camera, marker, and overlay API, so the same application code can also run on
Google Maps, MapLibre, Mapbox, MapTiler, Leaflet, OpenLayers, ArcGIS, Cesium,
HERE, TomTom, Longdo, or Mappls.

## Installation

```shell
npm install @mapconductor/react-for-deckgl @mapconductor/js-sdk-core @mapconductor/js-sdk-react
```

Two entry points:

| Import | Contents |
| --- | --- |
| `@mapconductor/react-for-deckgl` | everything, including the map view — evaluates deck.gl |
| `@mapconductor/react-for-deckgl/state` | `DeckGLDesign` and the view state only — does **not** evaluate deck.gl |

See [the Longdo note](#not-compatible-with-react-for-longdo-on-the-same-page) for
why that split exists.

No API key and no stylesheet. `@deck.gl/core`, `@deck.gl/layers` and
`@deck.gl/geo-layers` come in as dependencies.

## The base map

**deck.gl draws layers; it has no map of its own.** Every other provider in this
SDK wraps a map engine that already renders a base map, so `mapDesignType` there
selects a style the engine owns. Here the base map is part of the driver: a
`DeckGLDesign` is a raster tile template, and the driver lays it down with
`TileLayer` + `BitmapLayer` underneath everything else.

`DeckGLDesign.Standard` (OpenStreetMap), `.Light` / `.Dark` (CARTO),
`.Satellite` (Esri World Imagery) and `.None` are provided. Any XYZ tile service
works:

```ts
const gsi = new DeckGLDesign({
  id: 'gsi-standard',
  tileUrl: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
  tileSize: 256,
  maxZoom: 18,
  attributionRules: [{ attribution: '国土地理院' }],
});
```

`attributionRules` is what `MapAttributionOverlay` renders — a tile service you
point at is yours to attribute.

## Usage

```tsx
import {
  DeckGLDesign,
  DeckGLMapView,
  useDeckGLMapViewState,
} from '@mapconductor/react-for-deckgl';
import { createGeoPoint, createMapCameraPosition } from '@mapconductor/js-sdk-core';
import { Marker } from '@mapconductor/js-sdk-react';

function Map() {
  const state = useDeckGLMapViewState({
    mapDesignType: DeckGLDesign.Standard,
    cameraPosition: createMapCameraPosition({
      position: createGeoPoint({ latitude: 35.681, longitude: 139.767 }), // Tokyo
      zoom: 12,
    }),
  });

  return (
    <DeckGLMapView state={state}>
      <Marker position={createGeoPoint({ latitude: 35.681, longitude: 139.767 })} />
    </DeckGLMapView>
  );
}
```

## How overlays are drawn

| MapConductor | deck.gl |
| --- | --- |
| base map / raster layer | `TileLayer` + `BitmapLayer` |
| marker | one shared `IconLayer` for every marker |
| circle / polygon | `PolygonLayer` |
| polyline | `PathLayer` |
| ground image | `BitmapLayer` |

Markers share a single `IconLayer` rather than getting one layer each, the same
way the MapLibre driver puts them all in one symbol layer: per-marker layers
would make deck.gl's layer matching and draw calls scale with the marker count.

Overlay layers are declared `pickable: false` on purpose. Clicks go through
MapConductor's own geometric hit test (`marker → circle → groundImage →
polyline → polygon → map`, first hit wins, with the shared tap tolerance), so
the click order and hit areas match every other provider instead of following
deck.gl's GPU picking.

## Zoom

deck.gl's `WebMercatorViewport` uses a 512px world, like Mapbox and MapLibre.
The unified zoom this SDK exposes is the Google Maps 256px one, so the driver
adds **+1** on the way out and subtracts it on the way in
(`ZoomAltitudeConverter`). Verified against Google Maps, MapLibre and
OpenLayers on the `visible-region` sample: identical centre, zoom and bounds.

## Tilt

deck.gl's `pitch` only goes downward (0 and up). MapConductor also has **negative
tilt — looking up** — and every provider that cannot express it natively fakes it
the same way: keep the camera where it is, move the *ground target* forward along
the camera heading, and render with `abs(tilt)`.

```
altitude * cos(t) * tan(t) * 1.83     forward shift, in metres
zoom + (-0.9) * (t / 60)              so the visible extent matches positive tilt
```

The constants are shared with `react-for-maplibre`, `react-for-mapbox`,
`react-for-leaflet` and the Android/iOS SDKs — changing them here alone would
make the same `tilt` render differently per provider. Negative tilt is clamped to
-60°, which is as far as the emulation is calibrated.

Because deck.gl keeps no record that the pitch it was given came from a negative
tilt, the driver remembers the last requested value (`logicalTiltHint`) and
reverses the shift when reporting the camera back. Verified on the `tilt` sample
against MapLibre: same streets in the same screen positions at -60, -30, 0, 30
and 60.

## Bearing

MapConductor's `bearing` increases **clockwise for the map**. deck.gl uses the
Mapbox/MapLibre convention, where `bearing` is the compass direction the camera
is pointing — the opposite sign. The driver converts through the core's
`toNativeHeading` / `bearingFromNativeHeading`, so a camera synced from another
provider lands at the same orientation (checked on the `camera-sync` sample).

Note that the base map is raster, so its labels rotate with the map instead of
staying upright the way a vector style's would.

## Not compatible with `react-for-longdo` on the same page

deck.gl registers its version on `globalThis.deck` when the module is first
evaluated and **throws if a different version is already there**. The Longdo web
SDK ships its own deck.gl 8.x, so whichever loads second breaks.

Nothing can be done about that from here; just do not put both on one page. Load
this package lazily (`lazy(() => import('@mapconductor/react-for-deckgl'))`) so
pages that do not show a deck.gl map never evaluate it, and take the view state
and designs from the `@mapconductor/react-for-deckgl/state` subpath, which does
not import deck.gl at all. `examples/basic` is wired this way.

## Camera events

deck.gl has no `moveend`. `onViewStateChange` fires per frame while the camera
moves, and the driver reports a move as finished once ~140ms pass with no
further change (shorter once deck.gl reports that the interaction and any
transition have ended). `onCameraMoveStart` / `onCameraMove` /
`onCameraMoveEnd` behave the same as on the other providers.

## Gestures

`applyUISettings` maps onto deck.gl's `MapController` options. One thing does
not map cleanly: **deck.gl's `dragRotate` covers bearing and pitch together.**
Disabling only one of `rotateGesture` / `tiltGesture` is not possible, so the
driver keeps both enabled and logs a one-time warning naming the one it could
not honour.

## License

Apache-2.0
