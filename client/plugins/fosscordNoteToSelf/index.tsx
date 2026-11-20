import { FosscordAuthor } from "../fosscordCore/shared";
import { openPrivateChannel } from "@utils/discord";
import definePlugin from "@utils/types";
import { UserStore } from "@webpack/common";

type JsxModule = { jsx: (type: unknown, props: Record<string, unknown>) => unknown };

export default definePlugin({
    name: "FosscordNoteToSelf",
    description: "Message yourself from your account menu, like a note to self. The conversation is private and encrypted.",
    authors: [FosscordAuthor],
    required: true,

    item(close: () => void, react: JsxModule, MenuItem: unknown) {
        return react.jsx(MenuItem, {
            id: "fosscord-note-to-self",
            label: "Note to Self",
            action: "FOSSCORD_NOTE_TO_SELF",
            icon: () => null,
            trailing: null,
            onClick: () => {
                close();
                const user = UserStore.getCurrentUser();
                if (user) void openPrivateChannel(user.id);
            },
        });
    },

    patches: [
        {
            find: 'action:"EDIT_PROFILE",label:',
            all: true,
            replacement: {
                match: /\(0,(\i)\.jsx\)\((\i)(,\{action:"EDIT_PROFILE")/,
                replace: "$self.item(n,$1,$2),(0,$1.jsx)($2$3",
            },
        },
    ],
});
