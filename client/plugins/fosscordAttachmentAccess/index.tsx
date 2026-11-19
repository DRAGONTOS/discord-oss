import { FormSwitch } from "@components/FormSwitch";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { RestAPI, useState, useStateFromStores, useEffect } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import { SettingsSection } from "../fosscordCore/ui";
import managedStyle from "./style.css?managed";

const GuildSettingsStore = findStoreLazy("GuildSettingsStore") as { getGuildId(): string | null };

function AccessToggle() {
    const guildId = useStateFromStores([GuildSettingsStore], () => GuildSettingsStore.getGuildId());
    const [restricted, setRestricted] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!guildId) return;
        let cancelled = false;
        RestAPI.get({ url: `/guilds/${guildId}` })
            .then((res: { body: { restrict_attachments?: boolean } }) => {
                if (!cancelled) setRestricted(!!res.body.restrict_attachments);
            })
            .catch((error: unknown) => console.error("[FosscordAttachmentAccess] failed to load attachment access", error));
        return () => {
            cancelled = true;
        };
    }, [guildId]);

    if (!guildId) return null;

    const save = async (value: boolean) => {
        setSaving(true);
        try {
            await RestAPI.patch({
                url: `/guilds/${guildId}`,
                body: { restrict_attachments: value },
            });
            setRestricted(value);
        } catch (error) {
            console.error("[FosscordAttachmentAccess] failed to update attachment access", error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsSection
            className="fosscord-attachment-access"
            title="Attachment links"
            description="When this is on, links to files posted in this server only open for members of it. Copies of the links stop working for anyone outside, which keeps private uploads private."
        >
            <FormSwitch
                title="Restrict attachment links to members"
                description="People in this server keep seeing images and files as usual. Shared links open only for members."
                value={restricted}
                disabled={saving}
                onChange={save}
            />
        </SettingsSection>
    );
}

export default definePlugin({
    name: "FosscordAttachmentAccess",
    description: "Adds an attachment link sharing toggle to server settings under Access, so private servers can stop attachment links from working outside.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,

    renderToggle: () => <AccessToggle />,

    patches: [
        {
            find: "onTypePicked:i,activeType:l,guild:e",
            replacement: {
                match: /\(0,\i\.jsx\)\(\i\.\i,\{color:"text-strong",variant:"heading-lg\/semibold",children:\i\.intl\.string\(\i\.t#{intl::YJlvBM::raw}\)\}\),/,
                replace: "$self.renderToggle(),$&",
            },
        },
    ],
});
