/*
 * Discord-style Text, Button and Forms on top of Equicord's own components.
 *
 * Equicord used to export these from @webpack/common as adapters (TextCompat, ButtonCompat and a Forms object) and
 * removed them in v1.15.17. The plugins here still pass Discord's props (variant="text-md/semibold", color,
 * Button.Colors and Button.Sizes), so this keeps those adapters, ported from Equicord 1489c0e (GPL-3.0-or-later).
 */

import { Button as EquicordButton, type ButtonProps, type ButtonSize, TextButton, type TextButtonProps } from "@components/Button";
import { Divider } from "@components/Divider";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Text as EquicordText, type TextProps, type TextSize, type TextWeight } from "@components/Text";

type DiscordTextProps = Omit<TextProps, "color"> & { variant?: string; color?: string };

export function Text({ color, variant, ...rest }: DiscordTextProps) {
    const props = rest as TextProps;
    if (variant) {
        const [left, right] = variant.split("/");
        if (left && right) {
            props.size = left.split("-").pop() as TextSize;
            props.weight = right as TextWeight;
        }
    }
    if (color) props.style = { ...props.style, color: `var(--${color}, var(--text-default))` };
    return <EquicordText {...props} />;
}

const Colors = {
    BRAND: "BRAND",
    PRIMARY: "PRIMARY",
    RED: "RED",
    TRANSPARENT: "TRANSPARENT",
    CUSTOM: "CUSTOM",
    GREEN: "GREEN",
    LINK: "LINK",
    WHITE: "WHITE",
} as const;
type Color = keyof typeof Colors;

const buttonVariant: Record<Color, ButtonProps["variant"]> = {
    BRAND: "primary",
    PRIMARY: "secondary",
    RED: "dangerPrimary",
    TRANSPARENT: "secondary",
    CUSTOM: "none",
    GREEN: "positive",
    LINK: "link",
    WHITE: "overlayPrimary",
};

const textButtonVariant: Record<Color, TextButtonProps["variant"]> = {
    BRAND: "primary",
    PRIMARY: "primary",
    RED: "danger",
    TRANSPARENT: "secondary",
    CUSTOM: "secondary",
    GREEN: "primary",
    LINK: "link",
    WHITE: "secondary",
};

type DiscordButtonProps = Omit<ButtonProps, "color" | "size"> & { look?: string; color?: Color; size?: string };

export function Button({ look, color = "BRAND", size = "medium", ...rest }: DiscordButtonProps) {
    return look === "LINK" ? (
        <TextButton variant={textButtonVariant[color]} {...(rest as TextButtonProps)} />
    ) : (
        <EquicordButton variant={buttonVariant[color]} size={size as ButtonSize} {...(rest as ButtonProps)} />
    );
}

Button.Looks = { FILLED: "", LINK: "LINK" } as const;
Button.Colors = Colors;
Button.Sizes = { SMALL: "small", MEDIUM: "medium", LARGE: "medium", XLARGE: "medium", NONE: "min", MIN: "min" } as const;

export const Forms = {
    FormTitle: Heading,
    FormText: Paragraph,
    FormSection: "section" as never,
    FormDivider: Divider as never,
};
