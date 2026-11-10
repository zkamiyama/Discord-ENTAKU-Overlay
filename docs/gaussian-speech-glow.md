# 3DGSの発話グロー

発話中の3DGSはGaussianの向きに応じた緑色のFresnel発光と外側グローを表示します。法線が正面にそろう人物PLYでも輪郭が出るよう、発話者のGaussianを広げた低アルファの発光層を先に描き、その上に通常の人物を合成します。3DGSの発話リングは廃止し、人物の輪郭グローだけで発話を表示します。

## 表示と操作

GSを取り込んで参加者へ割り当てると、発話開始・停止に合わせて発光が変化します。接続断やstaleでは、既存の発話表示と同じフェードで消灯します。発話だけで素材の取得やLoD構築をやり直しません。

「ポストエフェクト」にある発話グローの倍率は、3DGSでは外側グローの広がりに使います。既定値4では従来のFresnelハローを5px拡張し、外周用の先行発光層を8.5px拡張します。倍率1〜8に対してどちらも比例して変わります。数値は描画先での拡張量で、実際に見える幅はGaussianの重なりと透明度にも左右されます。全画面BloomをOFFにしても動作します。

Fresnel成分は顔や身体の外周だけでなく、鼻、口、眉、服の境目なども光らせます。球状に近いGaussianや薄い板状の人物では、法線からのFresnel成分が弱い場合があります。先行発光層は法線を使わず、通常の人物描画に隠れずに残る外側部分を光らせます。完全なシルエット抽出ではないため、重なりの薄い場所には内部の緑色も残る場合があります。

## 描画方式

各Gaussianの最短軸を回転して擬似法線を求め、視線との内積の絶対値からFresnel風の発光強度を計算します。最短軸と中間軸の比率で信頼度を調整します。指数2.6、発光強度2.0、外側グローの基準アルファ0.035は承認された試作と同じです。

従来のFresnel成分は各Gaussianの元の投影・アルファ減衰を維持します。これに加え、発話者が表示される視点では、Gaussianの投影範囲を8.5px（倍率4の場合）拡張した緑色の低アルファ層を先に描きます。その後、通常のスタジオと人物を従来どおりの順序で描画します。机などの不透明な物体は手前から発光層を覆い、通常のGaussianが人物内部の発光層を覆うため、平面的な人物でも外側の光が残ります。先行発光層と通常の人物は同じSparkの視点別ソート結果を使い、世界側の透明物体と人物の通常描画順も変更しません。発話中はGaussianのカラー描画を1回追加するため、素材が大きいほど描画負荷も増えます。

発話情報はSplatMeshのインスタンス単位で保持し、共有PackedSplatsを変更しません。描画直前に、その視点で実際に表示するaccumulatorの範囲と発話者を対応付けます。通常・左右分割の各視点で確認し、まだ表示されていないLoD要求の範囲は使いません。発話がないフレームでは法線・発光の計算を省略します。

この対応表は32人分です。32人の範囲検査は単体テストで行っています。人数分のCanvas、追加のソートworker、画面サイズのグロー用render targetは作りません。発話者がいないときは先行発光層の描画を省略し、通常どおり1回だけ描画します。

半透明のGSの背後では、元の透過率に応じて奥の光が見える場合があります。また、Gaussian中心の深度による描画の近似は残ります。完全に不透明なメッシュと同じ遮蔽を保証するものではありません。

## 公式機能との関係

Three.js r187のOutlinePassとUnrealBloomPassを確認しました。前者は選択オブジェクトの輪郭、後者は画像の輝度とぼかしを扱います。OutlinePassはThree.jsの選択メッシュを対象とする仕組みで、Sparkが共有描画する個々のSplatMeshのシルエットをそのまま抽出できません。そこでSpark 2.4.0の公開ShaderMaterialを限定的に拡張しました。Fresnel発光に加え、発話中は同じ視点のGaussianを2回描き、背面の低アルファ発光層の上に通常の色を重ねます。公式のソート、LoD、投影、アルファ減衰は置き換えていません。

変更位置を文字列で検査し、依存の更新で一致しなくなった場合は例外にします。共有ShaderChunkは変更しません。RGBの発光加算はlinearで行い、直描画とrender target経由の色空間を区別しています。SSRのカラー入力や人物を含む後処理にも、同じ発光付きGSを渡します。

一次資料は[SparkRenderer](https://sparkjs.dev/docs/spark-renderer/)、[固定版の頂点シェーダー](https://github.com/sparkjsdev/spark/blob/v2.4.0/src/shaders/splatVertex.glsl)、[固定版のフラグメントシェーダー](https://github.com/sparkjsdev/spark/blob/v2.4.0/src/shaders/splatFragment.glsl)、[OutlinePass](https://threejs.org/docs/pages/OutlinePass.html)、[UnrealBloomPass](https://threejs.org/docs/pages/UnrealBloomPass.html)です。

## 検証と再実行

実装は`src/web/gaussian/speech-glow.ts`、接続は`runtime.ts`、`avatar-visual.ts`、`overlay/avatar.ts`です。単体テストでは発話者別の範囲、表示中のLoD、左右視点、最大32人、非表示・削除、シェーダーの変更検出を確認します。既存のAvatar状態テストにも、発話・stale・接続断とグローの対応を追加しました。

ブラウザテスト`e2e/gaussian-speech-glow.spec.ts`では、本番のGaussianRuntimeとQualityRenderer・SplitRendererを使用します。発光OFF、Fresnel、先行発光層、倍率変更、発話停止、完全遮蔽、共有データを使う2体の発話交代、左右の逆向き視点、CUT、resize、LoD予算変更、SSR・AO・DoF・Bloom・MSAA・FXAAとの同時描画を確認します。さらに、最短軸と中間軸が等しい平面的な合成人物でも、背景側の外周に緑色が生じ、停止すると元画像に戻ることを確認します。結果のJSONとPNGは`.work/gaussian/speech-*`へ保存します。

```sh
bun install --frozen-lockfile
bun run check
bunx playwright install chromium
bun run build:web
bunx playwright test e2e/gaussian-speech-glow.spec.ts
bun run preview:gaussian-glow
```

比較試作は`experiments/gaussian-fresnel-preview/`にあります。本番と同じ発光シェーダーを使い、OFF／Fresnel／Fresnelと外側グローの比較画像を`.work/fresnel-preview/`へ保存します。素材は表面に沿ってGaussianを配置した合成モデルで、撮影から学習した実キャラクターではありません。

最初の実装では、表面に沿う扁平な合成Splatを用いたテストが合格していました。しかし、Gaussianの最短軸と中間軸が近い人物PLYではFresnelの信頼度が低く、外周に光が出ず内部だけが緑色になることを確認しました。研究用途の公開人物PLY（LHMの40,000 Splat、`MJ_mint-hoodie-boy.ply`）を変更・再配布せずに手元で読み込み、先行発光層の修正前後をChromiumで描画して比較しました。実素材をリポジトリへ含めていません。WindowsネイティブのOBS/CEFと長時間配信での動作は未確認です。

実機で確認する場合は、[基礎機能の実機確認手順](gaussian-validation.md#実gpuとobsでの確認手順)に従い、発話者を手前／奥に切り替え、机で隠す操作を加えてください。発光のちらつき、半透明部分の透け、消灯後の残留を記録します。未確認の実機性能をCIやSwiftShaderの結果から推定しません。
