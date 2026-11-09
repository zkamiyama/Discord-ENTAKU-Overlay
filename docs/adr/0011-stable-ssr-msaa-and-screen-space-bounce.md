# ADR-0011: SSRの描画不具合、形状AA、画面内の間接光

- 状態: 採用。実装と描画試験は後続コミットで反映する。
- 日付: 2026-11-09
- 対象: Three.js r187、OBS用WebGL描画

## 問題と確認結果

SSRPassは入力の背景をそのまま使わず、専用のbeautyRenderTargetへシーンを描き直す。r187のその深度テクスチャは16bitで、MSAAも無効だった。さらにSSRShaderには出力色を設定せずにreturnする分岐がある。反射量を0にした再現テストでも、反射しない面の画素が変わった。添付画像だけから、モデルに重複面があると断定しない。

FXAAは描画後の平滑化であり、形状の被覆率を増やす代わりにはしない。アバターのY軸追従に入っていた時間補間は、カット後の遅い首振りを起こしていた。

## 決定

SSRは公式SSRPassの反射だけを取得し、元のHDR背景へ加算する。専用深度を24bitへ変更し、反射色はHalfFloatで保持する。反射しない画素は出力を0に初期化し、ぼかし後も受け手のマスクを適用する。背景の色・深度をSSR内部の画像で置き換えない。

HDR背景はMSAA 4xを標準にする。GPUが実際に対応するRGBA16FとDepth24のサンプル数を調べ、指定値以下の対応値を使う。150%・200%の描画解像度も用意する。描画バッファは4096×2304以内に抑える。FXAAは追加の平滑化として残す。高解像度の画素数と負荷は増える。

人物の向きは現在のカメラ位置から即時に求める。Y軸±30度と後方へ振り向かない規則は維持し、カメラMOVE、席配置、発話グローの補間は変更しない。

## SSGIの選択

公式SSGINodeはWebGPURendererのノード描画用で、現在のShaderMaterial・WebGL用Passへ直接追加できない。realism-effectsの公開package.jsonもThree.js ^0.151.3を要求しており、r187との互換性を前提に採用しない。

今回はWebGL向けの限定的なSSGIを実験オプションとして追加する。画面内のHDR色と深度から1回の拡散反射を近似する。深度・法線の再構成とPoissonデノイズにはThree.jsの既存シェーダーを使い、不足するトレースと合成だけを実装する。1画素につき8方向・最大16ステップとし、既定では無効にする。

これは完全なGIでもAMD FidelityFX SSSRでもない。画面外・裏側の物体からの光、複数回反射は再現しない。時間方向の蓄積を持たず、カット前の光が残らない代わりにノイズが出る場合がある。

## 色と互換性

アバター・アイコン・発話グロー・名札の印刷面は、測光・反射・GIから除外する。机の深度による遮蔽は保つ。旧画質設定には新しい既定値を補い、素材・席・カメラをリセットしない。

## 検証

近接した面のSSR切替、反射量0時の画素一致、MSAAによる中間被覆画素、赤い面から床への局所的な色の回り込みを描画試験する。人物のRGB、透明背景、遮蔽、設定の保存、資源解放も検査する。利用者のGLBそのものとOBS実機での確認は、再現用シーンの成功と区別する。

## 参照

- https://threejs.org/docs/pages/SSRPass.html
- https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/SSRPass.js
- https://threejs.org/docs/pages/RenderTarget.html
- https://threejs.org/manual/pages/webgpurenderer.html
- https://threejs.org/docs/pages/SSGINode.html
- https://github.com/0beqz/realism-effects/blob/main/package.json
