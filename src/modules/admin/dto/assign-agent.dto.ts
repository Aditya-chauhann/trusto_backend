import { IsMongoId, ValidateIf } from 'class-validator';

export class AssignAgentDto {
  @ValidateIf((_, v) => v !== null)
  @IsMongoId()
  agentId: string | null;
}
