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
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { CreateUnitDto } from './dto/create-unit.dto.js';
import { ListUnitsQueryDto } from './dto/list-units-query.dto.js';
import { UnitResponseDto } from './dto/unit-response.dto.js';
import { UpdateUnitDto } from './dto/update-unit.dto.js';
import { UpdateUnitStatusDto } from './dto/update-unit-status.dto.js';
import { Unit } from './entities/unit.entity.js';
import { UnitsService } from './units.service.js';

@ApiTags('Units')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@Roles(UserRole.OWNER, UserRole.ADMIN)
@Controller()
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Get('units')
  @ApiOperation({
    summary: 'List units (OWNER: own properties only, ADMIN: all)',
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
  @ApiOperation({ summary: 'Get a unit' })
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
  @ApiOperation({ summary: 'Manually toggle AVAILABLE <-> MAINTENANCE' })
  @ApiOkResponse({ type: UnitResponseDto })
  @ApiForbiddenResponse({ description: 'No access to this unit' })
  @ApiBadRequestResponse({ description: 'Not a valid manual transition' })
  setStatus(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitStatusDto,
  ): Promise<Unit> {
    return this.unitsService.setStatus(actor, id, dto.status);
  }
}
