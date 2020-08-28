import { Injectable, forwardRef, Inject } from "@nestjs/common";
import { InjectRepository, InjectConnection } from "@nestjs/typeorm";
import { Repository, Connection, Like, MoreThan, EntityManager } from "typeorm";
import crypto = require("crypto");

import { UserEntity } from "./user.entity";
import {
  UpdateUserProfileResponseError,
  UserMetaDto,
  UserAvatarDto,
  UserAvatarType,
  UpdateUserSelfEmailResponseError
} from "./dto";
import { escapeLike } from "@/database/database.utils";
import { UserPrivilegeService, UserPrivilegeType } from "./user-privilege.service";
import { UserInformationDto } from "./dto/user-information.dto";
import { UserInformationEntity } from "./user-information.entity";
import { UserPreference } from "./user-preference.interface";
import { UserPreferenceEntity } from "./user-preference.entity";
import { RedisService } from "@/redis/redis.service";
import { SubmissionService } from "@/submission/submission.service";
import { SubmissionEntity } from "@/submission/submission.entity";
import { SubmissionStatus } from "@/submission/submission-status.enum";
import { ConfigService } from "@/config/config.service";
import { AuthEmailVerifactionCodeService } from "@/auth/auth-email-verifaction-code.service";
import { AuditLogObjectType, AuditService } from "@/audit/audit.service";

