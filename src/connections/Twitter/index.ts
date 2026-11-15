import crypto from "node:crypto";
import { ConnectedAccount } from "@spacebar/database";
import { RefreshableConnection, ConnectionLoader, DiscordApiErrors } from "@spacebar/util";
import { ConnectedAccountCommonOAuthTokenResponse, ConnectionCallbackSchema } from "@spacebar/schemas";
import { GenericOAuthSettings as TwitterSettings } from "../GenericOAuthSettings";

interface TwitterUserResponse {
    data?: {
        id?: string;
        name?: string;
        username?: string;
    };
}

type XFailure = { error?: unknown; title?: unknown; type?: unknown; reason?: unknown };

const failureCode = (body: XFailure | null) => {
    const value = [body?.reason, body?.error, body?.title].find((x) => typeof x === "string" && x.trim());
    return typeof value === "string" ? value.replace(/[^\w .-]/g, "").slice(0, 64) : "no details";
};

const base64Url = (buffer: Buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const pkcePair = () => {
    const verifier = base64Url(crypto.randomBytes(48));
    return { verifier, challenge: base64Url(crypto.createHash("sha256").update(verifier).digest()) };
};

export default class TwitterConnection extends RefreshableConnection {
    public readonly id = "twitter";
    public friendlyName = "X";
    public setupUrl = "https://developer.x.com/en/portal/dashboard";
    public requiredScopes = ["users.read", "tweet.read"];

    public readonly authorizeUrl = "https://x.com/i/oauth2/authorize";
    public readonly tokenUrl = "https://api.x.com/2/oauth2/token";
    public readonly userInfoUrl = "https://api.x.com/2/users/me";
    public readonly scopes = ["users.read", "tweet.read", "offline.access"];
    settings: TwitterSettings = new TwitterSettings();

    init(): void {
        this.settings = ConnectionLoader.getConnectionConfig<TwitterSettings>(this.id, this.settings);
    }

    public get isConfigured(): boolean {
        return !!this.settings.clientId && !!this.settings.clientSecret;
    }

    getAuthorizationUrl(userId: string): string {
        const { verifier, challenge } = pkcePair();
        const url = new URL(this.authorizeUrl);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", this.settings.clientId as string);
        url.searchParams.set("redirect_uri", this.getRedirectUri());
        url.searchParams.set("scope", this.scopes.join(" "));
        url.searchParams.set("state", this.createState(userId, { verifier }));
        url.searchParams.set("code_challenge", challenge);
        url.searchParams.set("code_challenge_method", "S256");
        return url.toString();
    }

    getTokenUrl(): string {
        return this.tokenUrl;
    }

    private async tokenRequest(step: string, body: Record<string, string>): Promise<ConnectedAccountCommonOAuthTokenResponse> {
        const credentials = Buffer.from(`${this.settings.clientId as string}:${this.settings.clientSecret as string}`).toString("base64");
        const response = await fetch(this.tokenUrl, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${credentials}` },
            body: new URLSearchParams(body),
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
        }).catch(() => null);
        const json = (await response?.json().catch(() => null)) as (Partial<ConnectedAccountCommonOAuthTokenResponse> & XFailure) | null;
        if (!response?.ok || !json?.access_token) {
            console.error(`[X connection] ${step} failed with status ${response?.status ?? "no answer"}: ${failureCode(json)}`);
            throw DiscordApiErrors.GENERAL_ERROR;
        }
        return json as ConnectedAccountCommonOAuthTokenResponse;
    }

    async exchangeCode(state: string, code: string): Promise<ConnectedAccountCommonOAuthTokenResponse> {
        const verifier = this.validateState(state).data?.verifier;
        if (typeof verifier !== "string") throw DiscordApiErrors.INVALID_OAUTH_STATE;
        return this.tokenRequest("token exchange", {
            grant_type: "authorization_code",
            code,
            client_id: this.settings.clientId as string,
            redirect_uri: this.getRedirectUri(),
            code_verifier: verifier,
        });
    }

    async refreshToken(connectedAccount: ConnectedAccount): Promise<ConnectedAccountCommonOAuthTokenResponse> {
        if (!connectedAccount.token_data?.refresh_token) throw new Error("No refresh token available.");
        return this.tokenRequest("token refresh", {
            grant_type: "refresh_token",
            refresh_token: connectedAccount.token_data.refresh_token,
            client_id: this.settings.clientId as string,
        });
    }

    async getUser(token: string): Promise<{ id: string; username: string }> {
        const response = await fetch(this.userInfoUrl, {
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
        }).catch(() => null);
        const json = (await response?.json().catch(() => null)) as (TwitterUserResponse & XFailure) | null;
        const id = json?.data?.id;
        const username = json?.data?.username;
        if (!response?.ok || !id || !/^\d{1,20}$/.test(id) || !username) {
            console.error(`[X connection] user lookup failed with status ${response?.status ?? "no answer"}: ${failureCode(json)}`);
            throw DiscordApiErrors.GENERAL_ERROR;
        }
        return { id, username: username.slice(0, 64) };
    }

    async handleCallback(params: ConnectionCallbackSchema): Promise<ConnectedAccount | null> {
        const { state, code } = params;
        if (!code) throw DiscordApiErrors.GENERAL_ERROR;

        const userId = this.getUserId(state);
        const tokenData = await this.exchangeCode(state, code);
        const user = await this.getUser(tokenData.access_token);

        if (await this.hasConnection(userId, user.id)) return null;

        return await this.createConnection({
            token_data: { ...tokenData, fetched_at: Date.now() },
            user_id: userId,
            external_id: user.id,
            friend_sync: params.friend_sync,
            name: user.username,
            type: this.id,
        });
    }
}
