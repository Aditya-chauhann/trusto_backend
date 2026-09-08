import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SystemControls,
  SystemControlsSchema,
} from './schemas/system-controls.schema';
import { SystemControlsService } from './system-controls.service';
import {
  AdminSystemControlsController,
  PublicSystemControlsController,
} from './system-controls.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SystemControls.name, schema: SystemControlsSchema },
    ]),
  ],
  controllers: [
    AdminSystemControlsController,
    PublicSystemControlsController,
  ],
  providers: [SystemControlsService],
  exports: [SystemControlsService],
})
export class SystemControlsModule {}
