# ADR-0018: JSONハートビート、unlit合成、BLENDの影

- 日付: 2026-11-09
- 状態: 採用。実Discord認可の成否とは区別する。

DiscordのIPC制御フレームはdiscordjs/RPCのencodeとpingを確認し、PINGのUUIDをJSON文字列として送る。認可拒否と通信エラーは分け、診断は値を限定したメタデータだけとする。認証権限や第三者アプリの認可経路は拡張しない。

Three.js 0.187.0のGLTFLoader、Material、OutputPass、WebGLShadowMapを確認した。toneMapped=falseだけではレンダーターゲット全体への露出を除外できないため、インポートしたunlitを世界の露出後・スタジオの後処理前に別レイヤーで合成する。アバター除外とは独立させる。

MASKの深度判定は標準機能に任せる。BLENDの滑らかな表示を変えずPCFで輪郭を出すため、標準MeshDepthMaterial/MeshDistanceMaterialとonBeforeShadowを使い、影に限り0.5のしきい値を設定する。独自のglTF解釈、テクスチャ解決、影シェーダーは作らない。既存のカスタム深度材質は維持する。

この影は二値近似であり、透過率や色付き透過の物理計算ではない。unlitは測光およびAO・SSR・SSGIから外れる。ポスト効果と深度の合成、資源解放は画素試験と単体試験で検証する。添付素材は公開リポジトリやCIへアップロードしない。

参照:
- https://github.com/discordjs/RPC/blob/master/src/transports/ipc.js
- https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_unlit
- https://threejs.org/docs/pages/Material.html
- https://threejs.org/docs/pages/Mesh.html
- node_modules/three/src/renderers/webgl/WebGLShadowMap.js（依存固定r187）
