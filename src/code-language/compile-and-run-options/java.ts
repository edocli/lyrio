import { IsIn } from "class-validator";

export default class CompileAndRunOptionsJava {
  @IsIn(["8", "11", "17", "21"])
  release: string;
}
