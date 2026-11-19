export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'

export interface TextBlock { type: 'text'; text: string }
export interface ThinkingBlock { type: 'thinking'; thinking: string }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content?: string | ContentBlock[]; is_error?: boolean }
export interface ImageBlock { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
export interface DocumentBlock { type: 'document'; source: { type: 'base64'; media_type: string; data: string }; title?: string }
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | ImageBlock | DocumentBlock

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface ModelUsage { costUSD: number; contextWindow: number }

export interface InitLine {
  type: 'system'
  subtype: 'init'
  session_id: string
  cwd: string
  model: string
  permissionMode: PermissionMode
  tools: string[]
  claude_code_version: string
  slash_commands?: string[]
  skills?: string[]
}

export interface StatusLine { type: 'system'; subtype: 'status'; status: 'requesting' | 'compacting' | null; permissionMode?: PermissionMode }

export interface AssistantLine {
  type: 'assistant'
  message: { id: string; model: string; content: ContentBlock[]; usage?: Usage }
  parent_tool_use_id: string | null
  uuid?: string
  timestamp?: string
  error?: string
}

export interface UserLine {
  type: 'user'
  message: { role: 'user'; content: string | ContentBlock[] }
  parent_tool_use_id: string | null
  uuid?: string
  timestamp?: string
}

export interface StreamEventLine {
  type: 'stream_event'
  parent_tool_use_id: string | null
  event: { type: string; delta?: { type: string; text?: string; thinking?: string } }
}

export interface ResultLine {
  type: 'result'
  subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'
  session_id: string
  is_error: boolean
  duration_ms: number
  num_turns: number
  total_cost_usd?: number
  usage: Usage
  modelUsage?: Record<string, ModelUsage>
  result?: string
  errors?: string[]
}

export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  resetsAt?: number
  rateLimitType?: string
  utilization?: number
  surpassedThreshold?: number
  isUsingOverage?: boolean
  overageStatus?: string
  unifiedWindows?: Record<string, { utilization: number; resetsAt: number; status: string; surpassedThreshold?: number }>
}

export interface RateLimitLine { type: 'rate_limit_event'; rate_limit_info: RateLimitInfo }

export interface CanUseTool {
  subtype: 'can_use_tool'
  tool_name: string
  input: Record<string, unknown>
  tool_use_id: string
  permission_suggestions?: PermissionUpdate[]
  description?: string
  decision_reason?: string
  agent_id?: string
}

export interface ControlRequestLine { type: 'control_request'; request_id: string; request: { subtype: string } | CanUseTool }
export interface ControlCancelLine { type: 'control_cancel_request'; request_id: string }
export interface ControlResponseLine {
  type: 'control_response'
  response: { subtype: 'success' | 'error'; request_id: string; response?: Record<string, unknown>; error?: string }
}

export type Line =
  | InitLine
  | StatusLine
  | AssistantLine
  | UserLine
  | StreamEventLine
  | ResultLine
  | RateLimitLine
  | ControlRequestLine
  | ControlCancelLine
  | ControlResponseLine

/** An attached file as the API takes it: an image, a PDF (`document`), or a text file inlined. */
export type Attachment =
  | { kind: 'image'; mediaType: string; data: string }
  | { kind: 'document'; name: string; data: string }
  | { kind: 'text'; name: string; text: string }

/** One of the CLI's `permission_suggestions`, handed back as `updatedPermissions` to keep the rule. */
export type PermissionUpdate =
  | { type: 'addRules' | 'replaceRules' | 'removeRules'; rules: { toolName: string; ruleContent?: string }[]; behavior: string; destination: string }
  | { type: 'setMode'; mode: PermissionMode; destination: string }
  | { type: 'addDirectories' | 'removeDirectories'; directories: string[]; destination: string }

const line = (o: object) => JSON.stringify(o)

const request = (request: object) => line({ type: 'control_request', request_id: crypto.randomUUID(), request })

const respond = (requestId: string, response: object) =>
  line({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })

const FILE_HEADER = /^Attached file (.+):\n/

/** A text file inlined as its own text block: a fenced body under a header naming the file. */
export function fileText(name: string, text: string) {
  const fence = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map(run => run.length + 1)))
  return `Attached file ${name}:\n${fence}\n${text}\n${fence}`
}

/** The file name of a block `fileText` made. */
export const attachedName = (text: string) => FILE_HEADER.exec(text)?.[1]

function block(a: Attachment) {
  if (a.kind === 'image') return { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } }
  if (a.kind === 'document') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name }
  return { type: 'text', text: fileText(a.name, a.text) }
}

export function userMessage(text: string, attachments: Attachment[] = []) {
  // The API refuses an empty text block: a message of attachments alone carries none.
  const content = attachments.length ? [...attachments.map(block), ...(text ? [{ type: 'text', text }] : [])] : text
  return line({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null })
}

export const allow = (requestId: string, updatedInput?: Record<string, unknown>, updatedPermissions?: PermissionUpdate[]) =>
  respond(requestId, { behavior: 'allow', ...(updatedInput && { updatedInput }), ...(updatedPermissions?.length && { updatedPermissions }) })

export const answer = (requestId: string, input: Record<string, unknown>, answers: Record<string, string>) =>
  allow(requestId, { ...input, answers })

export const deny = (requestId: string, message: string) => respond(requestId, { behavior: 'deny', message })

export const interrupt = () => request({ subtype: 'interrupt' })

export const initialize = () => request({ subtype: 'initialize' })

export const setPermissionMode = (mode: PermissionMode) => request({ subtype: 'set_permission_mode', mode })

export const setModel = (model?: string) => request({ subtype: 'set_model', model })
