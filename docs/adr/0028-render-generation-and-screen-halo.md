# ADR 0028: 表示世代と発話グローの処理単位

状態: 採用。PR #6の実装に適用する。Three.js 0.187.0、Spark 2.4.0を対象とする。

## 問題

設定の受信、素材の読み込み、画面への反映は異なる時点に完了する。候補のスタジオが完成する前に新しいカメラ設定だけを使うと、背景と撮影位置の組合せが崩れる。古い読み込みや画像処理の完了を接続し続けることも、無駄な計算とGPU資源の残留につながる。

以前の3DGSの外側グローは各Splatの投影矩形を広げていた。Splatが密集するほど広い領域を繰り返し描画するため、発話時の負荷が大きい。さらに分割パスの状態復元でRenderer全体のviewportを描画先へ適用しており、パネル固有の画素寸法を上書きしていた。

## 表示と所有権

StudioVisualは読み込み候補と完成済みの表示を分ける。候補には署名、AbortController、完了Promiseを持たせ、同じ候補を重複して作らない。完成済みの設定へ戻した場合は新候補を取り消す。候補が失敗しても完成済みの表示は保持する。

ScenePresentationはスタジオとカメラ計画を同じ世代として扱う。候補を待つ間も最新の参加者と発話を取り込み、完成後に構造と撮影位置を切り替える。同じ入力参照に対する合成結果は再利用する。実装は[StudioVisual](../../src/web/studio/visual.ts)と[ScenePresentation](../../src/web/overlay/scene-presentation.ts)に分ける。

ResourceCacheは最後の参照が解放されたときに共有元の取得を取り消し、共有の待機Promiseを直ちにrejectする。他の参照が残る場合は取得と共有Promiseを維持する。個別の読み込み要求を終了する処理はStudioModelRegistryなどの利用側が持つ。取り消せないデコーダーが後から返した資源は一度だけ破棄する。GLBは公式SkeletonUtils.cloneを使用し、共有するジオメトリ・テクスチャと、配置ごとのマテリアル・骨格・インスタンスバッファを区別する。

画像の距離場生成はAlphaFieldQueueに集約する。受付上限は実行中を含め64件、workerは1つ、1件のタイムアウトは15秒とする。待機中の取り消しは即時に取り除き、実行中の取り消し・異常・タイムアウトはworkerを終了して次の処理用に作り直す。プレビューと本番の要求はそれぞれの所有者がAbortSignalを渡す。

## フレーム時間と復旧

2D画像、3DGS、連動GLBは共通のAvatarEnvelopeを使う。Three.jsのMathUtils.dampへフレームの実経過時間を渡し、低速フレームやタブの中断で発話停止のフェードが延びないようにする。独自の固定ステップ積分器は追加しない。

最初の有効な状態を受信するまではSTATE_WAITINGを報告する。差分の欠落や接続断ではSTATE_STALEを報告し、最後の確定表示を保持する。スタジオ読み込みと画質処理の一時的な失敗は共通のRetryBudgetで最大2回再試行する。同じ設定で無制限に再試行せず、設定変更か成功で予算をリセットする。

## 外側グロー

GaussianSpeechHaloは実際に表示するLoDの通常サイズのSplatからマスクを描く。画面上の近傍探索で発光元の座標を広げ、元の画素の発話強度、半径、深度を参照して合成する。拡張量は最大144pxに制限する。異なる話者の最大半径や強度を全体へ適用しない。

マスクと深度は描画先と同じ画素数を保ち、座標伝播用の2枚だけ縦横を半分にする。座標はRGBA8へ格納するため浮動小数点カラーターゲットの拡張を要求せず、CPUへの画素読み戻しも行わない。GPU時間は画面の画素数と探索範囲にも依存するため、Splat数から独立した一定時間とは扱わない。Fresnel成分は元の投影範囲を保つ。

4枚のテクスチャを1組とし、GaussianSpeechHaloPoolでサイズ別に最大2組を保持する。奇数幅の左右分割で1px違う描画先へ切り替わっても再確保しない。3つ目のサイズは最後に使ってから最も時間が経った組を解放して作る。非使用の合成面は非表示にし、視点の解放時には全組を破棄する。

