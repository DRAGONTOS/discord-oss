import { CodeBlock } from "@components/CodeBlock";
import ErrorBoundary from "@components/ErrorBoundary";
import { copyWithToast } from "@utils/discord";
import { openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Menu, Modal, Popout, React, RestAPI, SelectedChannelStore, showToast, TextInput } from "@webpack/common";

import { Forms } from "../fosscordCore/compat";
import { Button } from "../fosscordCore/ui";

function openChoiceModal(share?: () => void) {
    openModal((props) => (
        <Modal {...props} size="sm" title="Start streaming">
            <Forms.FormText>Choose how you want to stream to this voice channel.</Forms.FormText>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <Button
                    disabled={!share}
                    onClick={() => {
                        props.onClose();
                        share?.();
                    }}
                >
                    Screen share
                </Button>
                <Button
                    onClick={() => {
                        props.onClose();
                        openStreamKeyModal();
                    }}
                >
                    Stream through external tools
                </Button>
            </div>
        </Modal>
    ));
}

interface StreamKeyInfo {
    has_key: boolean;
    created_at: string | null;
    last_used_at: string | null;
    guild_id: string | null;
    channel_id: string | null;
    expires_at: string | null;
    key?: string;
}

export interface GoLiveButtonProps {
    plainButton: React.ReactNode;
    anchorButton: React.ReactNode;
    share?: () => void;
    streaming: boolean;
    disabled: boolean;
}

export function GoLiveButton({ plainButton, anchorButton, share, streaming, disabled }: GoLiveButtonProps) {
    const ref = React.useRef<HTMLDivElement>(null);
    if (streaming) return <>{plainButton}</>;
    return (
        <Popout
            position="top"
            align="left"
            targetElementRef={ref}
            renderPopout={({ closePopout }) => (
                <Menu.Menu navId="vc-fosscord-golive-menu" onClose={closePopout}>
                    <Menu.MenuItem
                        id="vc-share-screen"
                        label="Screen share"
                        disabled={disabled || !share}
                        action={() => {
                            closePopout();
                            share?.();
                        }}
                    />
                    <Menu.MenuItem
                        id="vc-external-tools"
                        label="Stream through external tools"
                        action={() => {
                            closePopout();
                            openStreamKeyModal();
                        }}
                    />
                </Menu.Menu>
            )}
        >
            {(popoutProps) => (
                <div {...popoutProps} ref={ref}>
                    {anchorButton}
                </div>
            )}
        </Popout>
    );
}

const SafeGoLiveButton = ErrorBoundary.wrap(GoLiveButton, {
    fallback: ({ wrappedProps }) =>
        React.isValidElement(wrappedProps.plainButton)
            ? React.cloneElement(wrappedProps.plainButton as React.ReactElement<{ onClick?: () => void }>, {
                  onClick: () => openChoiceModal(wrappedProps.share),
              })
            : wrappedProps.plainButton,
});

export function renderGoLiveButton(props: GoLiveButtonProps) {
    return <SafeGoLiveButton {...props} />;
}

function StreamKeyModal(props: RenderModalProps) {
    const [info, setInfo] = React.useState<StreamKeyInfo | null>(null);
    const [busy, setBusy] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        RestAPI.get({ url: "/users/@me/stream-key" })
            .then((res) => {
                if (!cancelled) {
                    setInfo(res.body as StreamKeyInfo);
                    setBusy(false);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError("Could not load the stream key.");
                    setBusy(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const voiceChannelId = SelectedChannelStore.getVoiceChannelId();
    const channel = voiceChannelId ? ChannelStore.getChannel(voiceChannelId) : null;
    const guildId = channel?.guild_id ?? "@me";
    const channelId = channel?.id ?? null;
    const key = info?.key;
    const hasKey = info?.has_key ?? Boolean(key);
    const whipUrl = key ? `${location.origin}/whip/${key}` : "";

    const generate = async () => {
        if (!channelId) {
            setError("Join a voice channel before generating a stream key.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await RestAPI.post({ url: "/users/@me/stream-key", body: { guild_id: guildId, channel_id: channelId } });
            setInfo(res.body as StreamKeyInfo);
        } catch {
            setError("Could not generate a stream key.");
        } finally {
            setBusy(false);
        }
    };

    const revoke = async () => {
        setBusy(true);
        setError(null);
        try {
            await RestAPI.del({ url: "/users/@me/stream-key" });
            showToast({ text: "Stream key revoked.", variant: "success" });
            props.onClose();
        } catch {
            setError("Could not revoke the stream key.");
            setBusy(false);
        }
    };

    const actions = key
        ? [
              { text: "Copy key", variant: "primary", onClick: () => copyWithToast(key, "Stream key copied!") },
              { text: "Copy WHIP URL", variant: "secondary", onClick: () => copyWithToast(whipUrl, "WHIP URL copied!") },
              { text: "Revoke key", variant: "secondary", onClick: revoke, disabled: busy },
          ]
        : hasKey
          ? [
                { text: "Generate new key", variant: "primary", onClick: generate, disabled: busy || !channelId },
                { text: "Revoke key", variant: "secondary", onClick: revoke, disabled: busy },
                { text: "Cancel", variant: "secondary", onClick: props.onClose },
            ]
          : [
                { text: "Generate key", variant: "primary", onClick: generate, disabled: busy || !channelId },
                { text: "Cancel", variant: "secondary", onClick: props.onClose },
            ];

    return (
        <Modal {...props} size="md" title="Stream through external tools" subtitle="Use OBS or another WHIP tool to stream into this voice channel." actions={actions}>
            {error && <Forms.FormText style={{ color: "var(--text-danger)", marginBottom: 8 }}>{error}</Forms.FormText>}
            {busy && !info && <Forms.FormText>Loading stream key...</Forms.FormText>}
            {key ? (
                <>
                    <Forms.FormTitle tag="h5">Stream key</Forms.FormTitle>
                    <TextInput value={key} editable={false} maxLength={null} />
                    <Forms.FormText style={{ marginTop: 12 }}>Paste this URL into OBS under Settings &gt; Stream, with Service set to WHIP and the key left empty:</Forms.FormText>
                    <CodeBlock content={whipUrl} lang="" />
                </>
            ) : hasKey ? (
                <>
                    <Forms.FormText>A stream key is already active. Keys are shown only once when generated, so generate a new key to see it again.</Forms.FormText>
                    <Forms.FormText style={{ marginTop: 8 }}>Revoking the key ends any stream connected with it.</Forms.FormText>
                </>
            ) : (
                info && (
                    <>
                        <Forms.FormText>
                            Generate a stream key for {channel ? `#${channel.name}` : "your current voice channel"}. The key is shown once, so copy it after generating.
                        </Forms.FormText>
                        <Forms.FormText style={{ marginTop: 8 }}>Join a voice channel first if you are not in one yet.</Forms.FormText>
                    </>
                )
            )}
        </Modal>
    );
}

export function openStreamKeyModal() {
    openModal((props) => <StreamKeyModal {...props} />);
}
