# Agent Core

> Reusable AI orchestration engine — extracted from slack-be.
> Supervisor-Worker + ReAct Loop + HITL Approval + Dynamic Provider.

## Structure

```
src/
├── processor/     # TurnResolverRun, ReactLoopRun, Approval flow
├── llm/           # SupervisorService, ReactLoopService, LLM strategies
├── memory/        # ChannelMemory, SkillService, MemoryManager
├── checkpoint/    # HITL checkpoint persistence
├── cancellation/  # Stop/cancel turn (Redis)
├── executor/      # DynamicToolExecutor, PII scrubbing
├── registry/      # DynamicToolRegistry, OpenAI embedding
├── parser/        # OpenAPI spec parser + SSRF protection
├── mcp/           # McpClientService (static MCP agents)
├── mcp-auth/      # OAuth credential management
├── socket/        # AgentStreamService (realtime token streaming)
├── trigger-claim/ # Idempotency guard (dedup trigger)
├── common/        # CircuitBreaker, Metrics, HealthCheck
├── entity/        # TypeORM entities
├── dto/           # Data transfer objects
└── migrations/    # DB migrations
```

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm migration:run
pnpm start:dev
```

## Usage

See `src/interfaces/` for adapters: CLI, Telegram, HTTP, Slack.
See `src/runner/` for `AgentRunner` and `AgentWorkflowConfig`.
