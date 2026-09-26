import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Delete,
  UploadedFiles,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
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
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import {
  MAINTENANCE_MAX_IMAGES,
  MAX_IMAGE_SIZE_BYTES,
} from '../common/uploads/upload.constants.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { AssignMaintenanceDto } from './dto/assign-maintenance.dto.js';
import { CompleteMaintenanceDto } from './dto/complete-maintenance.dto.js';
import { CreateMaintenanceRequestDto } from './dto/create-maintenance-request.dto.js';
import { ListMaintenanceQueryDto } from './dto/list-maintenance-query.dto.js';
import { MaintenanceResponseDto } from './dto/maintenance-response.dto.js';
import { MaintenanceStatusHistoryResponseDto } from './dto/maintenance-status-history-response.dto.js';
import { TransitionNotesDto } from './dto/transition-notes.dto.js';
import { MaintenanceRequest } from './entities/maintenance-request.entity.js';
import { MaintenanceStatusHistory } from './entities/maintenance-status-history.entity.js';
import { MaintenanceService } from './maintenance.service.js';
import { MaintenanceCategory } from './enums/maintenance-category.enum.js';
import { MaintenancePriority } from './enums/maintenance-priority.enum.js';
import { DeleteImageDto } from '../common/uploads/dto/delete-image.dto.js';
import type { Request } from 'express';

const ALL_ROLES = [
  UserRole.TENANT,
  UserRole.OWNER,
  UserRole.MAINTENANCE_STAFF,
  UserRole.ADMIN,
] as const;

@ApiTags('Maintenance')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'List maintenance requests (scoped by role)' })
  @ApiOkResponse({
    type: MaintenanceResponseDto,
    isArray: true,
    description: 'Paginated list; see `meta`',
  })
  findAll(@CurrentUser() actor: User, @Query() query: ListMaintenanceQueryDto) {
    return this.maintenance.findAll(actor, query);
  }

  @Post()
  @Roles(UserRole.TENANT)
  @ApiOperation({
    summary: 'Create a maintenance request for the unit of your active lease',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title', 'description', 'category', 'priority'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', enum: Object.values(MaintenanceCategory) },
        priority: { type: 'string', enum: Object.values(MaintenancePriority) },
        images: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiCreatedResponse({ type: MaintenanceResponseDto })
  @ApiBadRequestResponse({ description: 'No active lease' })
  @UseInterceptors(
    FilesInterceptor('images', MAINTENANCE_MAX_IMAGES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    }),
  )
  create(
    @CurrentUser() actor: User,
    @Body() dto: CreateMaintenanceRequestDto,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<MaintenanceRequest> {
    return this.maintenance.create(actor, dto, files ?? []);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Get a maintenance request' })
  @ApiOkResponse({ type: MaintenanceResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this request' })
  @ApiNotFoundResponse({ description: 'Maintenance request not found' })
  findOne(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MaintenanceRequest> {
    return this.maintenance.findForActor(actor, id);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Assign an OPEN request to a maintenance staff member',
  })
  @ApiOkResponse({ type: MaintenanceResponseDto })
  @ApiForbiddenResponse({
    description: 'Not the property owner and not an ADMIN',
  })
  @ApiBadRequestResponse({
    description: 'assignedStaffId must be an active MAINTENANCE_STAFF user',
  })
  @ApiConflictResponse({ description: 'Request is not OPEN' })
  assign(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignMaintenanceDto,
    @Req() req: Request,
  ): Promise<MaintenanceRequest> {
    return this.maintenance.assign(actor, id, dto, req.ip);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.MAINTENANCE_STAFF)
  @ApiOperation({
    summary: 'Start work on an assigned request (assigned staff only)',
  })
  @ApiOkResponse({ type: MaintenanceResponseDto })
  @ApiForbiddenResponse({ description: 'Not the assigned staff member' })
  @ApiConflictResponse({ description: 'Request is not ASSIGNED' })
  start(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionNotesDto,
  ): Promise<MaintenanceRequest> {
    return this.maintenance.start(actor, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.MAINTENANCE_STAFF)
  @ApiOperation({ summary: 'Mark a request resolved (assigned staff only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['resolutionDescription'],
      properties: {
        resolutionDescription: { type: 'string' },
        notes: { type: 'string' },
        completionImages: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiOkResponse({ type: MaintenanceResponseDto })
  @ApiForbiddenResponse({ description: 'Not the assigned staff member' })
  @ApiConflictResponse({ description: 'Request is not IN_PROGRESS' })
  @UseInterceptors(
    FilesInterceptor('completionImages', MAINTENANCE_MAX_IMAGES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    }),
  )
  complete(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteMaintenanceDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Request,
  ): Promise<MaintenanceRequest> {
    return this.maintenance.complete(actor, id, dto, files ?? [], req.ip);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TENANT, UserRole.OWNER, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Close a RESOLVED request (the tenant, the property owner, or ADMIN)',
  })
  @ApiOkResponse({ type: MaintenanceResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this request' })
  @ApiConflictResponse({ description: 'Request is not RESOLVED' })
  close(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionNotesDto,
  ): Promise<MaintenanceRequest> {
    return this.maintenance.close(actor, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TENANT, UserRole.OWNER, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Cancel an OPEN or ASSIGNED request (the tenant, the property owner, or ADMIN)',
  })
  @ApiOkResponse({ type: MaintenanceResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this request' })
  @ApiConflictResponse({ description: 'Request is not OPEN or ASSIGNED' })
  cancel(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionNotesDto,
  ): Promise<MaintenanceRequest> {
    return this.maintenance.cancel(actor, id, dto);
  }

  @Get(':id/history')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Get the status history of a request' })
  @ApiOkResponse({ type: MaintenanceStatusHistoryResponseDto, isArray: true })
  @ApiForbiddenResponse({ description: 'No access to this request' })
  getHistory(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MaintenanceStatusHistory[]> {
    return this.maintenance.getHistory(actor, id);
  }

  @Delete(':id/images')
  @Roles(UserRole.TENANT, UserRole.OWNER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Remove a request image (only while OPEN)' })
  @ApiOkResponse({ type: MaintenanceResponseDto })
  removeImage(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteImageDto,
  ): Promise<MaintenanceRequest> {
    return this.maintenance.removeImage(actor, id, dto.publicId);
  }

  @Delete(':id/completion-images')
  @Roles(UserRole.MAINTENANCE_STAFF)
  @ApiOperation({
    summary: 'Remove a completion image (assigned staff, only while RESOLVED)',
  })
  @ApiOkResponse({ type: MaintenanceResponseDto })
  removeCompletionImage(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteImageDto,
  ): Promise<MaintenanceRequest> {
    return this.maintenance.removeCompletionImage(actor, id, dto.publicId);
  }
}
