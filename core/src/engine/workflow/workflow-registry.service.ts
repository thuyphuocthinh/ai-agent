import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  AgentWorkflowConfig,
  IWorkflowRegistry,
  WorkflowSummaryDto,
  createWorkflow,
} from '../../contracts';
import { BUILT_IN_WORKFLOWS } from './built-in-workflows.data';

@Injectable()
export class WorkflowRegistryService implements IWorkflowRegistry, OnModuleInit {
  private readonly logger = new Logger(WorkflowRegistryService.name);
  private readonly workflows = new Map<string, AgentWorkflowConfig>();

  onModuleInit(): void {
    this.registerBuiltInWorkflows();
  }

  register(workflow: AgentWorkflowConfig): void {
    const frozen = createWorkflow(workflow);
    this.workflows.set(frozen.id, frozen);
    this.logger.log(
      `Đã đăng ký workflow "${frozen.id}" (${frozen.name}) vào registry`,
    );
  }

  get(id: string): AgentWorkflowConfig | undefined {
    return this.workflows.get(id);
  }

  list(): WorkflowSummaryDto[] {
    return Array.from(this.workflows.values()).map((wf) => ({
      id: wf.id,
      name: wf.name,
      description: wf.description,
      tools: wf.tools ? [...wf.tools] : [],
    }));
  }

  has(id: string): boolean {
    return this.workflows.has(id);
  }

  private registerBuiltInWorkflows(): void {
    if (this.workflows.size > 0) return;

    BUILT_IN_WORKFLOWS.forEach((workflow) => this.register(workflow));

    this.logger.log(
      `Khởi tạo thành công ${this.workflows.size} workflows mặc định trong hệ thống`,
    );
  }
}
