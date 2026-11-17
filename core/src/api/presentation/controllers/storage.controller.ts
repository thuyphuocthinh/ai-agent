import {
  Controller,
  Post,
  Put,
  Get,
  Body,
  Param,
  Headers,
  Inject,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiConsumes } from '@nestjs/swagger';
import type { IncomingMessage, ServerResponse } from 'http';
import { IStorageService, STORAGE_SERVICE } from '../../../contracts';
import { PresignedUrlRequestDto, PresignedUrlResponseDto } from '../dtos/presigned-url.dto';
import { BypassTransform } from '../decorators/bypass-transform.decorator';

@ApiTags('Storage')
@Controller('api/storage')
export class StorageController {
  constructor(
    @Inject(STORAGE_SERVICE)
    private readonly storageService: IStorageService,
  ) {}

  @Post('presigned-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sinh Pre-signed URL để tải ảnh tài liệu trực tiếp lên Cloud Storage',
    description: 'Hỗ trợ các định dạng ảnh: PNG, JPEG, WEBP, GIF. Trả về uploadUrl (PUT) và publicUrl.',
  })
  @ApiOkResponse({ type: PresignedUrlResponseDto })
  async createPresignedUrl(
    @Body() dto: PresignedUrlRequestDto,
  ): Promise<PresignedUrlResponseDto> {
    return this.storageService.createPresignedUploadUrl(dto);
  }

  @Put('local/:folder/:filename')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/octet-stream', 'image/*')
  async uploadLocalFile(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Headers('content-type') contentType: string = 'application/octet-stream',
    @Req() req: IncomingMessage,
  ): Promise<{ status: string; key: string }> {
    return this.storageService.saveStream(`${folder}/${filename}`, req, contentType);
  }

  @Get('local/:folder/:filename')
  @BypassTransform()
  async getLocalFile(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<StreamableFile> {
    const file = await this.storageService.getFile(`${folder}/${filename}`);
    res.setHeader('Content-Type', file.contentType);
    return new StreamableFile(file.buffer);
  }
}
