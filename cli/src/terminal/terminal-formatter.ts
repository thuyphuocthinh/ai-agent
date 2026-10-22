import { ApprovalData } from './terminal-chat.types';

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',

  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
  bgDark: '\x1b[40m',
};

function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}... [truncated]`;
}

function stringifyData(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && 'preview' in (val as Record<string, unknown>)) {
    const preview = (val as { preview: unknown }).preview;
    return typeof preview === 'string' ? preview : JSON.stringify(preview);
  }
  return JSON.stringify(val);
}

export class TerminalFormatter {
  static color(colorCode: string, text: string): string {
    return `${colorCode}${text}${ANSI.reset}`;
  }

  static supervisor(label: string): string {
    return `\n${ANSI.brightCyan}${ANSI.bold}🎯 [Supervisor]${ANSI.reset} ${ANSI.cyan}${label}${ANSI.reset}\n`;
  }

  static agent(role: string, goal?: string): string {
    const goalText = goal ? ` — ${ANSI.dim}${goal}${ANSI.reset}` : '';
    return `\n${ANSI.brightGreen}${ANSI.bold}🤖 [Agent: ${role}]${ANSI.reset}${goalText}\n`;
  }

  static toolCall(toolName: string, input: unknown, friendlySummary?: string): string {
    const title = friendlySummary ? `${ANSI.yellow}${friendlySummary}${ANSI.reset} (${ANSI.dim}${toolName}${ANSI.reset})` : `${ANSI.yellow}${toolName}${ANSI.reset}`;
    const argsStr = truncate(stringifyData(input), 160);
    return `  ${ANSI.yellow}🔧 [Tool]${ANSI.reset} ${title}\n  ${ANSI.dim}   ↳ input: ${argsStr}${ANSI.reset}\n`;
  }

  static toolResult(toolName: string, output: unknown, isError = false): string {
    const outStr = truncate(stringifyData(output), 240);
    if (isError) {
      return `  ${ANSI.brightRed}❌ [Tool Error]${ANSI.reset} ${ANSI.red}${toolName} -> ${outStr}${ANSI.reset}\n`;
    }
    return `  ${ANSI.green}📋 [Result]${ANSI.reset} ${ANSI.dim}${toolName} -> ${outStr}${ANSI.reset}\n`;
  }

  static approvalBox(data: ApprovalData): string {
    const tool = data.toolName || data.tool || 'Unknown Tool';
    const summary = data.friendlySummary || data.summary || data.preview || 'Hành động yêu cầu xác nhận trước khi thực hiện';
    const rawArgs = data.args || data.parameters ? JSON.stringify(data.args || data.parameters, null, 2) : '';

    const lines = [
      '',
      `${ANSI.brightYellow}╔═══════════════════════════════════════════════════════════════════╗${ANSI.reset}`,
      `${ANSI.brightYellow}║ ⚠️  [WRITE GUARD] CẦN PHÊ DUYỆT HÀNH ĐỘNG RỦI RO                   ║${ANSI.reset}`,
      `${ANSI.brightYellow}╠═══════════════════════════════════════════════════════════════════╣${ANSI.reset}`,
      `  ${ANSI.bold}Công cụ  :${ANSI.reset} ${ANSI.brightCyan}${tool}${ANSI.reset}`,
      `  ${ANSI.bold}Chi tiết :${ANSI.reset} ${summary}`,
    ];

    if (rawArgs) {
      lines.push(`  ${ANSI.bold}Tham số  :${ANSI.reset} ${ANSI.dim}${rawArgs.split('\n').join('\n             ')}${ANSI.reset}`);
    }

    lines.push(
      `${ANSI.brightYellow}╚═══════════════════════════════════════════════════════════════════╝${ANSI.reset}`,
      '',
    );

    return lines.join('\n');
  }

  static error(msg: string): string {
    return `\n${ANSI.brightRed}❌ ${msg}${ANSI.reset}\n`;
  }

  static info(msg: string): string {
    return `${ANSI.blue}ℹ ${msg}${ANSI.reset}`;
  }

  static header(): string {
    return [
      `${ANSI.brightCyan}====================================================${ANSI.reset}`,
      `${ANSI.brightCyan}🤖 Agents CLI — Interactive AI Orchestration Console${ANSI.reset}`,
      `${ANSI.brightCyan}====================================================${ANSI.reset}`,
      `${ANSI.dim}Connected to Core Engine. Type "/help" for commands, "exit" to quit.${ANSI.reset}\n`,
    ].join('\n');
  }
}
