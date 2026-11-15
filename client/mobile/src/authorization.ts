// The Authorization header of a Networking.sendRequest call. Android passes the headers as
// [name, value] pairs among the arguments; iOS passes one query object with a headers map.
export const authorizationFrom = (args: unknown[]): string | null => {
    for (const arg of args) {
        let pairs: unknown[] = [];
        if (Array.isArray(arg)) pairs = arg;
        else if (arg !== null && typeof arg === "object") {
            const headers = (arg as { headers?: unknown }).headers;
            if (headers !== null && typeof headers === "object" && !Array.isArray(headers)) pairs = Object.entries(headers);
        }
        for (const header of pairs) {
            if (Array.isArray(header) && typeof header[0] === "string" && header[0].toLowerCase() === "authorization" && typeof header[1] === "string") return header[1];
        }
    }
    return null;
};
