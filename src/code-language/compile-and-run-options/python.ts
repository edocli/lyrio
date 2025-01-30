import { IsIn } from "class-validator";

export default class CompileAndRunOptionsPython {
  @IsIn(["3.7", "3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "3.14"])
  version: string;
}
