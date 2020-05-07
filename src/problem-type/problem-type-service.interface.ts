import { ValidationError } from "class-validator";

import { ProblemJudgeInfo } from "@/problem/problem-judge-info.interface";
import { ProblemFileEntity } from "@/problem/problem-file.entity";
import { SubmissionContent } from "@/submission/submission-content.interface";
import { SubmissionTestcaseResult, SubmissionResult } from "@/submission/submission-result.interface";

export interface ProblemTypeServiceInterface<
  JudgeInfoType extends ProblemJudgeInfo,
  SubmissionContentType extends SubmissionContent,
  SubmissionTestcaseResultType extends SubmissionTestcaseResult
> {
  /**
   * Return the default judge info for a newly created problem.
   */
  getDefaultJudgeInfo(): JudgeInfoType;

  /**
   * Preprocess judge info for judging, e.g. detect testcases automatically from test data when configured.
   * @param judgeInfo The judge info set by problem manager.
   * @param testData The problem's testdata files.
   * @return The preprocessed judge info to be sent to judge.
   */
  preprocessJudgeInfo(judgeInfo: JudgeInfoType, testData: ProblemFileEntity[]): JudgeInfoType;

  /**
   * Validate a preprocessed judge info, return if valid and
   * throw an array of error info if invalid.
   * @param judgeInfo The preprocessed judge info to be sent to judge.
   * @param testData The problem's testdata files.
   * @param ignoreLimits Ignore the limits in the config (e.g. the judge info is submitted by a privileged user).
   * @throws An array of error info `[error, arg1, arg2, ...]` if failed.
   */
  validateJudgeInfo(judgeInfo: JudgeInfoType, testData: ProblemFileEntity[], ignoreLimits: boolean): void;

  /**
   * Validate a submission content submitted by user. Return the validation errors by class-validator.
   * @param submissionContent The submission content submitted by user.
   * @returns The validation errors by class-validator.
   */
  validateSubmissionContent(submissionContent: SubmissionContentType): Promise<ValidationError[]>;

  /**
   * Get code language and answer size from submission content submitted by user.
   * @param submissionContent The submission content submitted by user.
   * @returns An object containing the code language and answer size of the submission content.
   */
  getCodeLanguageAndAnswerSizeFromSubmissionContent(
    submissionContent: SubmissionContentType
  ): Promise<{
    language: string;
    answerSize: number;
  }>;

  /**
   * Get time and memory used from submission result object.
   * @param submissionResult The result of a submission.
   * @returns An object containing the time and memory used.
   */
  getTimeAndMemoryUsedFromSubmissionResult(
    submissionResult: SubmissionResult<SubmissionTestcaseResultType>
  ): {
    timeUsed: number;
    memoryUsed: number;
  };
}
