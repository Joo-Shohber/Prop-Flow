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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { CreateRentalRequestDto } from './dto/create-rental-request.dto.js';
import { ListRentalRequestsQueryDto } from './dto/list-rental-requests-query.dto.js';
import { RentalRequestResponseDto } from './dto/rental-request-response.dto.js';
import { RentalRequestsService } from './rental-requests.service.js';

const READ_ROLES = [UserRole.TENANT, UserRole.OWNER, UserRole.ADMIN] as const;
const MANAGE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

@ApiTags('Rental Requests')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@Controller('rental-requests')
export class RentalRequestsController {
  constructor(private readonly rentalRequests: RentalRequestsService) {}

  @Get()
  @Roles(...READ_ROLES)
  @ApiOperation({
    summary:
      'List rental requests (TENANT: own, OWNER: own properties, ADMIN: all)',
  })
  @ApiOkResponse({
    type: RentalRequestResponseDto,
    isArray: true,
    description: 'Paginated list; see `meta`',
  })
  findAll(
    @CurrentUser() actor: User,
    @Query() query: ListRentalRequestsQueryDto,
  ) {
    return this.rentalRequests.findAll(actor, query);
  }

  @Post()
  @Roles(UserRole.TENANT)
  @ApiOperation({ summary: 'Create a PENDING rental request for a unit' })
  @ApiCreatedResponse({ type: RentalRequestResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid dates or body' })
  @ApiNotFoundResponse({ description: 'Unit not found' })
  @ApiConflictResponse({
    description:
      'Unit is not AVAILABLE, or the dates overlap a PENDING/ACTIVE lease',
  })
  create(
    @CurrentUser() actor: User,
    @Body() dto: CreateRentalRequestDto,
    @Req() req: Request,
  ): Promise<RentalRequestResponseDto> {
    return this.rentalRequests.create(actor, dto, req.ip);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Get a rental request' })
  @ApiOkResponse({ type: RentalRequestResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this rental request' })
  @ApiNotFoundResponse({ description: 'Rental request not found' })
  findOne(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RentalRequestResponseDto> {
    return this.rentalRequests.findForActor(actor, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(...MANAGE_ROLES)
  @ApiOperation({
    summary:
      'Approve a PENDING rental request (creates a PENDING lease; unit stays AVAILABLE)',
  })
  @ApiOkResponse({ type: RentalRequestResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this rental request' })
  @ApiNotFoundResponse({ description: 'Rental request not found' })
  @ApiConflictResponse({
    description:
      'Request is not PENDING, the unit is not AVAILABLE, or the dates conflict with another lease',
  })
  approve(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<RentalRequestResponseDto> {
    return this.rentalRequests.approve(actor, id, req.ip);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Reject a PENDING rental request' })
  @ApiOkResponse({ type: RentalRequestResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this rental request' })
  @ApiNotFoundResponse({ description: 'Rental request not found' })
  @ApiConflictResponse({ description: 'Request is not PENDING' })
  reject(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<RentalRequestResponseDto> {
    return this.rentalRequests.reject(actor, id, req.ip);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.TENANT)
  @ApiOperation({
    summary: 'Withdraw your own PENDING rental request (TENANT)',
  })
  @ApiOkResponse({ type: RentalRequestResponseDto })
  @ApiForbiddenResponse({ description: 'The request belongs to another tenant' })
  @ApiNotFoundResponse({ description: 'Rental request not found' })
  @ApiConflictResponse({ description: 'Request is not PENDING' })
  cancel(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<RentalRequestResponseDto> {
    return this.rentalRequests.cancel(actor, id, req.ip);
  }
}
