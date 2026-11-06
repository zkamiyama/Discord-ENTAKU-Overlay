# ADR-0005: 制作機能を仕上げ、実装と実機検証を分けて公開する

- 状態: 採用
- 日付: 2026-11-06

## 決定

残作業をスタジオ、画像アバター、診断・再生、配布の単位に分け、各単位でテストしてコミットする。操作画面は引き続きDockとする。

スタジオの解釈にはインストール済みThree.js 0.187.0のGLTFLoaderを使う。関連ファイルの読み込み先はLoadingManager.setURLModifierで、明示的にインポートした素材へ対応付ける。Draco、KTX2、Meshoptは公式addonsと同梱デコーダーを使う。独自のモデルデコーダーは作らない。

カメラの障害物検査はThree.jsのBox3、Ray、Matrix4を利用する。モデルの見た目と、撮影を避ける簡単な領域をシーン定義で分ける。読込失敗や有効な撮影位置がない場合は、スタジオを隠した標準ワイドを使用する。どんなGLBでも自動的に撮影経路が見つかるとは扱わない。

カスタム画像は正面と任意の背面を持ち、顔座標で大きさをそろえる。編集のプレビューと配信中の状態を分ける。画像の占有幅が広がる場合は席間隔を拡げ、退出だけでは縮めない。

初版の配布物はWindows x64の単独exeと説明・ライセンス・ソースを含むZIPにする。認可は利用者が明示的に開始する。実Discordの認可やOBS操作を自動テストの成功と同一視しない。署名、配布認証経路の許諾、実通話とOBSの長時間試験が残る間はリリース候補と表記する。

## 既存APIの確認

2026-11-06に公式ドキュメントとnode_modules内の同版実装を確認した。

- https://threejs.org/docs/pages/GLTFLoader.html
- https://threejs.org/docs/pages/LoadingManager.html
- https://threejs.org/docs/pages/Box3.html
- https://threejs.org/docs/pages/Raycaster.html

パス検査、内容ハッシュ、永続化、認証、ZIPの展開上限はThree.jsの役割ではないため、アプリで実装する。
