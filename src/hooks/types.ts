export interface HookInput {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  prompt?: string;
  user_input?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
  start_type?: string;
  end_type?: string;
  [key: string]: unknown;
}

export interface HookSpecificOutput {
  hookEventName: string;
  additionalContext?: string;
  permissionDecision?: 'allow' | 'deny' | 'ask';
  permissionDecisionReason?: string;
  decision?: 'allow' | 'block';
  reason?: string;
}

export interface HookOutput {
  continue?: boolean;
  decision?: 'block';
  reason?: string;
  systemMessage?: string;
  hookSpecificOutput?: HookSpecificOutput;
}

export type HookResult = HookOutput | undefined;
