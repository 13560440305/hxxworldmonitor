import { HXXBOT_TOOLS, invokeHxxbotTool } from '../_shared/hxxbot-client.js';

export interface QaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface QaSessionInput {
  /** Single-turn shortcut */
  question?: string;
  /** Multi-turn chat history */
  messages?: QaMessage[];
  /** Optional model id (auto if omitted) */
  model_id?: string;
}

export interface QaSessionOutput {
  answer: string;
  model_id?: string;
  raw: Record<string, unknown>;
}

function normalizeMessages(messages: QaMessage[]): QaMessage[] {
  return messages
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? '').trim(),
    }))
    .filter((m) => m.content && ['system', 'user', 'assistant'].includes(m.role));
}

function extractAnswer(output: Record<string, unknown>): string {
  const candidates = [
    output.answer,
    output.content,
    output.response,
    output.text,
    output.message,
    output.reply,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  if (Array.isArray(output.messages)) {
    for (let i = output.messages.length - 1; i >= 0; i -= 1) {
      const msg = output.messages[i] as Record<string, unknown> | undefined;
      if (msg?.role === 'assistant' && typeof msg.content === 'string' && msg.content.trim()) {
        return msg.content.trim();
      }
    }
  }
  return '';
}

/**
 * AI Q&A via builtin.qa_session — Open API docs: input.question or input.messages.
 */
export async function runQaSession(input: QaSessionInput): Promise<QaSessionOutput> {
  const toolInput: Record<string, unknown> = {};
  const modelId = String(input.model_id ?? '').trim();
  if (modelId && modelId !== 'auto' && modelId !== '0') {
    toolInput.model_id = modelId;
  }

  if (input.messages?.length) {
    const messages = normalizeMessages(input.messages);
    if (!messages.length) throw new Error('messages must not be empty');
    toolInput.messages = messages;
  } else {
    const question = String(input.question ?? '').trim();
    if (!question) throw new Error('question or messages is required');
    toolInput.question = question;
  }

  const output = await invokeHxxbotTool(HXXBOT_TOOLS.QA_SESSION, toolInput);
  const answer = extractAnswer(output);
  if (!answer) {
    throw new Error('qa_session returned empty answer');
  }

  return {
    answer,
    model_id:
      output.model_id != null
        ? String(output.model_id)
        : output.model != null
          ? String(output.model)
          : undefined,
    raw: output,
  };
}
