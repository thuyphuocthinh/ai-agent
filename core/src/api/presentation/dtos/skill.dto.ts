import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateSkillDto {
  @ApiProperty({
    description: 'Unique slug identifier (kebab-case)',
    example: 'hotel-cancellation',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lower-case kebab-case (e.g. "hotel-cancellation")',
  })
  slug: string;

  @ApiProperty({
    description: 'Human-readable display title for the skill',
    example: 'Hotel Reservation Cancellation Policy',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({
    description:
      'Level 1 Catalog: Brief 1-2 sentence description explaining when the agent should use this skill (~20-30 tokens)',
    example:
      'Provides policies and step-by-step procedures to verify eligibility and execute hotel reservation cancellations.',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description:
      'Level 2 Playbook: Comprehensive Markdown instructions executed on demand',
    example:
      '# Hotel Cancellation Playbook\n\n1. Verify booking ID.\n2. Check cancellation refund window.\n3. Call refund tool.',
  })
  @IsString()
  @IsNotEmpty()
  instructions: string;

  @ApiPropertyOptional({
    description: 'Whitelist of allowed or recommended tool names for this skill',
    example: ['hotel_api_cancel_booking', 'payment_refund'],
    type: [String],
    default: [],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tools?: string[];

  @ApiPropertyOptional({
    description: 'Category tags for classification',
    example: ['hotel', 'booking', 'policy'],
    type: [String],
    default: [],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Whether this skill is active and available in the catalog',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Extensible metadata for the skill',
    default: {},
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Tenant identifier',
    default: 'default',
  })
  @IsString()
  @IsOptional()
  tenantId?: string;
}

export class UpdateSkillDto {
  @ApiPropertyOptional({
    description: 'Unique slug identifier (kebab-case)',
    example: 'hotel-cancellation',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lower-case kebab-case (e.g. "hotel-cancellation")',
  })
  slug?: string;

  @ApiPropertyOptional({
    description: 'Human-readable display title for the skill',
    example: 'Hotel Reservation Cancellation Policy',
  })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    description: 'Level 1 Catalog summary description',
    example: 'Updated policy summary...',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Level 2 Playbook Markdown instructions',
    example: '# Updated instructions...',
  })
  @IsString()
  @IsOptional()
  instructions?: string;

  @ApiPropertyOptional({
    description: 'Whitelist of allowed tools',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tools?: string[];

  @ApiPropertyOptional({
    description: 'Category tags',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Whether this skill is active',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Extensible metadata for the skill',
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class SkillResponseDto {
  @ApiProperty({ example: '018f23a5-7b12-7000-8000-123456789abc' })
  id: string;

  @ApiProperty({ example: 'default' })
  tenantId: string;

  @ApiProperty({ example: 'hotel-cancellation' })
  slug: string;

  @ApiProperty({ example: 'Hotel Reservation Cancellation Policy' })
  name: string;

  @ApiProperty({
    example: 'Provides policies and step-by-step procedures to verify eligibility...',
  })
  description: string;

  @ApiProperty({ example: '# Hotel Cancellation Playbook\n\n...' })
  instructions: string;

  @ApiProperty({ example: ['hotel_api_cancel_booking', 'payment_refund'] })
  tools: string[];

  @ApiProperty({ example: ['hotel', 'booking', 'policy'] })
  tags: string[];

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: {} })
  metadata?: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-10-29T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-29T10:00:00.000Z' })
  updatedAt: Date;
}

export class SkillTenantQueryDto {
  @ApiPropertyOptional({
    description: 'Tenant sở hữu skill (mặc định "default" = skill dùng chung)',
    default: 'default',
  })
  @IsString()
  @IsOptional()
  tenantId?: string;
}
