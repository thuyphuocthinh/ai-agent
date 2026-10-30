import { Module } from '@nestjs/common';
import { ArtifactTmpManagerService } from './artifact-tmp-manager.service';
import { ARTIFACT_TMP_MANAGER } from '../../contracts/storage/artifact-tmp.interface';

@Module({
  providers: [
    ArtifactTmpManagerService,
    {
      provide: ARTIFACT_TMP_MANAGER,
      useExisting: ArtifactTmpManagerService,
    },
  ],
  exports: [ArtifactTmpManagerService, ARTIFACT_TMP_MANAGER],
})
export class StorageModule {}
