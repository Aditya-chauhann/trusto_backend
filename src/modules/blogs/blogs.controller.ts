import { Controller, Get, Param, Query } from '@nestjs/common';
import { BlogsService } from './blogs.service';
import { ListBlogsQueryDto } from './dto/list-blogs-query.dto';

@Controller('blogs')
export class BlogsController {
  constructor(private readonly blogs: BlogsService) {}

  @Get()
  list(@Query() query: ListBlogsQueryDto) {
    return this.blogs.listPublished(query.page ?? 1, query.limit ?? 10);
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.blogs.getPublishedBySlug(slug);
  }
}
