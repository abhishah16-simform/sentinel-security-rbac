import { IsBoolean } from 'class-validator';

export class SetTenantAdminDto {
  @IsBoolean()
  isTenantAdmin!: boolean;
}
