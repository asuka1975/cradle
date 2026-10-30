// regen-core — regen-impact の読み方。生成 .kt の宣言の読み取り（declsOf）、ファイルごとの変わった宣言（diffDecls）、手書きの参照元（impactOf）
// （再生成・git・ファイルの読み込み・出力は regen-impact.mjs）。どれも文字列を受けて値を返すだけで、ファイルもプロセスも触らない。

const TYPE_DECL = /^(?:public\s+|internal\s+|private\s+)?(?:abstract\s+|open\s+|sealed\s+|data\s+|value\s+|enum\s+|annotation\s+)*(interface|class|object|typealias)\s+`?([A-Za-z_][\w]*)`?/;
const MEMBER_DECL = /^\s+(?:override\s+|abstract\s+|open\s+|suspend\s+|operator\s+|infix\s+|inline\s+|public\s+|internal\s+|protected\s+)*(fun|val|var)\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.]*\.)?`?([A-Za-z_][\w]*)`?/;
const TOP_FUN = /^(?:public\s+|internal\s+|private\s+)?(?:inline\s+|suspend\s+)*(fun|val|var)\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.]*\.)?`?([A-Za-z_][\w]*)`?/;
/** 宣言の一覧: {key, name, owner, kind, sig}。sig（署名行）が一致すれば同じ宣言とみなす。 */
export function declsOf(text) {
  const out = new Map();
  let owner = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    let m = line.match(TYPE_DECL);
    if (m) { owner = m[2]; out.set(`type:${m[2]}`, { name: m[2], owner: null, kind: m[1], sig: line.trim() }); continue; }
    m = line.match(TOP_FUN);
    if (m) { out.set(`top:${m[2]}`, { name: m[2], owner: null, kind: m[1], sig: line.trim() }); continue; }
    m = line.match(MEMBER_DECL);
    if (m && owner) out.set(`member:${owner}.${m[2]}:${line.trim()}`, { name: m[2], owner, kind: m[1], sig: line.trim() });
  }
  return out;
}

/** 1 ファイルの変わった宣言 = 署名行が片方にしか無いもの（名前が同じでも署名が変われば「変更」）: [{ name, owner, kind, sig, change }]。
    change は changed（同じ所有者・名前が後にもある）・removed・added。前に無かった名前だけを added にする。 */
export function diffDecls(beforeText, afterText) {
  const before = declsOf(beforeText), after = declsOf(afterText);
  const sigOf = (m) => new Set([...m.values()].map(d => `${d.owner ?? ""}|${d.name}|${d.sig}`));
  const sb = sigOf(before), sa = sigOf(after);
  const touched = [];
  for (const d of before.values()) if (!sa.has(`${d.owner ?? ""}|${d.name}|${d.sig}`)) touched.push({ ...d, change: [...after.values()].some(x => x.name === d.name && x.owner === d.owner) ? "changed" : "removed" });
  for (const d of after.values()) if (!sb.has(`${d.owner ?? ""}|${d.name}|${d.sig}`) && ![...before.values()].some(x => x.name === d.name && x.owner === d.owner)) touched.push({ ...d, change: "added" });
  return touched;
}

/** 参照元: 型はその名前で、メンバーは「所有する型を参照し、かつその名前を呼ぶ／実装する」ファイルで探す。
    symbols は { name, owner, change, files } の並び、handTexts は { file, text } の並び。参照元の多い順、同数なら名前順に並べて返す。 */
export function impactOf(symbols, handTexts) {
  const impact = [];
  for (const e of symbols) {
    const nameRe = new RegExp(`\\b${e.name}\\b`);
    const refs = e.owner
      ? handTexts.filter(h => new RegExp(`\\b${e.owner}\\b`).test(h.text) && new RegExp(`(\\.|\\bfun\\s+|\\bval\\s+|\\bvar\\s+)${e.name}\\b`).test(h.text)).map(h => h.file)
      : handTexts.filter(h => nameRe.test(h.text)).map(h => h.file);
    impact.push({ symbol: e.owner ? `${e.owner}.${e.name}` : e.name, kinds: [e.change], generatedFiles: [...e.files], referencedBy: refs });
  }
  return impact.sort((a, b) => b.referencedBy.length - a.referencedBy.length || a.symbol.localeCompare(b.symbol));
}
