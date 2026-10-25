import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  IWorkflowRegistry,
  WORKFLOW_REGISTRY,
  WorkflowSummaryDto,
} from '../../../contracts';

@ApiTags('Workflow Engine')
@Controller('api/workflows')
export class WorkflowController {
  constructor(
    @Inject(WORKFLOW_REGISTRY)
    private readonly workflowRegistry: IWorkflowRegistry,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liệt kê danh sách các Fixed Workflows khả dụng trong hệ thống',
    description:
      'Trả về danh mục workflow định sẵn (tên, id, mô tả, danh sách công cụ) để giao diện hiển thị cho người dùng lựa chọn.',
  })
  @ApiOkResponse({
    description: 'Danh sách các workflows khả dụng',
    type: [WorkflowSummaryDto],
  })
  getWorkflows(): WorkflowSummaryDto[] {
    return this.workflowRegistry.list();
  }
}
