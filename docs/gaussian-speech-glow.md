# 3DGSの発話グロー

発話中の3DGSに緑色のFresnel発光と弱い外側グローを加えました。従来の発話リングも残しています。承認された比較試作を基に、本番のAvatarから発話強度とグロー倍率を渡すようにしています。

## 表示と操作

GSを取り込んで参加者へ割り当てると、発話開始・停止に合わせて発光が変化します。接続断やstaleでは、既存の発話表示と同じフェードで消灯します。発話だけで素材の取得やLoD構築をやり直しません。

「ポストエフェクト」にある発話グローの倍率は、3DGSでは外側グローの広がりに使います。既定値4で描画範囲を5px拡張し、1〜8の設定で1.25〜10pxになります。単位は各描画先の画素です。全画面BloomをOFFにしても発話グローは動きます。

顔や身体の外周に限らず、鼻、口、眉、服の境目なども光ります。細い輪郭線だけを描く機能ではありません。球状や細長いGaussianでは推定法線の信頼度を下げるため、発光が弱い素材もあります。リングはそれらの素材でも発話を示します。

## 描画方式

各Gaussianの最短軸を回転して擬似法線を求め、視線との内積の絶対値からFresnel風の発光強度を計算します。最短軸と中間軸の比率で信頼度を調整します。指数2.6、発光強度2.0、外側グローの基準アルファ0.035は承認された試作と同じです。

元のGaussianの投影とアルファ減衰は維持し、周囲に低アルファの発光を追加します。最終アルファはこの分だけ増えます。発光とハローをSparkの同じソート順で合成し、環境の深度テストも維持します。全画面へ後から光を足す処理ではありません。

発話情報はSplatMeshのインスタンス単位で保持し、共有PackedSplatsを変更しません。描画直前に、その視点で実際に表示するaccumulatorの範囲と発話者を対応付けます。通常・左右分割の各視点で確認し、まだ表示されていないLoD要求の範囲は使いません。発話がないフレームでは法線・発光の計算を省略します。

この対応表は32人分です。32人の検証は単体テストで行い、実描画の追加試験は2体までです。人数分のCanvas、追加のソートworker、画面サイズのグロー用render targetは作りません。

半透明のGSの背後では、元の透過率に応じて奥の光が見える場合があります。また、Gaussian中心の深度による描画の近似は残ります。完全に不透明なメッシュと同じ遮蔽を保証するものではありません。

## 公式機能との関係

Three.js r187のOutlinePassとUnrealBloomPassを確認しました。前者は選択オブジェクトの輪郭、後者は画像の輝度とぼかしを扱います。今回は個々のGaussianの向きによる発光と、そのGaussianの透過合成順に沿うハローが必要なため、Spark 2.4.0の公開ShaderMaterialを限定的に拡張しました。公式のソート、LoD、投影、アルファ減衰は置き換えていません。

変更位置を文字列で検査し、依存の更新で一致しなくなった場合は例外にします。共有ShaderChunkは変更しません。RGBの発光加算はlinearで行い、直描画とrender target経由の色空間を区別しています。SSRのカラー入力や人物を含む後処理にも、同じ発光付きGSを渡します。

一次資料は[SparkRenderer](https://sparkjs.dev/docs/spark-renderer/)、[固定版の頂点シェーダー](https://github.com/sparkjsdev/spark/blob/v2.4.0/src/shaders/splatVertex.glsl)、[固定版のフラグメントシェーダー](https://github.com/sparkjsdev/spark/blob/v2.4.0/src/shaders/splatFragment.glsl)、[OutlinePass](https://threejs.org/docs/pages/OutlinePass.html)、[UnrealBloomPass](https://threejs.org/docs/pages/UnrealBloomPass.html)です。

## 検証と再実行

実装は`src/web/gaussian/speech-glow.ts`、接続は`runtime.ts`、`avatar-visual.ts`、`overlay/avatar.ts`です。単体テストでは発話者別の範囲、表示中のLoD、左右視点、最大32人、非表示・削除、シェーダーの変更検出を確認します。既存のAvatar状態テストにも、発話・stale・接続断とグローの対応を追加しました。

ブラウザテスト`e2e/gaussian-speech-glow.spec.ts`では、本番のGaussianRuntimeとQualityRenderer・SplitRendererを使用します。発光OFF、Fresnelだけ、外側グローの追加、倍率変更、発話停止、完全遮蔽、共有データを使う2体の発話交代、左右の逆向き視点、CUT、resize、LoD予算変更、SSR・AO・DoF・Bloom・MSAA・FXAAとの同時描画を確認します。結果のJSONとPNGは`.work/gaussian/speech-*`へ保存します。

```sh
bun install --frozen-lockfile
bun run check
bunx playwright install chromium
bun run build:web
bunx playwright test e2e/gaussian-speech-glow.spec.ts
bun run preview:gaussian-glow
```

比較試作は`experiments/gaussian-fresnel-preview/`にあります。本番と同じ発光シェーダーを使い、OFF／Fresnel／Fresnelと外側グローの比較画像を`.work/fresnel-preview/`へ保存します。素材は表面に沿ってGaussianを配置した合成モデルで、撮影から学習した実キャラクターではありません。

接続したWSL2のChromium・SwiftShaderでは、型検査と全293件の単体・結合テスト、上記ブラウザテスト2件が合格しました。これはソフトウェアWebGLでの機能確認です。実GPU性能、OBS、実キャラクターの法線品質やLoD切替時の見た目は未確認です。

実機で確認する場合は、[基礎機能の実機確認手順](gaussian-validation.md#実gpuとobsでの確認手順)に従い、発話者を手前／奥に切り替え、机で隠す操作を加えてください。発光のちらつき、半透明部分の透け、消灯後の残留を記録します。未確認の実機性能をCIやSwiftShaderの結果から推定しません。
