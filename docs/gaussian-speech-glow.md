# 3DGSの発話グロー

発話中の3DGSは緑色のFresnel発光と外側グローを表示します。外側グローは通常サイズで描いた人物のマスクから画面上に生成します。各Gaussianの投影矩形を広げる旧方式は廃止しました。3DGSの発話リングは表示しません。

## 表示と操作

GSを参加者へ割り当てると、発話開始・停止に合わせて発光が変化します。2D画像と連動GLBも同じ発話強度を使います。接続断やstaleでは発光がフェードし、フレームの遅延やタブの中断後も実際の経過時間を反映します。発話だけで素材の取得やLoD構築をやり直しません。

「ポストエフェクト」の発話グロー倍率は1〜8、既定値は4です。画面に投影した身体の高さの6%を基準半径にし、描画先の高さの1.2〜6.5%を目安に制限します。基準半径の下限は4px、上限は72pxです。倍率4を基準に、倍率1では4分の1、倍率8では2倍となり、最終半径は最大144pxです。半径は描画先の実画素で計算し、カメラ距離、左右分割、リサイズに追従します。

全画面BloomをOFFにしても発話グローは動作します。Fresnel成分は鼻や服の境目などにも出るため、人物内部の発光を完全には除きません。法線の信頼度が低い平面的な人物にも、マスクから作る外側グローを適用します。実際に見える幅は素材の密度、不透明度、遮蔽によって変わります。

## 描画方式

Fresnel成分はGaussianの最短軸を回転した擬似法線を使い、最短軸と中間軸の比率で信頼度を調整します。指数2.6、発光強度2.0を維持し、Gaussian本来の投影範囲とアルファ減衰は拡張しません。RGBの発光加算はlinearで行います。

外側グローの処理は次の順序です。

1. その視点で表示中のLoDとソート結果から、通常サイズのSplatでマスクを描きます。マスクには発話強度と半径を格納し、無発話の前景Gaussianの透過も反映します。
2. マスクの発光元の座標をRGBA8へ格納し、半解像度の2枚のテクスチャで近傍へ伝播します。探索範囲は必要な半径で制限します。
3. 元のマスク画素の強度・半径・深度を参照して、描画先の実画素距離で減衰させます。基準アルファは0.35です。
4. グローを通常のGaussianカラー描画の前に重ねます。不透明な机・スタジオの深度と、通常のGaussianの透過を保ちます。

話者ごとの発光元を参照するため、別の人物の倍率や強度を変更しても、画面全体の最大値で他の人物まで広げません。身体範囲は素材のキャリブレーションから登録し、フレームごとに元の全Splatを走査しません。身体範囲がない独立した試験では描画先の高さから代替値を計算します。

GaussianSpeechHaloが所有するテクスチャは全解像度のマスクと深度、半解像度の座標伝播用2枚です。この4枚を1組とし、1つのGaussianRuntimeがサイズ別に最大2組まで再利用します。奇数幅の左右分割でも1pxの差で毎回再確保しません。新しいサイズで上限を超えると古い組を解放し、視点の解放時には全組を破棄します。浮動小数点カラーターゲットの拡張、CPUへの画素読み戻し、追加のソートworkerは使いません。発話者がいない場合はマスクと座標伝播の処理を省略します。

発話情報はSplatMeshのインスタンス単位で保持します。共有PackedSplatsは変更せず、最大32人分の表示範囲を対応付けます。未表示のLoD要求をマスクへ混ぜません。新しい視点では公式のSparkRenderer.update()でLoDとソートを進め、描画予算内の結果が表示側に届くまで最初のGaussian描画を待ちます。

半解像度の座標伝播とGaussian中心の深度は近似です。半透明のGSの奥では、元の透過率に応じて光が見える場合があります。不透明メッシュと同じ遮蔽を保証する方式ではありません。

## 実人物PLYでの画素比較

