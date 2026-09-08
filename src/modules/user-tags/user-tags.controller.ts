import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserTagsService } from './user-tags.service';
import { UserTagAssignmentsService } from './user-tag-assignments.service';

@Controller('user')
@UseGuards(AuthGuard('jwt'))
export class UserTagsController {
  constructor(
    private readonly tags: UserTagsService,
    private readonly assignments: UserTagAssignmentsService,
  ) {}

  @Get('me/tag')
  getMyTag(@CurrentUser() current: { id: string }) {
    return this.assignments.getCurrentTagDetailed(current.id);
  }

  @Get('tags')
  listActive() {
    return this.tags.listActive();
  }
}
