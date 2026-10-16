import { Injectable, Logger } from '@nestjs/common';
import * as readline from 'readline';
import { IMessageSink } from '@agent/core/contracts';
import { IStreamSink, AgentStreamContext, AgentStreamStep } from '@agent/core/contracts';
import {
  ChatHistoryTurnDto,
  CreateOrchestrationMessageRequestDto,
  CreateOrchestrationMessageResponseDto,
  GetMessageTextRequestDto,
  GetRecentHistoryRequestDto,
  UpdateOrchestrationMessageRequestDto,
} from '@agent/core/dto/message-client.dto';
import { EMessageRole } from '@agent/core/constants';

export interface CliServiceOptions {
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
}

@Injectable()
export class CliService implements IMessageSink, IStreamSink {
  private readonly logger = new Logger(CliService.name);
  private readonly messages = new Map<string, string>();
  private readonly history: ChatHistoryTurnDto[] = [];
  private messageCounter = 0;

  private inputStream: NodeJS.ReadableStream;
  private outputStream: NodeJS.WritableStream;

  constructor(options?: CliServiceOptions) {
    this.inputStream = options?.inputStream || process.stdin;
    this.outputStream = options?.outputStream || process.stdout;
  }

  // --- IMessageSink Implementation ---

  async getMessageText(dto: GetMessageTextRequestDto): Promise<string> {
    return this.messages.get(dto.id) || '';
  }

  async getRecentHistory(dto: GetRecentHistoryRequestDto): Promise<ChatHistoryTurnDto[]> {
    const limit = dto.limit || 10;
    return this.history.slice(-limit);
  }

  async createMessage(
    dto: CreateOrchestrationMessageRequestDto,
  ): Promise<CreateOrchestrationMessageResponseDto> {
    const id = `cli-msg-${++this.messageCounter}`;
    const text = typeof dto.content === 'string' ? dto.content : JSON.stringify(dto.content);
    this.messages.set(id, text);

    this.history.push({
      role: EMessageRole.MODEL,
      text,
    });

    this.outputStream.write(`\n🤖 Agent: ${text}\n`);
    return { id };
  }

  async updateMessage(dto: UpdateOrchestrationMessageRequestDto): Promise<void> {
    const text = typeof dto.content === 'string' ? dto.content : JSON.stringify(dto.content);
    this.messages.set(dto.id, text);
    this.outputStream.write(`\n🤖 Agent [Update]: ${text}\n`);
  }

  async tryUpdateMessage(dto: UpdateOrchestrationMessageRequestDto): Promise<void> {
    try {
      await this.updateMessage(dto);
    } catch (err: any) {
      this.logger.warn(`Failed to update CLI message: ${err?.message}`);
    }
  }

  // --- IStreamSink Implementation ---

  async emitStep(context: AgentStreamContext, step: AgentStreamStep): Promise<void> {
    switch (step.type) {
      case 'tool_call':
        this.outputStream.write(
          `\n🔧 [Tool Call] ${step.tool || 'unknown'}(${step.argsPreview || ''})\n`,
        );
        break;
      case 'tool_result':
        this.outputStream.write(
          `\n📋 [Tool Result] ${step.tool || 'unknown'} -> ${step.resultPreview || 'success'}\n`,
        );
        break;
      case 'step_start':
        this.outputStream.write(`\n⚡ [Step] ${step.label || 'Processing...'}\n`);
        break;
      case 'done':
        this.outputStream.write(`\n✅ [Done]\n`);
        break;
      case 'token':
        if (step.text) {
          this.outputStream.write(step.text);
        }
        break;
      default:
        break;
    }
  }

  async emitToken(context: AgentStreamContext, token: string): Promise<void> {
    this.outputStream.write(token);
  }

  async flush(): Promise<void> {
    this.outputStream.write('\n');
  }

  // --- Interactive HITL & REPL ---

  async askHumanApproval(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: this.inputStream,
        output: this.outputStream,
      });

      this.outputStream.write(
        `\n⚠️  [HITL Approval Required] Agent requests execution of high-risk tool: "${toolName}"\n`,
      );
      this.outputStream.write(`   Parameters: ${JSON.stringify(args, null, 2)}\n`);

      rl.question('   Approve execution? [y/N]: ', (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        const approved = trimmed === 'y' || trimmed === 'yes';
        resolve(approved);
      });
    });
  }

  async promptUser(query: string = 'User> '): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: this.inputStream,
        output: this.outputStream,
      });

      rl.question(query, (answer) => {
        rl.close();
        const text = answer.trim();
        if (text) {
          this.history.push({
            role: EMessageRole.USER,
            text,
          });
        }
        resolve(text);
      });
    });
  }
}
