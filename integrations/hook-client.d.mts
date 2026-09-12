export interface HookResult {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    permissionDecision?: "deny" | "ask";
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
}
export function callHook(mode: "pre-guard" | "post-edit" | "post-bash" | "stop", payload: {
  cwd: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  agent_type?: string;
}): Promise<HookResult | null>;
export function reminder(result: HookResult | null): string | undefined;
export function checkAll(root: string): Promise<string | null>;
