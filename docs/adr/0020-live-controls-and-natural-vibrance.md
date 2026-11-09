# ADR 0020: 有効なカメラ設定、隣接2人構図、自然な彩度

## 判断

発話開始・終了確認・終了後猶予・主話者集計期間をStudioScene.directionへ保存し、SpeakerTrackerとShotDirectorが同じ値を参照する。短い無音と発話時間を分離し、固定値との二重待機を作らない。既存の画角・高さ・nearは削除せず、変更時に現在の撮影計画を作り直す。保存済みの明示値は新しい既定値で上書きしない。

座席の論理番号ではなく物理的な関係で隣接を判断する。共同司会または同じ長辺の隣の列は2人構図を優先し、分割対象から外す。共同司会の向きと名札は曲面の法線から分離する。既存のThree.js PerspectiveCameraによる投影とRay/Box3による可視性検査を使う。

## Three.jsの既存機能を先に確認した結果

使用版はThree.js 0.187.0。src/nodes/display/ColorAdjustment.jsにはTSLのvibranceがあるが、現在のWebGLRenderer/ShaderPassへそのまま渡せるWebGL用VibranceShaderは同梱されていない。既存のHueSaturationShaderは一様な彩度調整である。TSLへの移行はレンダラーと既存の深度・透過・人物除外の処理まで変更するため、この修正では採用しない。

自然な彩度の要件は、低彩度を優先し高彩度の増加を抑えること。明るさからの色差に対し、増加側だけ(1-saturation)^2で利得を弱め、RGBが0〜1に収まる範囲へ制限する小さいWebGLパスを採用した。下げる側は0まで連続に無彩色へ近づける。透明度と人物除外を維持し、Adobeとの画素一致や肌色保護は主張しない。

公式資料: https://threejs.org/docs/pages/TSL のvibrance、および https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/adjust-color-saturation-using-vibrance-adjustment.html 。ピン留めされたThree.jsの実装と既存ShaderPassも直接確認した。

## チャット

起動前の会話を自動で読み直さない。時刻の境界はFeedの生存期間に固定し、GET_CHANNELの履歴と遅延したCREATE/UPDATEの両方へ適用する。再接続時に境界を進めると起動後の取りこぼしも失うため、その方法は採用しない。

## 検証

既定値と境界時刻、短い休止、設定変更時の集計、共同司会・同じ長辺・対向席、名札の非交差と天板内配置、CPU/GPUの彩度、除外中の人物色、古い投稿の再出現防止、チェックボックスと読み込みボタンの整列を試験する。模擬入力と実Discord/OBSの確認を区別する。
