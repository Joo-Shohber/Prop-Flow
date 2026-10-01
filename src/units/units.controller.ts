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
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { CreateUnitDto } from './dto/create-unit.dto.js';
import { ListUnitsQueryDto } from './dto/list-units-query.dto.js';
import { UnitResponseDto } from './dto/unit-response.dto.js';
import { UpdateUnitDto } from './dto/update-unit.dto.js';
import { UpdateUnitStatusDto } from './dto/update-unit-status.dto.js';
import { Unit } from './entities/unit.entity.js';
import { UnitsService } from './units.service.js';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DeleteImageDto } from '../common/uploads/dto/delete-image.dto.js';
import {
  MAX_IMAGE_SIZE_BYTES,
  UNIT_MAX_IMAGES,
} from '../common/uploads/upload.constants.js';

@ApiTags('Units')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@Controller()
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Get('units')
  @Roles(UserRole.TENANT, UserRole.OWNER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'List units (TENANT: AVAILABLE only, OWNER: own, ADMIN: all)',
  })
  @ApiOkResponse({
    type: UnitResponseDto,
    isArray: true,
    description: 'Paginated list; see `meta`',
  })
  findAll(@CurrentUser() actor: User, @Query() query: ListUnitsQueryDto) {
    return this.unitsService.findAll(actor, query);
  }

  @Post('properties/:propertyId/units')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a unit under a property' })
  @ApiCreatedResponse({ type: UnitResponseDto })
  @ApiForbiddenResponse({
    description: 'Not the property owner and not an ADMIN',
  })
  @ApiNotFoundResponse({ description: 'Property not found' })
  create(
    @CurrentUser() actor: User,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateUnitDto,
  ): Promise<Unit> {
    return this.unitsService.create(actor, propertyId, dto);
  }

  @Get('units/:id')
  @Roles(UserRole.TENANT, UserRole.OWNER, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Get a unit (TENANT: AVAILABLE units only, OWNER: own properties, ADMIN: all)',
  })
  @ApiOkResponse({ type: UnitResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this unit' })
  @ApiNotFoundResponse({ description: 'Unit not found' })
  findOne(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Unit> {
    return this.unitsService.findForActor(actor, id);
  }

  @Patch('units/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a unit (not its status)' })
  @ApiOkResponse({ type: UnitResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this unit' })
  @ApiNotFoundResponse({ description: 'Unit not found' })
  update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ): Promise<Unit> {
    return this.unitsService.update(actor, id, dto);
  }

  @Delete('units/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a unit' })
  @ApiForbiddenResponse({ description: 'No access to this unit' })
  @ApiNotFoundResponse({ description: 'Unit not found' })
  async remove(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<null> {
    await this.unitsService.remove(actor, id);
    return null;
  }

  @Patch('units/:id/status')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Manually toggle AVAILABLE <-> MAINTENANCE' })
  @ApiOkResponse({ type: UnitResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this unit' })
  @ApiBadRequestResponse({ description: 'Not a valid manual transition' })
  setStatus(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitStatusDto,
    @Req() req: Request,
  ): Promise<Unit> {
    return this.unitsService.setStatus(actor, id, dto.status, req.ip);
  }

  @Post('units/:id/images')
  @ApiOperation({
    summary: `Upload unit images (max ${UNIT_MAX_IMAGES}, jpeg/png/webp)`,
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
  @ApiOkResponse({ type: UnitResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this unit' })
  @ApiConflictResponse({ description: 'Would exceed the per-unit image limit' })
  @UseInterceptors(
    FilesInterceptor('images', UNIT_MAX_IMAGES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    }),
  )
  addImages(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<Unit> {
    return this.unitsService.addImages(actor, id, files);
  }

  @Delete('units/:id/images')
  @ApiOperation({ summary: 'Remove a unit image' })
  @ApiOkResponse({ type: UnitResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this unit' })
  @ApiNotFoundResponse({ description: 'Unit or image not found' })
  removeImage(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteImageDto,
  ): Promise<Unit> {
    return this.unitsService.removeImage(actor, id, dto.publicId);
  }
}
