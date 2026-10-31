// unslop-report — unslop の error を差し戻しの文面にまとめる。Stop hook（hook.mjs）とハーネスの統合（integrations/hook-client.mjs）が同じ文面を使う。
// import を持たない（統合が文面のために lib の child_process / crypto まで読まずに済む）。

/** findings のうち error の要約: lead(件数) の行、先頭 15 件、16 件目からは full（全件を出すコマンド）の案内。error が無ければ null。 */
export function unslopErrorSummary(findings, { lead, full }) {
  const errors = findings.filter(f => f.severity === "error");
  if (!errors.length) return null;
  const lines = errors.slice(0, 15).map(f => `- ${f.file}:${f.line} [${f.rule}] ${f.message}`).join("\n");
  return `${lead(errors.length)}\n${lines}${errors.length > 15 ? `\n…（${full} で全件）` : ""}`;
}
