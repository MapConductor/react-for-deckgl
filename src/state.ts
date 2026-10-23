// deck.gl を読み込まない入口。
//
// ルートのバレルは `@deck.gl/core` を評価する。deck.gl はモジュール読み込み時に
// `globalThis.deck` へ自分のバージョンを登録し、**別バージョンが既に居ると例外を投げる**
// （`@deck.gl/core/lib/init.js` の `checkVersion`）。Longdo の web SDK のように
// 自前の deck.gl を積んでいるプロバイダと同じページに載ると、先に登録したほうが勝ち、
// 後から来たほうが壊れる。
//
// そのため、状態とデザインだけが要るところ（プロバイダを跨いで state を先に作る
// アプリのシェルなど）はここから取り、描画コンポーネントは動的 import で
// 実際に deck.gl の地図を出すときだけ読み込むこと。
//
// `react-for-maplibre/src/state.ts` と同じ役割（あちらは Metro/Hermes 対策）。
export { DeckGLDesign, type DeckGLMapDesignType, type DeckGLDesignParams } from './DeckGLDesign';
export {
  DeckGLMapViewState,
  useDeckGLMapViewState,
  type DeckGLMapViewStateInterface,
  type DeckGLMapViewStateParams,
} from './DeckGLMapViewState';
