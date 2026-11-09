# 描画パスの契約

対象はThree.js 0.187.0のWebGLRenderer。色変換、透過、深度を変更するときは、この順序と既存の画素回帰を一緒に確認する。

## 入力と出力

| 段階 | 色と透過 | 深度・レイヤー |
|---|---|---|
| World | HalfFloatのlinear HDR。露出測光もこの領域を読む | スタジオ・机。人物とunlit印刷面を除外 |
| SSGI・SSR・GTAO | HDRのまま効果を合成。SSRは受け手のマスクを再適用 | Worldの深度を使う。人物RGBは対象外 |
| OutputPass | AgX・露出を一度適用。ポスト処理へ渡す場合はlinear displayへ出力 | 元の深度を引き継ぐ |
| Display art | unlit素材を露出なしで重ねる。人物は除外設定がOFFのときだけここへ入る | 深度を書き戻してから描く。机を透過しない |
| DoF・Bloom | display-linearで計算。Bloomのしきい値は露出後の線形輝度 | DoFは設定に応じた深度と鮮明な範囲を使う |
| 彩度・コントラスト | アルファで除算してsRGBへ変換し、自然な彩度とコントラストを適用。最終RGBを再びアルファで乗算 | 透過ピクセルのRGBを残さない |
| FXAA・最終合成 | sRGB符号化済みの画像を使い、再度AgXを適用しない | Worldまたはポストの深度を最終画面へ戻す |
| 人物除外ON | 直描画時は最終段、分割時はDisplayCompositeで人物を重ねる | DisplayCompositeはsRGBを一度linearへ戻し、共有深度で描いて再符号化 |
| 左右分割 | 各パネルの完成画像を中央で合成。色変換は追加しない | 左右は実際の縦長アスペクト比で独立した深度を持つ |

露出は左右で共有する。影を更新するためのシーン世代と、露出の初期測光をやり直す世代は別にする。机の成長アニメーションで初期測光を毎フレーム繰り返してはならない。

## 所有権と復元

ProgramRendererが単独・分割レンダラーと標準照明を所有する。EffectTargetsは画面効果のターゲットを必要時に確保し、Three.js標準のsetSizeとdisposeを呼ぶ。読み込み中のスタジオ候補は表示中のスタジオと別の所有者である。

QualityRenderer、PostRenderer、DisplayComposite、SplitRendererは、複数パスで変更した状態をsaveRenderStateで復元する。対象は描画先、キューブ面・mip、viewport、scissor、クリア色、背景、色空間、レイヤー、autoClear、影の自動更新である。正常終了・例外のどちらでも復元し、出力テクスチャの中身は解放しない。

スタジオ破棄時はライトのdisposeも呼び、影用テクスチャを解放する。Overlay終了時は描画ループ、WebSocket、人物、机、照明、描画パイプライン、Rendererを解放する。編集中の画像プレビューは本番とは別の所有者で、古い非同期ビルドを新しい画像へ接続しない。

## 更新条件

影・SSRの索引はスタジオ世代、机の形状、アンカー、席の変更、卓上小物の表示、影の設定、反射のON/OFFで更新する。退出して席予約が残る場合も、卓上小物の表示が変われば更新する。カメラ移動だけでは世界座標の影を作り直さない。

変更後はrender-regressions、post-effects、studio-materials、split-screen、exposureのブラウザ試験を実行する。透過、人物色、unlitロゴ、アルファ境界の影、SSRの黒い画素、DoF境界を確認する。ソフトウェアWebGLの成功を実GPUの速度保証に置き換えない。

参照：[Three.js Color Management](https://threejs.org/manual/en/color-management.html)、[LightShadow](https://threejs.org/docs/pages/LightShadow.html)、[OutputPass](https://threejs.org/docs/pages/OutputPass.html)。実装上の例外はaddon-adapters.tsへ局所化する。
