import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordLimits",
    description: "Uses this instance's group DM size, set by the server, instead of Discord's 10 (or 25 for some Nitro users).",
    authors: [FosscordAuthor],
    required: true,

    groupDmRecipientLimit() {
        return Number((window as { GLOBAL_ENV?: { GROUP_DM_RECIPIENT_LIMIT?: number } }).GLOBAL_ENV?.GROUP_DM_RECIPIENT_LIMIT) || 25;
    },

    patches: [
        {
            // how many people the client lets into a group DM
            find: '"getGroupDMRecipientLimit"',
            all: true,
            replacement: {
                // staff and the limits were constants (isStaff()?X.Y:...?25:X.Z) before build 673869, inline since (isStaff()||...?25:10)
                match: /return (\i)\?\.isStaff\(\)(?:\?\i\.\i:|\|\|)\i&&\(0,\i\.\i\)\(\1,\i\.PremiumTypes\.TIER_2\)&&\(0,\i\.\i\)\("getGroupDMRecipientLimit"\)\.enabled\?25:(?:\i\.\i|\d+)/,
                replace: "return $self.groupDmRecipientLimit()",
            },
        },
    ],
});
