import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { UserTagAssignmentsService } from './user-tag-assignments.service';
import { AssignTagDto, RemoveTagDto } from './dto/assign-tag.dto';

@Controller('admin/users')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Users)
export class AdminUserTagAssignmentsController {
  constructor(private readonly assignments: UserTagAssignmentsService) {}

  @Get(':userId/tag')
  getCurrent(@Param('userId') userId: string) {
    return this.assignments.getCurrentTag(userId);
  }

  @Post(':userId/tag')
  assign(
    @Param('userId') userId: string,
    @CurrentUser() current: { id: string },
    @Body() dto: AssignTagDto,
  ) {
    return this.assignments.manuallyAssign(
      userId,
      dto.tagId,
      current.id,
      dto.reason,
    );
  }

  @Delete(':userId/tag')
  remove(
    @Param('userId') userId: string,
    @CurrentUser() current: { id: string },
    @Body() dto: RemoveTagDto,
  ) {
    return this.assignments.manuallyRemove(userId, current.id, dto.reason);
  }

  @Get(':userId/tag-history')
  history(@Param('userId') userId: string) {
    return this.assignments.listHistory(userId);
  }
}
