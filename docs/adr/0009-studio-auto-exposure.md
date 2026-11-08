# ADR-0009: スタジオの自動露出と人物画像の色を分離する

- 状態: 採用
- 日付: 2026-11-08
- 対象: スタジオ、机、人物画像、プレビュー、Dock

## 決定

自動露出を既定で有効にする。AgXでスタジオと机を表示し、人物画像・Discordアイコン・発話グロー・名前プレートは露出補正の対象から外す。GLBの照明強度を書き換える方法では対応しない。

GLBやシーンに有効な照明があれば、既定ではアプリの標準ライトを追加しない。照明を含まない素材には標準ライトを使う。利用者は「素材の照明のみ」「素材＋標準照明」にも変更できる。環境マップは追加しない。

## 根拠と既存機能

Three.js 0.187.0のWebGLRenderer、WebGLRenderTarget、Layers、DataUtils、Material.toneMappedを確認した。AgX、sRGB変換、HDRターゲット、非同期読出し、深度判定は既存APIを使用する。

公式のAdaptiveToneMappingPassは削除されている。postprocessingのREINHARD2_ADAPTIVEは既存の自動露出候補だが、AgXと同じ動作ではなく、後処理を全画面へ適用すると人物画像まで変わる。今回は画面全体へのトーンマッピングパスを増設せず、直接描画を維持する。独自に実装するのは測光値の集計と追従速度の規則だけで、トーンマッパーやレイアウト・深度処理は自作しない。

## 測光と描画

64×36の線形HDR画像から、透明な背景と輝度分布の上下10%を除いて測光する。人物画像・アイコン・文字は別レイヤーに置き、測光からも除く。中央の輝度を0.18へ合わせ、明部の過剰な増幅を抑える。

初回と素材・照明の変更時には小さいHDRターゲットを同期読出しし、最初の測光値へ合わせる。その後は最大4回/秒の非同期読出しとEV空間での補間を使う。カメラのショット変更だけでは露出を初期化しない。初回読出しには一時的なGPU待ちが発生し得る。

最終画面はThree.jsで直接描画する。人物画像と名前プレートを非照明材質・toneMapped=falseにし、露出に依存しない色を保つ。深度テストと透過ソートは同じ描画で行うため、人物を常に最前面へ貼る合成にはしない。机に隠れる人物部分は引き続き隠れる。

HDR測光に対応しない環境や読出しエラーでは、保存された手動露出へ戻し、Dockへ理由を表示する。自動露出が動いていないのに動作中と表示しない。

## 保存と操作

シーンにexposureを保存する。省略した旧シーンも、自動露出・EV補正0・照明自動を使う。手動露出倍率の範囲は2^-20〜32、EV補正は-6〜+6とする。

Dockに自動露出、EV補正、手動倍率、照明選択、現在値での固定を設ける。露出だけを変更した場合はモデルを再ロードせず、カメラや席もリセットしない。スタジオのプレビューも同じ測光・描画部品を使うが、画角が違えば測光値は異なり得る。

利用者が提示した「AgX・sRGB・2^0.8÷683・GLB内照明のみ」は、今回のBlenderモデルとの比較プリセットとして残す。683で割る処理を、すべてのglTFや自動露出へ適用する規則にはしない。Three.jsとBlenderの見た目が完全に一致する保証ではない。

## 検証

測光のHDR範囲、透明背景、極端な明部、追従速度、旧シーン、保存検証、露出変更時のカメラ保持を試験する。ブラウザでは露出倍率を変え、人物画像・アイコン・文字の画素値が変わらないことと、机による遮蔽・透明背景が残ることを確認する。

利用者の説明にあるスポット7灯・ポイント1灯・太陽光1灯と代表光量を用いた、独立した再現用GLTFも使う。利用者の添付GLBは公開リポジトリや配布ZIPへ含めない。この試験は、添付GLBそのものや実OBSでの確認とは区別する。

## 参照

- https://threejs.org/docs/pages/WebGLRenderer.html
- https://threejs.org/docs/pages/Material.html
- https://threejs.org/docs/pages/RenderTarget.html
- https://threejs.org/docs/pages/Layers.html
- https://threejs.org/docs/pages/OutputPass.html
- https://github.com/mrdoob/three.js/wiki/Migration-Guide
- https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/ToneMappingEffect.js~ToneMappingEffect.html
- https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_lights_punctual/README.md
- 利用者が会話で提示したBlender書出し設定とThree.js比較設定
