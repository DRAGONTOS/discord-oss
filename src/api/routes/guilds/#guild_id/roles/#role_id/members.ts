import { Router, Request, Response } from "express";
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";
import { In } from "typeorm";
import { DiscordApiErrors, emitEvent, GuildMemberUpdateEvent } from "@spacebar/util";
import { authorizeMemberRoleChanges } from "@spacebar/api/util/utility/memberRoleAuthorization";

const router = Router({ mergeParams: true });

router.patch("/", route({ permission: "MANAGE_ROLES" }), async (req: Request, res: Response) => {
    const { guild_id, role_id } = req.params as { [key: string]: string };
    const requested = req.body?.member_ids;
    if (!Array.isArray(requested) || requested.length > 30 || requested.some((id) => typeof id !== "string" || !/^[0-9]{1,20}$/.test(id))) {
        throw DiscordApiErrors.INVALID_FORM_BODY;
    }
    const member_ids = [...new Set<string>(requested)];

    if (role_id == guild_id) throw DiscordApiErrors.INVALID_ROLE;
    await authorizeMemberRoleChanges(req.user_id, guild_id, [], [role_id]);

    const members = member_ids.length ? await Member.find({ where: { guild_id, id: In(member_ids) }, relations: { roles: true } }) : [];
    const add = new Set(members.filter((member) => !member.roles.some((role) => role.id === role_id)).map((member) => member.id));
    if (add.size) {
        await Member.getRepository()
            .manager.createQueryBuilder()
            .insert()
            .into("member_roles")
            .values([...add].map((id) => ({ index: members.find((member) => member.id === id)!.index, role_id })))
            .orIgnore()
            .execute();
    }

    const updated = members.length
        ? await Member.find({
              where: { guild_id, id: In(members.map((m) => m.id)) },
              relations: { roles: true, user: true },
          })
        : [];
    await Promise.all(
        updated
            .filter((member) => add.has(member.id))
            .map((member) =>
                emitEvent({
                    event: "GUILD_MEMBER_UPDATE",
                    data: {
                        ...member.toPublicMember(),
                        guild_id,
                        user: member.user.toPublicUser(),
                        roles: member.roles.map((x) => x.id).filter((id) => id !== guild_id),
                    },
                    guild_id,
                } satisfies GuildMemberUpdateEvent),
            ),
    );
    res.json(
        Object.fromEntries(
            updated.map((m) => [
                m.id,
                {
                    ...m.toPublicMember(),
                    user: m.user.toPublicUser(),
                    roles: m.roles.map((x) => x.id).filter((id) => id !== guild_id),
                },
            ]),
        ),
    );
});

export default router;
