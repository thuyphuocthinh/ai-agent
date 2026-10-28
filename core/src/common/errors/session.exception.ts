import {
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

/**
 * Lỗi khi không tìm thấy phiên hội thoại (404)
 */
export class ChatSessionNotFoundException extends NotFoundException {
  public readonly isDomainException = true;
  public readonly code = 'CHAT_SESSION_NOT_FOUND';
  public readonly statusCode = HttpStatus.NOT_FOUND;
  public readonly isOperational = true;
  public readonly userFriendlyMessage =
    'Phiên làm việc không tồn tại hoặc đã hết hạn.';
  public readonly details?: Record<string, unknown>;

  constructor(sessionId: string) {
    super({
      message: `Không tìm thấy phiên làm việc: ${sessionId}`,
      code: 'CHAT_SESSION_NOT_FOUND',
      userFriendlyMessage: 'Phiên làm việc không tồn tại hoặc đã hết hạn.',
      sessionId,
    });
    this.details = { sessionId };
  }
}

/**
 * Lỗi khi tham số tái kết nối stream không hợp lệ (400)
 */
export class StreamReconnectInvalidException extends BadRequestException {
  public readonly isDomainException = true;
  public readonly code = 'STREAM_RECONNECT_INVALID';
  public readonly statusCode = HttpStatus.BAD_REQUEST;
  public readonly isOperational = true;
  public readonly userFriendlyMessage: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super({
      message,
      code: 'STREAM_RECONNECT_INVALID',
      userFriendlyMessage: message,
      details,
    });
    this.userFriendlyMessage = message;
    this.details = details;
  }
}

/**
 * Lỗi khi không tìm thấy yêu cầu duyệt trong phiên (404)
 */
export class ApprovalRequestNotFoundException extends NotFoundException {
  public readonly isDomainException = true;
  public readonly code = 'APPROVAL_REQUEST_NOT_FOUND';
  public readonly statusCode = HttpStatus.NOT_FOUND;
  public readonly isOperational = true;
  public readonly userFriendlyMessage =
    'Yêu cầu phê duyệt không tồn tại hoặc đã được xử lý trước đó.';
  public readonly details?: Record<string, unknown>;

  constructor(messageId: string) {
    super({
      message: `Không tìm thấy yêu cầu phê duyệt cho tin nhắn: ${messageId}`,
      code: 'APPROVAL_REQUEST_NOT_FOUND',
      userFriendlyMessage:
        'Yêu cầu phê duyệt không tồn tại hoặc đã được xử lý trước đó.',
      messageId,
    });
    this.details = { messageId };
  }
}
