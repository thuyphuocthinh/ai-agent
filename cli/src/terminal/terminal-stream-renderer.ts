import { ApprovalData, PersonaData, StatusData, UiChunk } from './terminal-chat.types';
import { ANSI, TerminalFormatter } from './terminal-formatter';

export interface StreamRendererOptions {
  outStream?: NodeJS.WritableStream;
}

export class TerminalStreamRenderer {
  private readonly out: NodeJS.WritableStream;
  private hasPrintedTextHeader = false;
  private currentToolNames = new Map<string, string>();

  constructor(options?: StreamRendererOptions) {
    this.out = options?.outStream ?? process.stdout;
  }

  reset(): void {
    this.hasPrintedTextHeader = false;
    this.currentToolNames.clear();
  }

  async renderStream(
    chunks: AsyncIterable<UiChunk>,
    handleApproval?: (approval: ApprovalData) => Promise<'approve' | 'reject'>,
    onApprovedContinuation?: (action: 'approve' | 'reject', messageId: string) => Promise<AsyncIterable<UiChunk>>,
  ): Promise<void> {
    for await (const chunk of chunks) {
      const approvalData = await this.renderChunk(chunk);
      if (approvalData && handleApproval && onApprovedContinuation) {
        const action = await handleApproval(approvalData);
        const approvalId = approvalData.messageId || approvalData.id || '';
        const continuedStream = await onApprovedContinuation(action, approvalId);
        await this.renderStream(continuedStream, handleApproval, onApprovedContinuation);
        return;
      }
    }
  }

  async renderChunk(chunk: UiChunk): Promise<ApprovalData | null> {
    switch (chunk.type) {
      case 'data-status': {
        const status = chunk.data as StatusData | undefined;
        if (status?.label) {
          this.write(TerminalFormatter.supervisor(status.label));
        }
        break;
      }

      case 'data-persona': {
        const persona = chunk.data as PersonaData | undefined;
        if (persona?.role) {
          this.write(TerminalFormatter.agent(persona.role, persona.goal));
        }
        break;
      }

      case 'tool-input': {
        const toolName = chunk.toolName || 'tool';
        if (chunk.toolCallId) {
          this.currentToolNames.set(chunk.toolCallId, toolName);
        }
        const summary = chunk.title || chunk.toolMetadata?.friendlySummary;
        this.write(TerminalFormatter.toolCall(toolName, chunk.input, summary));
        break;
      }

      case 'tool-output': {
        const toolName = (chunk.toolCallId && this.currentToolNames.get(chunk.toolCallId)) || chunk.toolName || 'tool';
        this.write(TerminalFormatter.toolResult(toolName, chunk.output, false));
        break;
      }

      case 'tool-error': {
        const toolName = (chunk.toolCallId && this.currentToolNames.get(chunk.toolCallId)) || chunk.toolName || 'tool';
        this.write(TerminalFormatter.toolResult(toolName, chunk.errorText || 'Error', true));
        break;
      }

      case 'text-delta': {
        if (!this.hasPrintedTextHeader) {
          this.write(`\n${ANSI.bold}💬 Agent:${ANSI.reset} `);
          this.hasPrintedTextHeader = true;
        }
        const text = chunk.delta ?? chunk.text;
        if (text) {
          this.write(text);
        }
        break;
      }

      case 'data-resync': {
        const data = chunk.data as { text?: string } | undefined;
        if (data?.text) {
          this.write(`\n${ANSI.bold}💬 Agent (Updated):${ANSI.reset} ${data.text}\n`);
        }
        break;
      }

      case 'data-reply': {
        const reply = chunk.data as { text?: string } | undefined;
        if (reply?.text && !this.hasPrintedTextHeader) {
          this.write(`\n${ANSI.bold}💬 Agent:${ANSI.reset} ${reply.text}\n`);
          this.hasPrintedTextHeader = true;
        }
        break;
      }

      case 'data-approval': {
        const approval = chunk.data as ApprovalData;
        this.write(TerminalFormatter.approvalBox(approval));
        return approval;
      }

      case 'error': {
        this.write(TerminalFormatter.error(chunk.errorText || 'Unknown Core error occurred.'));
        break;
      }
    }

    return null;
  }

  private write(text: string): void {
    this.out.write(text);
  }
}
