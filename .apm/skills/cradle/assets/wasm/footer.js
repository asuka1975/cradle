/*
  モックアップとフロントエンドの dev から Lean を呼ぶ口（mockup-build が lean.js の末尾に足す）。

    const lean = await createCradleLean();
    const responseText = await lean(requestText);   // Lean の CLI の stdin と stdout と同じ文字列

  ドメインの判断は Lean の handle だけが持つ。ここは文字列の受け渡しと、止まった wasm の作り直しだけ。
*/
(function (root) {
  const factory = createCradleLeanModule;
  async function open() {
    const m = await factory();
    if (m._cradle_init() !== 0) throw new Error("Lean の初期化に失敗しました");
    return m;
  }
  root.createCradleLean = async function createCradleLean() {
    let m = await open();
    return async function lean(requestText) {
      if (!m) m = await open();
      const req = BigInt(m.stringToNewUTF8(requestText));
      try {
        const res = m._cradle_call(req);
        try { return m.UTF8ToString(Number(res)); } finally { m._free(res); }
      } catch (e) {
        // スタックの溢れなどで止まったインスタンスは使い回さない。プロトコルエラーの形で返し、次の呼び出しで作り直す
        m = null;
        return JSON.stringify({ error: `Lean の wasm が止まりました: ${e && e.message ? e.message : e}` });
      } finally {
        if (m) m._free(req);
      }
    };
  };
})(globalThis);
