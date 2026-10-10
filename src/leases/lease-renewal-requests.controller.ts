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
  Req,
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
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Paginated } from '../common/pagination/pagination.utils.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { ApproveLeaseRenewalRequestDto } from './dto/approve-lease-renewal-request.dto.js';
import { CreateLeaseRenewalRequestDto } from './dto/create-lease-renewal-request.dto.js';
import { LeaseRenewalRequestResponseDto } from './dto/lease-renewal-request-response.dto.js';
import { ListLeaseRenewalRequestsQueryDto } from './dto/list-lease-renewal-requests-query.dto.js';
import { LeaseRenewalRequestsService } from './lease-renewal-requests.service.js';

const MANAGE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;
const READ_ROLES = [UserRole.TENANT, UserRole.OWNER, UserRole.ADMIN] as const;

@ApiTags('Lease renewal requests')
@ApiBearerAuth()
@Controller('lease-renewal-requests')
export class LeaseRenewalRequestsController {
  constructor(private readonly renewals: LeaseRenewalRequestsService) {}

  @Get()
  @Roles(...READ_ROLES)
  @ApiOperation({
    summary:
      'List renewal requests (tenant: own, owner: own properties, admin: all)',
  })
  @ApiOkResponse({ type: [LeaseRenewalRequestResponseDto] })
  findAll(
    @CurrentUser() actor: User,
    @Query() query: ListLeaseRenewalRequestsQueryDto,
  ): Promise<Paginated<LeaseRenewalRequestResponseDto>> {
    return this.renewals.findAll(actor, query);
  }

  @Post()
  @Roles(UserRole.TENANT)
  @ApiOperation({
    summary: 'Ask to extend your own ACTIVE lease to a later end date (TENANT)',
  })
  @ApiCreatedResponse({ type: LeaseRenewalRequestResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid date, or not after the current end date',
  })
  @ApiForbiddenResponse({ description: 'The lease belongs to another tenant' })
  @ApiNotFoundResponse({ description: 'Lease not found' })
  @ApiConflictResponse({
    description: 'Lease is not ACTIVE, or a request is already PENDING',
  })
  create(
    @CurrentUser() actor: User,
    @Body() dto: CreateLeaseRenewalRequestDto,
    @Req() req: Request,
  ): Promise<LeaseRenewalRequestResponseDto> {
    return this.renewals.create(actor, dto, req.ip);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Get a renewal request' })
  @ApiOkResponse({ type: LeaseRenewalRequestResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this request' })
  @ApiNotFoundResponse({ description: 'Renewal request not found' })
  findOne(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeaseRenewalRequestResponseDto> {
    return this.renewals.findForActor(actor, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(...MANAGE_ROLES)
  @ApiOperation({
    summary:
      'Approve: extends the lease to the requested (or a different) end date',
  })
  @ApiOkResponse({ type: LeaseRenewalRequestResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid date' })
  @ApiForbiddenResponse({ description: 'No access to this request' })
  @ApiNotFoundResponse({ description: 'Renewal request not found' })
  @ApiConflictResponse({
    description:
      'Not PENDING, lease not ACTIVE, or the period overlaps another lease',
  })
  approve(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveLeaseRenewalRequestDto,
    @Req() req: Request,
  ): Promise<LeaseRenewalRequestResponseDto> {
    return this.renewals.approve(actor, id, dto, req.ip);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Reject a PENDING renewal request' })
  @ApiOkResponse({ type: LeaseRenewalRequestResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this request' })
  @ApiNotFoundResponse({ description: 'Renewal request not found' })
  @ApiConflictResponse({ description: 'Request is not PENDING' })
  reject(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<LeaseRenewalRequestResponseDto> {
    return this.renewals.reject(actor, id, req.ip);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TENANT)
  @ApiOperation({
    summary: 'Withdraw your own PENDING renewal request (TENANT)',
  })
  @ApiOkResponse({ type: LeaseRenewalRequestResponseDto })
  @ApiForbiddenResponse({
    description: 'The request belongs to another tenant',
  })
  @ApiNotFoundResponse({ description: 'Renewal request not found' })
  @ApiConflictResponse({ description: 'Request is not PENDING' })
  cancel(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<LeaseRenewalRequestResponseDto> {
    return this.renewals.cancel(actor, id, req.ip);
  }
}
