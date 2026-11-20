import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ScreenshareIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import definePlugin, { OptionType } from "@utils/types";
import { removeFromArray } from "@utils/misc";
import { React, Select } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import { Forms } from "../fosscordCore/compat";
import { Button, SettingsSection } from "../fosscordCore/ui";

import { openStreamKeyModal, renderGoLiveButton } from "./ExternalStream";

type Constraint = number | { ideal?: number; max?: number } | undefined;
type Quality = { width?: number; height?: number; framerate?: number };
type Constraints = { width?: Constraint; height?: Constraint; frameRate?: Constraint; framerate?: Constraint };
type StreamParameter = {
    quality?: number;
    maxResolution?: { type: string; width: number; height: number };
    maxFrameRate?: number;
    maxBitrate?: number;
};
type GoLiveQuality = { encode: Quality; capture: Quality; bitrateMax: number; customBitrate: boolean };
type QualityConnection = {
    videoQualityManager: { setGoliveQuality(options: { encode: Quality; capture: Quality; bitrateMax: number }): void };
    videoStreamParameters?: StreamParameter[];
};

const constraintValue = (value: Constraint) => (typeof value === "number" ? value : (value?.ideal ?? value?.max));

const bitrateOptions = [
    { label: "Auto", value: 0 },
    { label: "1000 kbps", value: 1000 },
    { label: "2500 kbps", value: 2500 },
    { label: "5000 kbps", value: 5000 },
    { label: "8000 kbps", value: 8000 },
    { label: "12000 kbps", value: 12000 },
];
const resolutionOptions = [
    { label: "Auto", value: "auto" },
    { label: "480p", value: 480 },
    { label: "720p", value: 720 },
    { label: "1080p", value: 1080 },
    { label: "1440p", value: 1440 },
    { label: "Source", value: 0 },
];
const framerateOptions = [
    { label: "Auto", value: 0 },
    { label: "15 fps", value: 15 },
    { label: "30 fps", value: 30 },
    { label: "60 fps", value: 60 },
    { label: "120 fps", value: 120 },
];

const settings = definePluginSettings({
    bitrate: {
        type: OptionType.SELECT,
        description: "Maximum bitrate for Go Live streams, in kilobits per second",
        options: bitrateOptions.map((option, index) => ({ ...option, default: index === 0 })),
    },
    resolution: {
        type: OptionType.SELECT,
        description: "Maximum capture resolution for Go Live streams",
        options: resolutionOptions.map((option, index) => ({ ...option, default: index === 0 })),
    },
    framerate: {
        type: OptionType.SELECT,
        description: "Maximum capture frame rate for Go Live streams",
        options: framerateOptions.map((option, index) => ({ ...option, default: index === 0 })),
    },
});

const SETTINGS_KEYS: ("bitrate" | "resolution" | "framerate")[] = ["bitrate", "resolution", "framerate"];
const ENTRY_KEY = "fosscord_go_live";

function QualitySelect({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: { label: string; value: number | string }[];
    value: number | string;
    onChange: (value: number | string) => void;
}) {
    return React.createElement(
        "div",
        { style: { marginTop: 16 } },
        React.createElement(Forms.FormTitle, { tag: "h5" }, label),
        React.createElement(Select, {
            options,
            select: onChange,
            isSelected: (option: number | string) => option === value,
            serialize: (option: number | string) => String(option),
        }),
    );
}

function QualitySettings() {
    const values = settings.use(SETTINGS_KEYS);
    return React.createElement(SettingsSection, {
        title: "Go Live",
        description: "Set the quality of the streams you share. Auto leaves the choice to the client and what your screen captures.",
        children: [
            React.createElement(QualitySelect, {
                label: "Bitrate",
                options: bitrateOptions,
                value: values.bitrate,
                onChange: (value) => void (typeof value === "number" && (values.bitrate = value)),
            }),
            React.createElement(QualitySelect, { label: "Resolution", options: resolutionOptions, value: values.resolution, onChange: (value) => (values.resolution = value) }),
            React.createElement(QualitySelect, {
                label: "Frame rate",
                options: framerateOptions,
                value: values.framerate,
                onChange: (value) => void (typeof value === "number" && (values.framerate = value)),
            }),
            React.createElement(ExternalStreamingSettings),
        ],
    });
}

function ExternalStreamingSettings() {
    return React.createElement(SettingsSection, {
        title: "External streaming",
        description: "Stream through OBS or other WHIP tools with a stream key.",
        children: React.createElement(Button, { variant: "primary", onClick: openStreamKeyModal, children: "Manage stream key" }),
    });
}

const SafeQualitySettings = ErrorBoundary.wrap(QualitySettings, { noop: true });

