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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { BlogsService } from './blogs.service';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';

@Controller('admin/blogs')
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
export class AdminBlogsController {
  constructor(private readonly blogs: BlogsService) {}

  @Get()
  list() {
    return this.blogs.listAll();
  }

  @Post()
  create(
    @CurrentUser() current: { id: string },
    @Body() dto: CreateBlogDto,
  ) {
    return this.blogs.create(current.id, dto);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.blogs.getById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBlogDto) {
    return this.blogs.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.blogs.remove(id);
  }
}
