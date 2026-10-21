import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ChatRequestDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'prompt không được để trống' })
  prompt: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

export class ApproveRequestDto {
  @IsUUID()
  sessionId: string;

  @IsUUID()
  messageId: string;

  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';
}

export class HistoryQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
