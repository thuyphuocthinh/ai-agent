# Agent Core (`@agent/core`)

> Enterprise AI Agent Orchestration Engine.
> Supervisor-Worker + ReAct Loop + Human-in-the-Loop (HITL) Checkpoints + Dynamic Tool Ecosystem.

## Domain Modules

```
src/
├── engine/          # Core AI Engine (supervisor, orchestrator, loop, hitl, strategy, cancellation)
├── infrastructure/  # Database (TypeORM entities, migrations), Redis, BullMQ Queue
├── contracts/       # DTOs, IMessageSink, IStreamSink, AgentStreamService, MessageClientService
├── memory/          # MemoryManager, ChannelMemory, SkillService
├── security/        # PiiScrubber, security guards
├── common/          # CircuitBreaker, ConcurrencyLimiter, Metrics, HealthCheck
└── constants/       # Orchestration constants, model registry, error codes
```

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm migration:run
pnpm start:dev
```
