import { ServerResponse } from 'http';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApproveRequestDto,
  ChatRequestDto,
  HistoryQueryDto,
  HistoryResponseDto,
  IPendingApprovalDto,
  CursorPaginationQueryDto,
  CursorPageMetaDto,
  PaginatedResult,
  ConversationItemDto,
  StreamReconnectQueryDto,
} from '../dtos';
import { BypassTransform } from '../decorators/bypass-transform.decorator';
import { ChatService } from '../../application/chat.service';
import { UiStreamPresenter } from '../presenters/ui-stream.presenter';

/**
 * Controller tiếp nhận yêu cầu tương tác với AI Agent Engine từ Client (CLI, Web Playground).
 * Phản hồi stream theo chuẩn Vercel AI UI Message Stream (SSE).
 */
@ApiTags('Chat Engine')
@Controller('api')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly streamPresenter: UiStreamPresenter,
  ) {}

  @Post('chat')
  @BypassTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi chỉ thị hội thoại tới AI Agent Engine',
    description:
      'Khởi tạo lượt chat và stream kết quả về client theo chuẩn Vercel AI UI Message Stream (SSE).',
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'UI Message Stream (SSE)' })
  @ApiBadRequestResponse({ description: 'Dữ liệu prompt không hợp lệ hoặc thiếu thông tin' })
  async chat(@Body() dto: ChatRequestDto, @Res() res: ServerResponse): Promise<void> {
    const turn = await this.chatService.chat(dto);
    await this.streamPresenter.pipe(res, turn);
  }

  @Post('approve')
  @BypassTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Phê duyệt hoặc từ chối hành động rủi ro (HITL Write Guard)',
    description:
      'Xử lý quyết định phê duyệt và tiếp tục stream các bước thực thi tiếp theo.',
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'UI Message Stream tiếp nối sau khi duyệt' })
  @ApiBadRequestResponse({ description: 'Hành động duyệt hoặc ID không hợp lệ' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy session hoặc message checkpoint yêu cầu duyệt' })
  async approve(@Body() dto: ApproveRequestDto, @Res() res: ServerResponse): Promise<void> {
    const effectiveCandidateId = dto.selectedCandidateId ?? dto.selectedProvider;
    const turn = effectiveCandidateId !== undefined
      ? await this.chatService.approve(
          dto.sessionId,
          dto.messageId,
          dto.action,
          effectiveCandidateId,
        )
      : await this.chatService.approve(dto.sessionId, dto.messageId, dto.action);
    await this.streamPresenter.pipe(res, turn);
  }

  @Get('stream')
  @BypassTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tái kết nối luồng stream thời gian thực (Stream Reconnection)',
    description:
      'Cho phép client re-attach vào SSE stream của một turn đang chạy ngầm sau khi reload trang hoặc rớt mạng.',
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'UI Message Stream tiếp diễn (SSE)' })
  @ApiBadRequestResponse({ description: 'sessionId hoặc messageId không hợp lệ' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy phiên làm việc' })
  async stream(
    @Query() query: StreamReconnectQueryDto,
    @Res() res: ServerResponse,
  ): Promise<void> {
    const turn = await this.chatService.reconnectStream(
      query.sessionId,
      query.messageId,
    );
    await this.streamPresenter.pipe(res, turn);
  }

  @Get('history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lấy lịch sử tin nhắn của phiên làm việc',
    description: 'Truy vấn các lượt hội thoại gần nhất trong phiên theo sessionId.',
  })
  @ApiOkResponse({
    type: HistoryResponseDto,
    description: 'Danh sách các lượt hội thoại gần nhất',
  })
  @ApiBadRequestResponse({ description: 'sessionId không phải là định dạng UUID' })
  async history(@Query() query: HistoryQueryDto): Promise<HistoryResponseDto> {
    const turns = await this.chatService.history(query.sessionId);
    const lastTurnApproval =
      turns.length > 0
        ? (turns[turns.length - 1].metadata?.approval as IPendingApprovalDto | undefined)
        : undefined;
    return new HistoryResponseDto(turns, lastTurnApproval);
  }

  @Get('conversations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lấy danh sách các cuộc trò chuyện gần nhất',
    description:
      'Truy vấn danh sách các phiên hội thoại được lưu trữ trong PostgreSQL với phân trang cursor.',
  })
  @ApiOkResponse({
    description: 'Danh sách các cuộc trò chuyện gần nhất kèm metadata phân trang con trỏ',
  })
  async conversations(
    @Query() query: CursorPaginationQueryDto,
  ): Promise<PaginatedResult<ConversationItemDto, CursorPageMetaDto>> {
    const result = await this.chatService.listConversations(query);
    return {
      data: result.data.map((item) => new ConversationItemDto(item)),
      meta: result.meta,
    };
  }
}
