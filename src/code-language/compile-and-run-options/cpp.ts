import { IsIn } from "class-validator";

export default class CompileAndRunOptionsCpp {
  @IsIn(["g++", "clang++"])
  compiler: string;

  @IsIn([
    "c++98", "c++03", "c++11", "c++14", "c++17", "c++20", "c++23",
    "gnu++98", "gnu++03", "gnu++11", "gnu++14", "gnu++17", "gnu++20", "gnu++23"
  ])
  std: string;

  @IsIn(["0", "1", "2", "3"])
  O: string;

  // @IsIn(["64", "32"])
  // m: string;
}
