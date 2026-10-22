import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ORCHESTRATION_ERROR } from '@agent/core/constants';

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
});
