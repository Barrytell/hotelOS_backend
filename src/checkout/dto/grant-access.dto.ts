import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GrantAccessDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  githubUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
