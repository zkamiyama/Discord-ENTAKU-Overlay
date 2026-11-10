# 3DGSのFresnel発光プレビュー

`f85af3e31ec8268413dabeea8f522ff1987dcfb6`を基に作成した描画実験です。承認された発光を本番へ組み込み、このプレビューも本番と同じ`src/web/gaussian/speech-glow.ts`を使うように変更しました。

## 比較するもの

同じカメラで、発光OFF、Fresnel発光、Fresnel発光と弱い外側グローを比較します。人物は1体35,913個のGaussianで作った合成素材です。撮影から学習した3DGSではなく、表面に沿う扁平なGaussianを配置しています。法線推定に有利な条件であり、実素材の品質を代表しません。

キャラクターの描画にはSpark 2.4.0、机などにはThree.js 0.187.0を使います。メッシュの人物に輪郭を後付けした画像ではありません。

## 発光と遮蔽

Gaussianの最短軸を回転して法線とし、視線との角度からFresnel風の強さを計算します。最短軸と中間軸の長さが近い場合は、推定法線への信頼度を下げます。

外側グローは全画面Bloomではありません。発光するSplatの描画範囲を5px拡張し、低いアルファのGaussianを追加しています。元のGaussianの大きさは変えず、RGBの発光とハローの被覆率を同じソート順で合成します。ハローにも環境の深度テストと手前のSplatのアルファ合成が働きます。

元のアルファはそのままですが、ハローを含む最終アルファは増えます。完全に不透明なメッシュの遮蔽とは異なり、半透明の手前のGSから奥の光が透ける場合があります。Gaussian中心の深度を使う既存描画の近似も残ります。

全員を描くSparkRendererの表示中のmappingから、各Splatの所有者と発話強度を対応付けています。元データの個数や、まだ描画に使われていないLoD要求の範囲で対応させません。本番のアダプターは最大32人分の範囲を持ちます。この比較画像では1体と、同じ元データを共有する2体を使います。

## 再実行

このフォルダーを含むリポジトリのルートで実行します。Bun 1.4.4、Node.js、PlaywrightのChromiumが必要です。

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run preview:gaussian-glow
```

必要に応じて`ENTAKU_CHROMIUM_PATH`へChromium実行ファイルの絶対パスを指定してください。ブラウザはheadlessで起動し、SwiftShaderを使用します。HTTPサーバーはloopbackの空きポートで起動し、試験終了時に閉じます。

`.work/fresnel-preview/`に、比較PNG、個別PNG、測定結果の`results.json`を保存します。型検査は次のコマンドです。

```sh
bun run typecheck
```

## 確認範囲

単体、2体の重なり、部分遮蔽、完全遮蔽を描画します。描画エラー、Fresnelによる画素変化、グロー追加による画素変化、完全遮蔽時の光漏れを自動検査します。初回は試験サーバーがfaviconへ404を返したため、描画検査とは別に通信エラーとして失敗しました。faviconの応答を204へ修正した再実行は合格しました。

外周だけでなく鼻、口、眉、服の境目も光ります。Fresnel発光は外周限定の輪郭線ではありません。実キャラクター素材、LoD切替、8種類同時表示、SPLIT、SSR・後処理との統合、OBS、実GPUの性能は今回の検証に含めません。この比較用プレビューでは固定した発話強度を使います。本番の発話状態との接続と追加テストは[発話グローの記録](../../docs/gaussian-speech-glow.md)に分けています。

## 方式を選んだ理由

Three.js公式のUnrealBloomPass、HorizontalBlurShader、VerticalBlurShaderを候補として確認しました。全画面でのぼかしは発光源の後ろにある画素と手前の画素を区別しないため、この比較では使用していません。外側の光もSplatの既存の描画順に含める方式を試しています。

Sparkの独自ソートや別の3DGSラスタライザーは実装していません。公開ShaderMaterialのシェーダーを、このバージョンで確認した位置に限定して拡張し、該当箇所が一致しなければ例外にします。共有ShaderChunkは変更しません。

参照した一次資料はSparkのSplatMesh・SparkRenderer仕様、固定バージョンのsplatVertex.glsl・splatFragment.glsl、Three.js公式UnrealBloomPassです。

## 初回試作の実測

2026年11月10日、接続したWSL2環境のChromiumとSwiftShaderで実行しました。型検査は合格し、描画時のConsoleエラーは0件でした。

発光OFFとFresnel発光の比較では126,096画素、Fresnelだけとグロー追加の比較では29,946画素で、RGBのいずれかが3を超えて変化しました。完全遮蔽では最大差0、机の不透明領域の31,500画素でも最大差0でした。

半透明の手前のGSでは、奥の発光が一部透けています。これを完全に不透明な遮蔽として合格とはしていません。画像の比較と固定視点での短い描画試験に限定した結果です。
