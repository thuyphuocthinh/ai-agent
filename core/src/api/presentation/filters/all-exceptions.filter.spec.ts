import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ORCHESTRATION_ERROR } from '@agent/core/constants';
import {
  PromptInjectionDetectedError,
  BusinessPolicyViolationError,
  EscalationRequiredError,
} from '../../../security/errors';
import { BaseDomainException } from '../../../common/errors';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({
          url: '/api/test',
          method: 'GET',
          headers: { 'x-trace-id': 'test-trace-id' },
        }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('formats standard HttpException with status, code, and message', () => {
    const error = new NotFoundException('Resource not found');
    filter.catch(error, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'HTTP_404',
        message: 'Resource not found',
        path: '/api/test',
        traceId: 'test-trace-id',
      }),
    );
  });

  it('formats validation errors into code VALIDATION_ERROR and errors array', () => {
    const error = new BadRequestException({
      message: ['prompt không được để trống', 'sessionId phải là UUID'],
      error: 'Bad Request',
      statusCode: 400,
    });
    filter.catch(error, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(400);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        errors: ['prompt không được để trống', 'sessionId phải là UUID'],
      }),
    );
  });

  it('maps RpcException CHECKPOINT_NOT_FOUND to 404', () => {
    const error = new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_NOT_FOUND);
    filter.catch(error, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: ORCHESTRATION_ERROR.CHECKPOINT_NOT_FOUND.code,
      }),
    );
  });

  it('handles unexpected Error with 500 and sanitized message', () => {
    const error = new Error('Database password leaked in raw crash');
    filter.catch(error, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      }),
    );
  });

  describe('Polymorphic BaseDomainException Handling', () => {
    it('polymorphically formats PromptInjectionDetectedError with 400 and userFriendlyMessage', () => {
      const error = new PromptInjectionDetectedError('Chỉ thị vượt rào', 'high', 'ignore previous instructions');
      filter.catch(error, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'PROMPT_INJECTION_DETECTED',
          message: 'Yêu cầu không được chấp nhận do vi phạm quy tắc an toàn bảo mật.',
          errors: {
            reason: 'Chỉ thị vượt rào',
            riskLevel: 'high',
            matchedPattern: 'ignore previous instructions',
          },
          path: '/api/test',
          traceId: 'test-trace-id',
        }),
      );
    });

    it('polymorphically formats BusinessPolicyViolationError with 422 and policy details', () => {
      const error = new BusinessPolicyViolationError(
        'ORDER_REFUND_WINDOW_EXPIRED',
        'Đơn hàng giao quá 7 ngày không được hoàn tiền',
      );
      filter.catch(error, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(422);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 422,
          code: 'BUSINESS_POLICY_VIOLATION',
          message: 'Thao tác không hợp lệ theo chính sách: Đơn hàng giao quá 7 ngày không được hoàn tiền',
          errors: {
            policyRule: 'ORDER_REFUND_WINDOW_EXPIRED',
            explanation: 'Đơn hàng giao quá 7 ngày không được hoàn tiền',
          },
        }),
      );
    });

    it('polymorphically formats EscalationRequiredError with 403 and ticket details', () => {
      const error = new EscalationRequiredError(
        'Hoàn tiền vượt ngưỡng 2,000,000 VND',
        'TK-999',
        'Khách yêu cầu hoàn đơn 3.5 triệu',
        3500000,
      );
      filter.catch(error, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          code: 'EXCEEDS_AI_AUTHORITY',
          message: 'Yêu cầu cần được nhân viên hỗ trợ trực tiếp. Mã phiếu hỗ trợ của bạn là #TK-999.',
          errors: {
            ticketId: 'TK-999',
            reason: 'Hoàn tiền vượt ngưỡng 2,000,000 VND',
            handoverSummary: 'Khách yêu cầu hoàn đơn 3.5 triệu',
            requestedAmount: 3500000,
          },
        }),
      );
    });

    it('handles non-operational BaseDomainException by logging error while returning correct status', () => {
      class NonOperationalDomainException extends BaseDomainException {
        public readonly code = 'CRITICAL_DOMAIN_CORRUPTION';
        public readonly statusCode = 500;

        constructor() {
          super('Corrupted domain state', {
            isOperational: false,
            userFriendlyMessage: 'Hệ thống phát sinh trạng thái bất thường',
          });
        }
      }

      const error = new NonOperationalDomainException();
      filter.catch(error, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          code: 'CRITICAL_DOMAIN_CORRUPTION',
          message: 'Hệ thống phát sinh trạng thái bất thường',
        }),
      );
    });
  });
});
