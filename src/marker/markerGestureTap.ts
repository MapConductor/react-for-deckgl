/**
 * このタップの pointerup を、コアのマーカーのジェスチャが取ったか。
 *
 * マーカーを掴んだジェスチャのタップは、コアの `DefaultMarkerEventController` が
 * 1 回だけ配送する（clickable ならマーカーの onClick、clickable: false なら
 * `dispatchTap` で下のオーバーレイや地図クリックへ）。その印として pointerup に
 * `preventDefault()` を付ける。
 *
 * MapLibre 系はブラウザの click から地図クリックを作るので、コアがその click を
 * 捨てれば済む。deck.gl（mjolnir.js）はブラウザの click を使わず、ポインタ
 * イベントから自分でタップを認識するので、ここで捨てないと同じタップが 2 回
 * 配送される（clickable なマーカーで onClick が 2 回、clickable: false なら
 * 下のポリゴンが 2 回）。
 *
 * mjolnir.js の `srcEvent` は認識の最後の入力で、タップなら pointerup。mjolnir.js は
 * pointerup を window で聞くので、canvas で聞いているコアが先に印を付けている。
 */
export function isMarkerGestureTap(event: { srcEvent?: unknown } | null | undefined): boolean {
  const source = event?.srcEvent as { defaultPrevented?: boolean } | null | undefined;
  return source?.defaultPrevented === true;
}
