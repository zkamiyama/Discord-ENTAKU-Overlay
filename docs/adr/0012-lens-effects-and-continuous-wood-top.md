# ADR-0012: 人物の色を保つポストエフェクトと全面木目の天板

- 状態: 採用。描画と操作の検証後に配布する。
- 日付: 2026-11-09
- 対象: Three.js r187、OBS Overlay、Dock

## 背景

彩度・コントラスト、しきい値付きのグロー、話者距離に連動するDoFが必要になった。人物を効果から除外する設定も必要である。天板は参考写真のように全面木材とし、短い名前を無制限に横伸ばししない。

## 決定

Three.js公式のUnrealBloomPass、BokehShader、HueSaturationShader、BrightnessContrastShader、OutputPassを利用する。固定バージョンのコードを確認してから組み込む。焦点対象の選択、人物の別描画、焦点の許容範囲、透明度を保つ合成だけをアプリ側で実装する。

スタジオを露出補正・AgXで線形の表示色へ変換する。人物を含める設定の場合も、その後で人物を描き足すため、GLBの露出は人物へ掛けない。BloomとDoFは線形色で処理し、彩度・コントラストは表示色へ変換してから適用する。既定では人物・アイコン・名札の印刷面を除外し、机による遮蔽を保って最後に描く。AO・SSR・SSGIへの人物の参加は、この設定とは別であり変更しない。

Bloomのしきい値は、モデルの光量の単位ではなく露出補正後の線形輝度とする。透明背景を不透明な黒に変えない。DoFはカメラの奥行き方向で人物を測り、2人を撮る場合は両方を鮮明な範囲へ含める。人物の少し後ろへ焦点を置く設定、固定距離、許容範囲、ぼけの強さと最大半径を用意する。

新しい版で保存済み映像を勝手に変えないよう、初期値は色調整なし・Bloom/DoF無効とする。「自然な仕上げ」プリセットで控えめな色調整・Bloom・DoFをまとめて有効にできる。発話の緑色グローは独立した設定で、太さを旧版の4倍にする。

天板は白い外周と木の内周を重ねる構造を廃止し、単一の木調リングにする。色を濃くし、低い粗さとクリアコートを設定する。短い名前は字形の横方向倍率を1.1倍までとし、残る幅を字間で埋める。1文字は中央配置とする。長い名前は高さを保って必要なだけ幅を圧縮し、省略しない。絵文字や結合文字は書記素単位で扱う。

## 検証条件

人物除外時のRGB一致、含めた際の色調整、しきい値によるBloomの差、焦点内外の輪郭比較、透明背景、深度遮蔽、保存と復元、設定変更でのカメラ・席の維持を確認する。実OBSの性能と任意GLBでの見た目は、自動テストの成功とは分けて扱う。

## 確認した既存実装

- https://threejs.org/docs/pages/UnrealBloomPass.html
- https://github.com/mrdoob/three.js/blob/r187/examples/jsm/shaders/BokehShader.js
- https://github.com/mrdoob/three.js/blob/r187/examples/jsm/shaders/HueSaturationShader.js
- https://github.com/mrdoob/three.js/blob/r187/examples/jsm/shaders/BrightnessContrastShader.js
- https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/OutputPass.js
