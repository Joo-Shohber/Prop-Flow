import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import {
  MAX_IMAGE_SIZE_BYTES,
  PROPERTY_MAX_IMAGES,
} from '../common/uploads/upload.constants.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { CreatePropertyDto } from './dto/create-property.dto.js';
import { ListPropertiesQueryDto } from './dto/list-properties-query.dto.js';
import { PropertyResponseDto } from './dto/property-response.dto.js';
import { UpdatePropertyDto } from './dto/update-property.dto.js';
import { Property } from './entities/property.entity.js';
import { PropertiesService } from './properties.service.js';
import { DeleteImageDto } from '../common/uploads/dto/delete-image.dto.js';
import type { Request } from 'express';
import { PropertyWithUnitsResponseDto } from './dto/property-with-units-response.dto.js';

const READ_ROLES = [UserRole.TENANT, UserRole.OWNER, UserRole.ADMIN] as const;
const MANAGE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

@ApiTags('Properties')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  @Roles(...READ_ROLES)
  @ApiOperation({
    summary: 'List properties (OWNER: own only, TENANT and ADMIN: all)',
  })
  @ApiOkResponse({
    type: PropertyResponseDto,
    isArray: true,
    description: 'Paginated list; see `meta`',
  })
  findAll(@CurrentUser() actor: User, @Query() query: ListPropertiesQueryDto) {
    return this.properties.findAll(actor, query);
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  @ApiOperation({
    summary: 'Create a property (owner = self; ADMIN may set ownerId)',
  })
  @ApiCreatedResponse({ type: PropertyResponseDto })
  create(
    @CurrentUser() actor: User,
    @Body() dto: CreatePropertyDto,
    @Req() req: Request,
  ): Promise<Property> {
    return this.properties.create(actor, dto, req.ip);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @ApiOperation({
    summary: 'Get a property',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(PropertyResponseDto) },
        { $ref: getSchemaPath(PropertyWithUnitsResponseDto) },
      ],
    },
  })
  @ApiForbiddenResponse({
    description: 'Not allowed to access this property',
  })
  @ApiNotFoundResponse({
    description: 'Property not found',
  })
  findOne(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.properties.findForActor(actor, id);
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Update a property' })
  @ApiOkResponse({ type: PropertyResponseDto })
  @ApiForbiddenResponse({ description: 'Not the owner and not an ADMIN' })
  @ApiNotFoundResponse({ description: 'Property not found' })
  update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ): Promise<Property> {
    return this.properties.update(actor, id, dto);
  }

  @Delete(':id')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a property' })
  @ApiForbiddenResponse({ description: 'Not the owner and not an ADMIN' })
  @ApiNotFoundResponse({ description: 'Property not found' })
  @ApiConflictResponse({
    description: 'A unit of this property is currently RENTED',
  })
  async remove(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<null> {
    await this.properties.remove(actor, id, req.ip);
    return null;
  }

  @Post(':id/images')
  @Roles(...MANAGE_ROLES)
  @ApiOperation({
    summary: `Upload property images (max ${PROPERTY_MAX_IMAGES}, jpeg/png/webp)`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        images: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOkResponse({ type: PropertyResponseDto })
  @ApiForbiddenResponse({ description: 'Not the owner and not an ADMIN' })
  @ApiConflictResponse({
    description: 'Would exceed the per-property image limit',
  })
  @UseInterceptors(
    FilesInterceptor('images', PROPERTY_MAX_IMAGES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    }),
  )
  addImages(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<Property> {
    return this.properties.addImages(actor, id, files);
  }

  @Delete(':id/images')
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Remove a property image' })
  @ApiOkResponse({ type: PropertyResponseDto })
  @ApiForbiddenResponse({ description: 'Not the owner and not an ADMIN' })
  @ApiNotFoundResponse({ description: 'Property or image not found' })
  removeImage(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteImageDto,
  ): Promise<Property> {
    return this.properties.removeImage(actor, id, dto.publicId);
  }
}