深度テクスチャが互換ならThree.jsのcopyTextureToTextureを使う。それ以外は元のマテリアルをcolorWrite=falseとして深度を描き、alpha testやskinningを保持する。例外時も状態を復元する。マスクは無発話の前景Gaussianの透過も含み、完成したグローを通常のGaussianカラー描画の前に合成する。

新しい視点ではSparkRenderer.update()で公式のLoD選択とソートを進める。カメラ、画素スケール、予算に対応する選択が表示側へ届くまで描画を保留し、一時的な全Splat描画を避ける。更新Promiseの完了だけを準備完了とはみなさない。既に表示済みの視点は通常のSparkの更新を続ける。

位置と回転の許容幅はSparkのLoD更新条件に揃える。アプリ側だけ厳しくすると、Sparkが更新不要と判断する微小な移動で初回の待機が終わらなくなる。許容幅を超える移動や、予算・画素スケールの不一致ではLoDを更新対象にして、公式update()で選択を進める。

Spark 2.4.0のソートとLoDの更新には、テクスチャがGPUへ初期化済みであることを前提とする経路がある。通常の最初の描画を保留するため、準備中にThree.jsのinitTextureでソート順とLoDインデックスのテクスチャを初期化する。以後はSparkの標準アップロードを使う。raw WebGL操作や独自のソートは追加しない。

## 公式機能と代替案

| 候補 | 判断 |
|---|---|
| Three.js OutlinePass | 選択メッシュをoverride materialで描く方式。Sparkが共有描画するLoDとSplatのアルファをそのまま扱えないため、マスク抽出には採用しない |
| Three.js UnrealBloomPass | 輝度しきい値とぼかしによる効果。話者ごとの強度・半径と身体範囲に基づく輪郭の要件は専用マスクで扱い、既存の全画面Bloomは維持する |
| Splatの投影矩形の拡張 | 密集したSplatの重複描画が増えるため廃止する |
| 独自のSplatソート・LoD | 追加せず、Sparkの視点別の表示対応表と公開update()を使う |
| Three.jsの描画資源 | WebGLRenderTarget、DepthTexture、FullScreenQuad、Box3、Frustum、MathUtils.damp、標準のsetSize/disposeを使用する |

Sparkのシェーダーへの限定的な変更箇所は文字列で検査し、依存更新で一致しなければ明示的に失敗させる。共有ShaderChunkは変更しない。古い単独preview実装は削除し、合成人物のfixtureをtests/helpers/gaussian-bust.tsへ移す。本番GaussianRuntimeを使うブラウザ試験で表示を比較する。

## 検証と制約

[render-state](../../tests/unit/render-state.test.ts)はRendererの論理viewportと描画先の実画素viewportの復元順を確認する。[Gaussianのブラウザ試験](../../e2e/gaussian-speech-glow.spec.ts)は発話停止、遮蔽、複数話者、逆向きの分割視点、CUT、リサイズ、予算変更、ポストエフェクトを扱う。測定値と最新HEADのCI確認手順は[アーキテクチャの現状](../architecture-status.md)に記録する。

半解像度の座標伝播は画面上の近似である。半透明Gaussianの奥の光や、Splat中心の深度を使う近似は残る。SwiftShaderの画素試験と計測から、実GPU・OBS/CEFの速度や長時間配信の安定性は保証しない。

一次資料: [Spark 2.4.0 performance](https://github.com/sparkjsdev/spark/blob/v2.4.0/docs/docs/performance.md)、[SparkRenderer実装](https://github.com/sparkjsdev/spark/blob/v2.4.0/src/SparkRenderer.ts)、[Three.js r187 WebGLRenderer](https://github.com/mrdoob/three.js/blob/r187/src/renderers/WebGLRenderer.js)、[OutlinePass](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/OutlinePass.js)、[MathUtils](https://github.com/mrdoob/three.js/blob/r187/src/math/MathUtils.js)。
