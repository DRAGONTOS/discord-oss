import { Channel, Guild, Member } from "@spacebar/database";

export const attachmentGuildId = async (channel_id: string): Promise<string | null> => {
    if (!/^\d+$/.test(channel_id)) return null;
    const channel = await Channel.findOne({ where: { id: channel_id }, select: { guild_id: true } });
    return channel?.guild_id ?? null;
};

export const guildRestrictsAttachments = async (guild_id: string): Promise<boolean> => {
    if (!guild_id) return false;
    const guild = await Guild.findOne({ where: { id: guild_id }, select: { restrict_attachments: true } });
    return !!guild?.restrict_attachments;
};

export const attachmentRequiresMembership = async (channel_id: string): Promise<string | null> => {
    const guild_id = await attachmentGuildId(channel_id);
    if (!guild_id) return null;
    return (await guildRestrictsAttachments(guild_id)) ? guild_id : null;
};

export const isGuildAttachmentMember = async (guild_id: string, user_id?: string): Promise<boolean> => {
    if (!user_id) return false;
    return !!(await Member.findOne({ where: { id: user_id, guild_id }, select: { id: true } }));
};

export const attachmentChannelIdFromUrl = (url: string): string | undefined => {
    const match = /\/attachments\/(\d+)\//.exec(url);
    return match?.[1];
};