以前の投影矩形を広げる方式では、研究・教育用途限定の40,000 Splat人物PLYを使い、600×600の固定カメラで幅を比較しました。これは旧実装の記録です。現在のマスク方式の性能や画素一致を示す測定としては扱いません。元の条件と数値は[67bac9e時点の文書](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/blob/67bac9ee9dca68617cb85f5023c63b599f502e82/docs/gaussian-speech-glow.md#実人物plyでの画素比較)に残しています。実人物PLYはリポジトリや配布物へ収録していません。

現在の画素試験は通常の身体形状と法線の信頼度が低い平面的な合成人物を使用します。性能の比較条件と結果は[アーキテクチャの現状](architecture-status.md)を参照してください。

## 公式機能との関係

Three.jsのWebGLRenderTarget、DepthTexture、FullScreenQuad、Box3、Frustumを使います。深度テクスチャが互換ならcopyTextureToTextureで複写し、それ以外は元のマテリアルのcolorWriteを一時的に止めて深度を描きます。alpha test、skinning、元のシェーダーによる深度の扱いを維持し、例外時も状態を復元します。

OutlinePassは選択メッシュを別マテリアルで描く仕組みであり、Sparkが共有描画する各SplatMeshのLoDとアルファをそのまま抽出できません。UnrealBloomPassの輝度しきい値とぼかしも、話者別の幅と強度を指定する要件とは異なります。Sparkの投影・ソート・LoDは使用し、発話マスクとFresnelに必要な範囲だけシェーダーへ加えています。

シェーダーの変更箇所は文字列で検査し、依存更新で一致しなくなれば明示的に失敗します。共有ShaderChunkは変更しません。直描画とrender target経由の色空間を区別し、SSRのカラー入力や人物を含む後処理にも同じ発光を渡します。採用理由は[ADR 0028](adr/0028-render-generation-and-screen-halo.md)に記録しています。

一次資料は[SparkRenderer 2.4.0](https://github.com/sparkjsdev/spark/blob/v2.4.0/src/SparkRenderer.ts)、[頂点シェーダー](https://github.com/sparkjsdev/spark/blob/v2.4.0/src/shaders/splatVertex.glsl)、[フラグメントシェーダー](https://github.com/sparkjsdev/spark/blob/v2.4.0/src/shaders/splatFragment.glsl)、[OutlinePass](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/OutlinePass.js)、[UnrealBloomPass](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/UnrealBloomPass.js)です。

## 検証と再実行

実装は[speech-glow.ts](../src/web/gaussian/speech-glow.ts)、[speech-halo.ts](../src/web/gaussian/speech-halo.ts)、[runtime.ts](../src/web/gaussian/runtime.ts)に分けています。単体テストは表示中のLoD、最大32人、非表示・削除、シェーダーの変更検出、描画状態の復元、準備中の非同期処理の終了を確認します。

[ブラウザテスト](../e2e/gaussian-speech-glow.spec.ts)は本番のGaussianRuntime、QualityRenderer、SplitRendererを使います。発光OFF、Fresnel、外側グロー、倍率変更、停止、完全遮蔽、2体の発話交代、独立した強度と倍率、逆向きの分割視点、CUT、リサイズ、LoD予算変更を確認します。SSR・AO・DoF・Bloom・MSAA・FXAAとの同時描画も対象です。結果のJSONとPNGは`.work/gaussian/speech-*`へ保存します。

```sh
bun install --frozen-lockfile
bun run check
bunx playwright install chromium
bun run build:web
bunx playwright test e2e/gaussian-speech-glow.spec.ts
```

旧previewコマンドと単独描画実装は削除しました。合成人物のfixtureは[tests/helpers/gaussian-bust.ts](../tests/helpers/gaussian-bust.ts)で共有します。撮影から学習した実キャラクターではありません。

実GPU・WindowsのOBS/CEF・長時間の実配信は未検証です。[実機確認手順](gaussian-validation.md#実gpuとobsでの確認手順)で、発話者の前後を入れ替え、机で隠し、停止後の残留と半透明部分の透けを確認してください。SwiftShaderの速度から実機のfpsは推定しません。
