import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Blog, BlogDocument, BlogStatus } from './schemas/blog.schema';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';

export interface BlogPublicResponse {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content?: string;
  coverImageUrl: string | null;
  publishedAt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlogAdminResponse extends BlogPublicResponse {
  status: BlogStatus;
  authorId: string;
  content: string;
}

export interface PaginatedBlogs<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class BlogsService {
  constructor(
    @InjectModel(Blog.name)
    private readonly blogModel: Model<BlogDocument>,
  ) {}

  slugify(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
    if (!baseSlug) {
      throw new BadRequestException('Could not generate a valid slug from title');
    }
    let candidate = baseSlug;
    let suffix = 2;
    while (true) {
      const filter: Record<string, unknown> = { slug: candidate };
      if (excludeId && Types.ObjectId.isValid(excludeId)) {
        filter._id = { $ne: new Types.ObjectId(excludeId) };
      }
      const exists = await this.blogModel.exists(filter);
      if (!exists) return candidate;
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
  }

  async create(authorId: string, dto: CreateBlogDto): Promise<BlogAdminResponse> {
    if (!Types.ObjectId.isValid(authorId)) {
      throw new BadRequestException('Invalid authorId');
    }
    const baseSlug = dto.slug?.trim() || this.slugify(dto.title);
    const slug = await this.ensureUniqueSlug(baseSlug);
    const status = dto.status ?? BlogStatus.Draft;
    const now = new Date();
    const publishedAt = status === BlogStatus.Published ? now : null;

    try {
      const created = await this.blogModel.create({
        title: dto.title.trim(),
        slug,
        excerpt: dto.excerpt.trim(),
        content: dto.content,
        coverImageUrl: dto.coverImageUrl?.trim() ?? null,
        status,
        publishedAt,
        authorId: new Types.ObjectId(authorId),
        metaTitle: dto.metaTitle?.trim() ?? null,
        metaDescription: dto.metaDescription?.trim() ?? null,
      });
      return this.toAdminResponse(created);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('A blog with this slug already exists');
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateBlogDto): Promise<BlogAdminResponse> {
    const doc = await this.findDocOrThrow(id);
    if (dto.title !== undefined) doc.title = dto.title.trim();
    if (dto.excerpt !== undefined) doc.excerpt = dto.excerpt.trim();
    if (dto.content !== undefined) doc.content = dto.content;
    if (dto.coverImageUrl !== undefined) {
      doc.coverImageUrl = dto.coverImageUrl?.trim() ?? null;
    }
    if (dto.metaTitle !== undefined) {
      doc.metaTitle = dto.metaTitle?.trim() ?? null;
    }
    if (dto.metaDescription !== undefined) {
      doc.metaDescription = dto.metaDescription?.trim() ?? null;
    }
    if (dto.slug !== undefined) {
      doc.slug = await this.ensureUniqueSlug(dto.slug.trim(), id);
    } else if (dto.title !== undefined && !dto.slug) {
      const generated = this.slugify(dto.title);
      if (generated && generated !== doc.slug) {
        doc.slug = await this.ensureUniqueSlug(generated, id);
      }
    }
    if (dto.status !== undefined) {
      const wasPublished = doc.status === BlogStatus.Published;
      doc.status = dto.status;
      if (dto.status === BlogStatus.Published && !doc.publishedAt) {
        doc.publishedAt = new Date();
      }
      if (dto.status === BlogStatus.Draft && wasPublished) {
        // Keep publishedAt for history; post simply stops appearing publicly.
      }
    }

    try {
      await doc.save();
      return this.toAdminResponse(doc);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('A blog with this slug already exists');
      }
      throw err;
    }
  }

  async listPublished(
    page = 1,
    limit = 10,
  ): Promise<PaginatedBlogs<BlogPublicResponse>> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;
    const filter = { status: BlogStatus.Published };

    const [docs, total] = await Promise.all([
      this.blogModel
        .find(filter)
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      this.blogModel.countDocuments(filter),
    ]);

    return {
      items: docs.map((d) => this.toPublicListResponse(d)),
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async getPublishedBySlug(slug: string): Promise<BlogPublicResponse> {
    const normalized = slug.trim().toLowerCase();
    const doc = await this.blogModel.findOne({
      slug: normalized,
      status: BlogStatus.Published,
    });
    if (!doc) throw new NotFoundException('Blog post not found');
    return this.toPublicDetailResponse(doc);
  }

  async listAll(): Promise<BlogAdminResponse[]> {
    const docs = await this.blogModel.find().sort({ updatedAt: -1 });
    return docs.map((d) => this.toAdminResponse(d));
  }

  async getById(id: string): Promise<BlogAdminResponse> {
    const doc = await this.findDocOrThrow(id);
    return this.toAdminResponse(doc);
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findDocOrThrow(id);
    await doc.deleteOne();
  }

  private async findDocOrThrow(id: string): Promise<BlogDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid blog id');
    }
    const doc = await this.blogModel.findById(id);
    if (!doc) throw new NotFoundException('Blog post not found');
    return doc;
  }

  private toPublicListResponse(doc: BlogDocument): BlogPublicResponse {
    return {
      id: (doc._id as Types.ObjectId).toString(),
      title: doc.title,
      slug: doc.slug,
      excerpt: doc.excerpt,
      coverImageUrl: doc.coverImageUrl ?? null,
      publishedAt: doc.publishedAt?.toISOString() ?? null,
      metaTitle: doc.metaTitle ?? null,
      metaDescription: doc.metaDescription ?? null,
      createdAt: (doc as any).createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: (doc as any).updatedAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  private toPublicDetailResponse(doc: BlogDocument): BlogPublicResponse {
    return {
      ...this.toPublicListResponse(doc),
      content: doc.content,
    };
  }

  private toAdminResponse(doc: BlogDocument): BlogAdminResponse {
    return {
      ...this.toPublicDetailResponse(doc),
      status: doc.status,
      authorId: doc.authorId.toString(),
      content: doc.content,
    };
  }
}