@Injectable()
export class UserService {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(UserInformationEntity)
    private readonly userInformationRepository: Repository<UserInformationEntity>,
    @InjectRepository(UserPreferenceEntity)
    private readonly userPreferenceRepository: Repository<UserPreferenceEntity>,
    @Inject(forwardRef(() => AuthEmailVerifactionCodeService))
    private readonly authEmailVerifactionCodeService: AuthEmailVerifactionCodeService,
    @Inject(forwardRef(() => RedisService))
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => SubmissionService))
    private readonly submissionService: SubmissionService,
    @Inject(forwardRef(() => UserPrivilegeService))
    private readonly userPrivilegeService: UserPrivilegeService,
    private readonly auditService: AuditService
  ) {
    this.auditService.registerObjectTypeQueryHandler(
      AuditLogObjectType.User,
      async (userId, locale, currentUser) => await this.getUserMeta(await this.findUserById(userId), currentUser)
    );
  }

  async findUserById(id: number): Promise<UserEntity> {
    return await this.userRepository.findOne({
      id: id
    });
  }

  async findUserInformationByUserId(id: number): Promise<UserInformationDto> {
    return await this.userInformationRepository.findOne({
      userId: id
    });
  }

  public async findUsersByExistingIds(userIds: number[]): Promise<UserEntity[]> {
    if (userIds.length === 0) return [];
    const uniqueIds = Array.from(new Set(userIds));
    const records = await this.userRepository.findByIds(uniqueIds);
    const map = Object.fromEntries(records.map(record => [record.id, record]));
    return userIds.map(userId => map[userId]);
  }

  async findUserByUsername(username: string): Promise<UserEntity> {
    return await this.userRepository.findOne({
      username: username
    });
  }

  async findUserByEmail(email: string): Promise<UserEntity> {
    return await this.userRepository.findOne({
      email: email
    });
  }

  private getUserAvatar(user: UserEntity): UserAvatarDto {
    const type = user.avatarInfo.substr(0, user.avatarInfo.indexOf(":"));
    const plainKey = user.avatarInfo.slice(user.avatarInfo.indexOf(":") + 1);

    switch (type) {
      case "github":
        return {
          type: UserAvatarType.GitHub,
          key: plainKey
        };
      case "qq":
        return {
          type: UserAvatarType.QQ,
          key: plainKey
        };
      case "gravatar":
      default:
        return {
          type: UserAvatarType.Gravatar,
          key: crypto
            .createHash("md5")
            .update((plainKey || user.email).trim().toLowerCase())
            .digest("hex")
        };
    }
  }

  /**
   * If the current user is admin or have manage user pervilege, the email will be returned
   * even if the user set public email to false.
   */
  async getUserMeta(user: UserEntity, currentUser: UserEntity): Promise<UserMetaDto> {
    return {
      id: user.id,
      username: user.username,
      email:
        user.publicEmail ||
        (currentUser &&
          (currentUser.id === user.id ||
            (await this.userPrivilegeService.userHasPrivilege(currentUser, UserPrivilegeType.MANAGE_USER))))
          ? user.email
          : null,
      avatar: this.getUserAvatar(user),
      bio: user.bio,
      isAdmin: user.isAdmin,
      acceptedProblemCount: user.acceptedProblemCount,
      submissionCount: user.submissionCount,
      rating: user.rating,
      registrationTime: user.registrationTime
    };
  }

  async userExists(id: number): Promise<boolean> {
    return (await this.userRepository.count({ id: id })) != 0;
  }

  async checkUsernameAvailability(username: string): Promise<boolean> {
    return (
      (await this.userRepository.count({
        username: username
      })) == 0
    );
  }

  async checkEmailAvailability(email: string): Promise<boolean> {
    return (
      (await this.userRepository.count({
        email: email
      })) == 0
    );
  }

  /**
   * The username and email won't be updated if null.
   * The information (bio, sex, org, location) will be always updated.
   */
  async updateUserProfile(
    user: UserEntity,
    username: string,
    email: string,
    publicEmail: boolean,
    avatarInfo: string,
    bio: string,
    information: UserInformationDto
  ): Promise<UpdateUserProfileResponseError> {
    const changingUsername = username != null;
    const changingEmail = email != null && !this.configService.config.preference.requireEmailVerification;

    try {
      if (changingUsername) user.username = username;
      if (changingEmail) user.email = email;

      user.publicEmail = publicEmail;
      user.avatarInfo = avatarInfo;
      user.bio = bio;

      const userInformation = await this.findUserInformationByUserId(user.id);
      userInformation.organization = information.organization;
      userInformation.location = information.location;
      userInformation.url = information.url;
      userInformation.telegram = information.telegram;
      userInformation.qq = information.qq;
      userInformation.github = information.github;

      await this.connection.transaction("READ COMMITTED", async transactionalEntityManager => {
        await transactionalEntityManager.save(userInformation);
        await transactionalEntityManager.save(user);
      });
    } catch (e) {
      if (changingUsername && !(await this.checkUsernameAvailability(username)))
        return UpdateUserProfileResponseError.DUPLICATE_USERNAME;

      if (changingEmail && !(await this.checkEmailAvailability(email)))
        return UpdateUserProfileResponseError.DUPLICATE_EMAIL;

      throw e;
    }

    return null;
  }

  async updateUserSelfEmail(
    user: UserEntity,
    email: string,
    emailVerificationCode: string
  ): Promise<UpdateUserSelfEmailResponseError> {
    if (this.configService.config.preference.requireEmailVerification) {
      if (!(await this.authEmailVerifactionCodeService.verify(email, emailVerificationCode)))
        return UpdateUserSelfEmailResponseError.INVALID_EMAIL_VERIFICATION_CODE;
    }

    try {
      user.email = email;
      await this.userRepository.save(user);
    } catch (e) {
      if (!(await this.checkEmailAvailability(email))) return UpdateUserSelfEmailResponseError.DUPLICATE_EMAIL;
      throw e;
    }

    if (this.configService.config.preference.requireEmailVerification) {
      await this.authEmailVerifactionCodeService.revoke(email, emailVerificationCode);
    }

    return null;
  }

  async searchUser(query: string, wildcard: "START" | "END" | "BOTH", maxTakeCount: number): Promise<UserEntity[]> {
    query = escapeLike(query);
    if (wildcard === "START" || wildcard === "BOTH") query = "%" + query;
    if (wildcard === "END" || wildcard === "BOTH") query = query + "%";

    return await this.userRepository.find({
      where: {
        username: Like(query)
      },
      order: {
        username: "ASC"
      },
      take: maxTakeCount
    });
  }

  async getUserList(
    sortBy: "acceptedProblemCount" | "rating",
    skipCount: number,
    takeCount: number
  ): Promise<[users: UserEntity[], count: number]> {
    return await this.userRepository.findAndCount({
      order: {
        [sortBy]: "DESC"
      },
      skip: skipCount,
      take: takeCount
    });
  }

  async onDeleteProblem(problemId: number, transactionalEntityManager: EntityManager): Promise<void> {
    // submissionCount
    await transactionalEntityManager.query(
      "UPDATE `user` " +
        "INNER JOIN " +
        "(SELECT `submitterId`, COUNT(*) AS `count` FROM `submission` WHERE `problemId` = ? GROUP BY `submitterId`) `statistics`" +
        "ON `user`.`id` = `statistics`.`submitterId` " +
        "SET `submissionCount` = `submissionCount` - `statistics`.`count`",
      [problemId]
    );

    // acceptedProblemCount
    const queryAcceptedUsers = transactionalEntityManager
      .createQueryBuilder()
      .select("DISTINCT(submitterId)")
      .from(SubmissionEntity, "submission")
      .where("problemId = :problemId", { problemId: problemId })
      .andWhere("status = :status", { status: SubmissionStatus.Accepted });
    await transactionalEntityManager
      .createQueryBuilder()
      .update(UserEntity, {
        acceptedProblemCount: () => "acceptedProblemCount - 1"
      })
      .where(() => `id IN (${queryAcceptedUsers.getQuery()})`)
      .setParameters(queryAcceptedUsers.expressionMap.parameters)
      .execute();
  }

  async updateUserSubmissionCount(userId: number, incSubmissionCount: number): Promise<void> {
    if (incSubmissionCount !== 0) {
      await this.userRepository.increment({ id: userId }, "submissionCount", incSubmissionCount);
    }
  }

  async updateUserAcceptedCount(
    userId: number,
    problemId: number,
    type: "NON_AC_TO_AC" | "AC_TO_NON_AC"
  ): Promise<void> {
    await this.redisService.lock(`updateUserAcceptedCount_${userId}_${problemId}`, async () => {
      if (type === "NON_AC_TO_AC") {
        if ((await this.submissionService.getUserProblemAcceptedSubmissionCount(userId, problemId)) === 1) {
          await this.userRepository.increment({ id: userId }, "acceptedProblemCount", 1);
        }
      } else {
        if ((await this.submissionService.getUserProblemAcceptedSubmissionCount(userId, problemId)) === 0) {
          await this.userRepository.increment({ id: userId }, "acceptedProblemCount", -1);
        }
      }
    });
  }

  async getUserRank(user: UserEntity): Promise<number> {
    return (
      1 +
      (await this.userRepository.count({
        rating: MoreThan(user.rating)
      }))
    );
  }

  async getUserPreference(user: UserEntity): Promise<UserPreference> {
    const userPreference = await this.userPreferenceRepository.findOne({ userId: user.id });
    return userPreference.preference;
  }

  async updateUserPreference(user: UserEntity, preference: UserPreference): Promise<void> {
    const userPreference = await this.userPreferenceRepository.findOne({ userId: user.id });
    userPreference.preference = preference;
    await this.userPreferenceRepository.save(userPreference);
  }
}
