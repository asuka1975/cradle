/*
  モックアップとフロントエンドの dev から Lean を呼ぶ口（mockup-build が lean.js の末尾に足す）。

    const lean = await createCradleLean();
    const responseText = await lean(requestText);   // Lean の CLI の stdin と stdout と同じ文字列

  ドメインの判断は Lean の handle だけが持つ。ここは文字列の受け渡しと、止まった wasm の作り直しだけ。
*/
(function (root) {
  const factory = createCradleLeanModule;
  // CLI の stdin に渡るのと同じ UTF-8 にする（単独サロゲートは U+FFFD）。長さも実際のバイト列から取る
  const encoder = new TextEncoder();
  async function open() {
    const m = await factory();
    if (m._cradle_init() !== 0) throw new Error("Lean の初期化に失敗しました");
    return m;
  }
  root.createCradleLean = async function createCradleLean() {
    let m = await open();
    return async function lean(requestText) {
      if (!m) m = await open();
      try {
        const bytes = encoder.encode(requestText);
        const req = BigInt(m._malloc(BigInt(bytes.length + 1)));   // 0 バイトでも NULL と紛れないように 1 足す。_malloc は Number を返し、_cradle_call は BigInt を受ける
        if (!req) throw new Error("リクエストを置くメモリが足りません");
        m.HEAPU8.set(bytes, Number(req));                  // _malloc でメモリが伸びると作り直されるので、そのあとで読む
        const res = m._cradle_call(req, BigInt(bytes.length));
        m._free(req);
        if (!res) throw new Error("応答を置くメモリが足りません");
        const text = m.UTF8ToString(Number(res));
        m._free(res);
        return text;
      } catch (e) {
        // スタックの溢れやメモリ不足で止まったインスタンスは使い回さない。プロトコルエラーの形で返し、次の呼び出しで作り直す
        m = null;
        return JSON.stringify({ error: `Lean の wasm が止まりました: ${e && e.message ? e.message : e}` });
      }
    };
  };
})(globalThis);