export default definePlugin({
    name: "FosscordGoLive",
    description:
        "Announces the resolution and frame rate a browser Go Live stream really captures, so viewers see the right quality, and keeps the camera on the device picked in Voice & Video.",
    authors: [FosscordAuthor],
    required: true,
    dependencies: ["Settings"],
    settings,

    qualityOptions(constraints: Constraints, bitrateMax: number): GoLiveQuality {
        const { bitrate, resolution, framerate } = settings.store;
        let width = constraintValue(constraints.width);
        let height = constraintValue(constraints.height);
        let frameRate = constraintValue(constraints.frameRate ?? constraints.framerate);
        if (typeof resolution === "number") {
            height = resolution;
            width = resolution === 0 ? 0 : Math.round((resolution / 9) * 16);
        }
        if (typeof framerate === "number" && framerate !== 0) frameRate = framerate;
        const quality: Quality = { width, height };
        if (frameRate != null) quality.framerate = frameRate;
        const customBitrate = typeof bitrate === "number" && bitrate !== 0;
        return {
            encode: quality,
            capture: quality,
            bitrateMax: customBitrate ? bitrate * 1000 : bitrateMax,
            customBitrate,
        };
    },

    applyGoLiveQuality(connection: QualityConnection, options: GoLiveQuality) {
        connection.videoQualityManager.setGoliveQuality({ encode: options.encode, capture: options.capture, bitrateMax: options.bitrateMax });
        this.syncStreamParameters(connection, options);
    },

    syncEncodingParameters(connection: QualityConnection, index: number, options: GoLiveQuality) {
        const parameter = connection.videoStreamParameters?.[index];
        if (!parameter) return;
        parameter.maxResolution = options.encode.height
            ? { type: "fixed", width: options.encode.width ?? Math.round((options.encode.height / 9) * 16), height: options.encode.height }
            : { type: "source", width: 0, height: 0 };
        if (options.encode.framerate != null) parameter.maxFrameRate = options.encode.framerate;
        parameter.maxBitrate = options.bitrateMax;
    },

    syncStreamParameters(connection: QualityConnection, options: GoLiveQuality) {
        if (!connection.videoStreamParameters) return;
        const { encode, bitrateMax, customBitrate } = options;
        connection.videoStreamParameters = connection.videoStreamParameters.map((parameter) =>
            parameter.quality === 100
                ? {
                      ...parameter,
                      maxResolution: encode.height
                          ? { type: "fixed", width: encode.width ?? Math.round((encode.height / 9) * 16), height: encode.height }
                          : { type: "source", width: 0, height: 0 },
                      ...(encode.framerate != null && { maxFrameRate: encode.framerate }),
                      ...(customBitrate && { maxBitrate: bitrateMax }),
                  }
                : parameter,
        );
    },

    renderGoLiveButton(props) {
        return renderGoLiveButton(props);
    },

    patches: [
        {
            find: "setDesktopInput=",
            replacement: {
                match: /(let (\i)=\i\.stream\.getVideoTracks\(\)\[0\]\.getConstraints\(\),(\i)=\{width:.+?)(this\.videoQualityManager\.setGoliveQuality\(\{encode:\3,capture:\3,bitrateMax:(\i)\}\))/,
                replace: "$1$self.applyGoLiveQuality(this,$self.qualityOptions($2,$5));",
            },
        },
        {
            find: "setDesktopEncodingOptions(e,t,n){",
            replacement: {
                match: /(this\.videoQualityManager\.setGoliveQuality\(\{capture:(\i),encode:\2,bitrateMax:(\i)\}\),this\.videoStreamParameters\.length>(\i)&&\()this\.videoStreamParameters\[\4\]\.maxResolution=\{[^}]*\},this\.videoStreamParameters\[\4\]\.maxFrameRate=\i,this\.videoStreamParameters\[\4\]\.maxBitrate=\3(\),)/,
                replace: "$1$self.syncEncodingParameters(this,$4,$self.qualityOptions($2,$3))$5",
            },
        },
        {
            find: ".acquire({audio:!1,video:",
            replacement: {
                match: /(\i)\.some\((\i)=>\2\.id===(\i)\)&&\((\i)\.deviceId=\3\)(?=;try\{let \i=await \i\.acquire\(\{audio:!1,video:\4\}\))/,
                replace: "$1.some($2=>$2.id===$3)&&($4.deviceId={exact:$3})",
            },
        },
        {
            find: "useStreamQualityIndicator",
            replacement: {
                match: /\(0,(\i)\.jsx\)\("div",\{className:(\i)\.IF,children:\(0,(\i)\.jsx\)\((\i)\.A,\{tooltipText:(\i),disabled:(\i),onClick:(\i),icon:(\i)\}\)\}\)/,
                replace:
                    '$self.renderGoLiveButton({plainButton:(0,$1.jsx)("div",{className:$2.IF,children:(0,$1.jsx)($4.A,{tooltipText:$5,disabled:$6,onClick:$7,icon:$8})}),anchorButton:(0,$1.jsx)("div",{className:$2.IF,children:(0,$1.jsx)($4.A,{tooltipText:$5,disabled:$6,onClick:null,icon:$8})}),share:$7,streaming:o,disabled:$6})',
            },
        },
    ],

    start() {
        SettingsPlugin.customEntries.push({
            key: ENTRY_KEY,
            title: "Go Live",
            Component: SafeQualitySettings,
            Icon: ScreenshareIcon,
        });
    },

    stop() {
        removeFromArray(SettingsPlugin.customEntries, (entry) => entry.key === ENTRY_KEY);
    },
});
