import { Module } from '@nestjs/common';
import { ArtifactTmpManagerService } from './artifact-tmp-manager.service';
import { ARTIFACT_TMP_MANAGER } from '../../contracts/storage/artifact-tmp.interface';
import { STORAGE_SERVICE } from '../../contracts/storage/storage.interface';
import { S3StorageService } from './s3-storage.service';
import { LocalStorageService } from './local-storage.service';
import { DiskStorageService } from './disk-storage.service';

@Module({
  providers: [
    ArtifactTmpManagerService,
    S3StorageService,
    LocalStorageService,
    DiskStorageService,
    {
      provide: ARTIFACT_TMP_MANAGER,
      useExisting: ArtifactTmpManagerService,
    },
    {
      provide: STORAGE_SERVICE,
      useFactory: (
        s3: S3StorageService,
        disk: DiskStorageService,
        local: LocalStorageService,
      ) => {
        const driver = process.env.STORAGE_DRIVER?.toLowerCase();
        if (driver === 'memory') return local;
        if (driver === 's3' || process.env.S3_BUCKET) return s3;
        return disk;
      },
      inject: [S3StorageService, DiskStorageService, LocalStorageService],
    },
  ],
  exports: [
    ArtifactTmpManagerService,
    ARTIFACT_TMP_MANAGER,
    STORAGE_SERVICE,
    LocalStorageService,
    DiskStorageService,
  ],
})
export class StorageModule {}
