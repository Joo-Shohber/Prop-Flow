import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { CreateLeaseDto } from './dto/create-lease.dto.js';
import { LeaseResponseDto } from './dto/lease-response.dto.js';
import { ListLeasesQueryDto } from './dto/list-leases-query.dto.js';
import { UpdateLeaseDto } from './dto/update-lease.dto.js';
import { Lease } from './entities/lease.entity.js';
import { LeasesService } from './leases.service.js';
import { Req } from '@nestjs/common';
import type { Request } from 'express';

const READ_ROLES = [UserRole.TENANT, UserRole.OWNER, UserRole.ADMIN] as const;
const MANAGE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

@ApiTags('Leases')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@Controller('leases')
export class LeasesController {
  constructor(private readonly leases: LeasesService) {}

  @Get()
  @Roles(...READ_ROLES)
  @ApiOperation({
    summary: 'List leases (TENANT: own, OWNER: own properties, ADMIN: all)',
  })
  @ApiOkResponse({
    type: LeaseResponseDto,
    isArray: true,
    description: 'Paginated list; see `meta`',
  })
  findAll(@CurrentUser() actor: User, @Query() query: ListLeasesQueryDto) {
    return this.leases.findAll(actor, query);
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Create a PENDING lease' })
  @ApiCreatedResponse({ type: LeaseResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid dates or tenantId' })
  @ApiForbiddenResponse({
    description: "Not the owner of the unit's property and not an ADMIN",
  })
  @ApiConflictResponse({
    description: 'Overlaps another PENDING or ACTIVE lease of the same unit',
  })
  create(
    @CurrentUser() actor: User,
    @Body() dto: CreateLeaseDto,
    @Req() req: Request,
  ): Promise<Lease> {
    return this.leases.create(actor, dto, req.ip);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Get a lease' })
  @ApiOkResponse({ type: LeaseResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this lease' })
  @ApiNotFoundResponse({ description: 'Lease not found' })
  findOne(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Lease> {
    return this.leases.findForActor(actor, id);
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Update a PENDING lease (dates, notes)' })
  @ApiOkResponse({ type: LeaseResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this lease' })
  @ApiNotFoundResponse({ description: 'Lease not found' })
  @ApiConflictResponse({
    description: 'Not PENDING, or overlaps another lease of the same unit',
  })
  update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaseDto,
  ): Promise<Lease> {
    return this.leases.update(actor, id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles(...MANAGE_ROLES)
  @ApiOperation({
    summary: 'Activate a PENDING lease (unit must be AVAILABLE)',
  })
  @ApiOkResponse({ type: LeaseResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this lease' })
  @ApiNotFoundResponse({ description: 'Lease not found' })
  @ApiConflictResponse({
    description: 'Lease is not PENDING, or the unit is not AVAILABLE',
  })
  activate(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<Lease> {
    return this.leases.activate(actor, id, req.ip);
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Terminate a PENDING or ACTIVE lease' })
  @ApiOkResponse({ type: LeaseResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this lease' })
  @ApiNotFoundResponse({ description: 'Lease not found' })
  @ApiConflictResponse({ description: 'Lease is not PENDING or ACTIVE' })
  terminate(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<Lease> {
    return this.leases.terminate(actor, id, req.ip);
  }
}
