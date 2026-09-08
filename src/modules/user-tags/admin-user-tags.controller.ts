import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { UserTagsService } from './user-tags.service';
import { CreateUserTagDto } from './dto/create-user-tag.dto';
import { UpdateUserTagDto } from './dto/update-user-tag.dto';

@Controller('admin/user-tags')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Users)
export class AdminUserTagsController {
  constructor(private readonly tags: UserTagsService) {}

  @Post()
  create(@Body() dto: CreateUserTagDto) {
    return this.tags.create(dto);
  }

  @Get()
  list() {
    return this.tags.list();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.tags.getById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserTagDto) {
    return this.tags.update(id, dto);
  }

  @Post(':id/disable')
  disable(@Param('id') id: string) {
    return this.tags.setActive(id, false);
  }

  @Post(':id/enable')
  enable(@Param('id') id: string) {
    return this.tags.setActive(id, true);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.tags.remove(id);
  }
}
